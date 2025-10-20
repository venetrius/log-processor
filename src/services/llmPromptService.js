/*
 * Copyright Camunda Services GmbH and/or licensed to Camunda Services GmbH
 * under one or more contributor license agreements. See the NOTICE file
 * distributed with this work for additional information regarding copyright
 * ownership. Camunda licenses this file to you under the Apache License,
 * Version 2.0; you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

const crypto = require('crypto');
const db = require('../db/db');
const localEmbedAdapter = require('../llm/adapters/localEmbedAdapter');

/**
 * Generate SHA-256 hash of text for deduplication
 */
function generatePromptHash(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

/**
 * Build structured context text for embedding
 * Only includes failure-specific information, NOT generic prompt instructions
 */
function buildContextForEmbedding({ errorAnnotations, failedSteps, context = {} }) {
  const parts = [];

  // Error annotations (most important - positioned first)
  if (errorAnnotations && errorAnnotations.length > 0) {
    const errorText = errorAnnotations
      .map(a => `${a.title || ''} ${a.message}`.trim())
      .join(' | ');
    parts.push(`ERROR: ${errorText}`);
  }

  // Failed steps (second most important)
  if (failedSteps && failedSteps.length > 0) {
    const stepsText = failedSteps
      .map(s => s.step_name || s.name)
      .filter(Boolean)
      .join(' → ');
    if (stepsText) {
      parts.push(`STEPS: ${stepsText}`);
    }
  }

  // Context metadata
  if (context.jobName) {
    parts.push(`JOB: ${context.jobName}`);
  }
  if (context.workflowName) {
    parts.push(`WORKFLOW: ${context.workflowName}`);
  }

  // Log excerpt (truncated intelligently)
  if (context.logLines) {
    const truncatedLogs = truncateLogExcerpt(context.logLines, 500);
    if (truncatedLogs) {
      parts.push(`LOGS: ${truncatedLogs}`);
    }
  }

  return parts.join('\n\n');
}

/**
 * Smart log truncation - keep most relevant parts
 */
function truncateLogExcerpt(logText, maxChars) {
  if (!logText || logText.length <= maxChars) {
    return logText;
  }

  const lines = logText.split('\n');

  // Strategy: Take last N lines (most recent errors are usually at the end)
  const lastLines = lines.slice(-10);
  const lastText = lastLines.join('\n');

  if (lastText.length <= maxChars) {
    return lastText;
  }

  // If still too long, truncate to maxChars with ellipsis
  return lastText.slice(0, maxChars - 3) + '...';
}

/**
 * Save prompt context to database BEFORE calling LLM
 * This allows us to do semantic search on historical failures
 *
 * KEY INSIGHT: Only stores failure-specific context, not generic prompt template
 */
async function savePrompt({ messages, jobId, errorAnnotations, failedSteps, context = {} }) {
  // Build context text (failure-specific only, no generic instructions)
  const contextText = buildContextForEmbedding({ errorAnnotations, failedSteps, context });
  const promptHash = generatePromptHash(contextText);

  console.log(`🔍 Context hash: ${promptHash.slice(0, 8)}... (${contextText.length} chars)`);

  // Check if this exact context already exists
  const existing = await db.query(
    'SELECT id, root_cause_id, confidence, llm_response FROM llm_prompts WHERE prompt_hash = $1',
    [promptHash]
  );

  if (existing.rows.length > 0) {
    console.log(`💾 Exact context match found - reusing cached result`);
    const cached = existing.rows[0];

    // Update reuse tracking
    await db.query(
      `UPDATE llm_prompts 
       SET reused_count = reused_count + 1, 
           last_reused_at = NOW() 
       WHERE id = $1`,
      [cached.id]
    );

    return {
      promptId: cached.id,
      cached: true,
      rootCauseId: cached.root_cause_id,
      confidence: cached.confidence,
      llmResponse: cached.llm_response
    };
  }

  // Generate embedding for the context (not the full prompt with instructions)
  console.log(`🔧 Generating embedding for failure context...`);
  const { embedding } = await localEmbedAdapter.generateEmbedding(contextText);

  // Save context with embedding
  const result = await db.query(
    `INSERT INTO llm_prompts (
      prompt_hash, prompt_text, prompt_embedding,
      job_id, error_annotation_ids, failed_step_names, log_excerpt_length
    ) VALUES ($1, $2, $3::vector, $4, $5, $6, $7)
    RETURNING id`,
    [
      promptHash,
      contextText,  // Store only the specific context, not full prompt
      JSON.stringify(embedding),
      jobId,
      errorAnnotations ? errorAnnotations.map(a => a.id).filter(Boolean) : [],
      failedSteps ? failedSteps.map(s => s.step_name || s.name).filter(Boolean) : [],
      context.logLines ? context.logLines.split('\n').length : 0
    ]
  );

  console.log(`✅ Context saved with ID: ${result.rows[0].id}`);

  return {
    promptId: result.rows[0].id,
    cached: false,
    embedding
  };
}

/**
 * Find similar historical prompts using semantic search
 * This is MUCH better than searching on error_annotations because:
 * - It includes full context (errors + steps + logs + metadata)
 * - Different contexts create different embeddings
 * - Solves the "same symptom, different cause" problem
 */
async function findSimilarPrompts(promptEmbedding, threshold = 0.85, limit = 5) {
  const result = await db.query(
    `SELECT 
       lp.id as prompt_id,
       lp.prompt_text,
       lp.root_cause_id,
       lp.confidence as llm_confidence,
       lp.llm_response,
       lp.llm_model,
       lp.reused_count,
       lp.last_reused_at,
       lp.created_at,
       rc.category,
       rc.title as root_cause_title,
       rc.description as root_cause_description,
       rc.suggested_fix,
       rc.occurrence_count,
       rc.discovery_method,
       1 - (lp.prompt_embedding <=> $1::vector) as similarity
     FROM llm_prompts lp
     LEFT JOIN root_causes rc ON lp.root_cause_id = rc.id
     WHERE lp.prompt_embedding IS NOT NULL
       AND lp.root_cause_id IS NOT NULL
       AND 1 - (lp.prompt_embedding <=> $1::vector) >= $2
     ORDER BY lp.prompt_embedding <=> $1::vector
     LIMIT $3`,
    [JSON.stringify(promptEmbedding), threshold, limit]
  );

  return result.rows;
}

/**
 * Update prompt with LLM response after analysis
 */
async function updatePromptWithResponse(promptId, {
  llmModel,
  llmResponse,
  llmTokens,
  llmDuration,
  rootCauseId,
  confidence
}) {
  await db.query(
    `UPDATE llm_prompts 
     SET llm_model = $1,
         llm_response = $2,
         llm_tokens_used = $3,
         llm_duration_ms = $4,
         root_cause_id = $5,
         confidence = $6
     WHERE id = $7`,
    [llmModel, llmResponse, llmTokens, llmDuration, rootCauseId, confidence, promptId]
  );
}

/**
 * Mark a prompt as reused (when semantic match is accepted)
 */
async function markPromptAsReused(promptId) {
  await db.query(
    `UPDATE llm_prompts 
     SET reused_count = reused_count + 1,
         last_reused_at = NOW()
     WHERE id = $1`,
    [promptId]
  );
}

/**
 * Get statistics about prompt caching effectiveness
 */
async function getPromptStats() {
  const result = await db.query(`
    SELECT 
      COUNT(*) as total_prompts,
      COUNT(*) FILTER (WHERE root_cause_id IS NOT NULL) as with_results,
      COUNT(*) FILTER (WHERE reused_count > 0) as reused_prompts,
      SUM(reused_count) as total_reuses,
      AVG(confidence) FILTER (WHERE confidence IS NOT NULL) as avg_confidence,
      SUM(llm_tokens_used) FILTER (WHERE llm_tokens_used IS NOT NULL) as total_tokens_used
    FROM llm_prompts
  `);

  return result.rows[0];
}

/**
 * Batch generate embeddings for existing prompts without embeddings
 */
async function generateMissingPromptEmbeddings() {
  const result = await db.query(
    'SELECT id, prompt_text FROM llm_prompts WHERE prompt_embedding IS NULL ORDER BY created_at DESC'
  );

  const prompts = result.rows;
  console.log(`📊 Found ${prompts.length} prompts without embeddings`);

  let processed = 0;
  for (const { id, prompt_text } of prompts) {
    try {
      const { embedding } = await localEmbedAdapter.generateEmbedding(prompt_text);
      await db.query(
        'UPDATE llm_prompts SET prompt_embedding = $1::vector WHERE id = $2',
        [JSON.stringify(embedding), id]
      );
      processed++;
      console.log(`✅ [${processed}/${prompts.length}] Generated embedding for prompt ${id}`);
    } catch (error) {
      console.error(`❌ Failed for prompt ${id}:`, error.message);
    }
  }

  return { total: prompts.length, processed };
}

module.exports = {
  savePrompt,
  findSimilarPrompts,
  updatePromptWithResponse,
  markPromptAsReused,
  getPromptStats,
  generateMissingPromptEmbeddings,
  buildContextForEmbedding,
  truncateLogExcerpt,
  generatePromptHash
};

