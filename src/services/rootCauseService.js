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

const fs = require('fs');
let db = require('../db/db');
const { matchPattern } = require('../patternMatcher');
const llmPromptService = require('./llmPromptService');

// Response discriminator values
const RESPONSE_TYPES = {
  ROOT_CAUSE: 'root_cause',
  NEED_MORE_INFO: 'need_more_info'
};

let llmClient = null;
let promptBuilder = null;
let serviceOptions = {
  confidenceThreshold: 0.8,
  enableLLM: true,
  enablePromptSemanticSearch: false, // TODO
  promptSemanticSearchThreshold: 0.85
};

/**
 * Initialize service dependencies
 */
function initialize({ llmClient: lc, promptBuilder: pb, options = {}, db: dbOverride }) {
  llmClient = lc || null;
  promptBuilder = pb;
  serviceOptions = { ...serviceOptions, ...options };
  if (dbOverride) db = dbOverride; // allow test injection
}

/**
 * Analyze a job with 3-tier detection:
 * 1. Pattern matching (instant, free)
 * 2. Prompt-based semantic search (50-100ms, free)
 * 3. LLM analysis (2-5s, costs money)
 */
async function analyzeJob(jobId, errorAnnotations, failedSteps, context = {}) {
  const startOverall = Date.now();

  // Skip pattern matching if we're in an LLM retry phase
  if (!context.phase || context.phase === 'pattern') {
    const patternResult = await tryPatternMatching(jobId, errorAnnotations, failedSteps, startOverall);
    if (patternResult) return patternResult;
  }

  // 2️⃣ LLM disabled?
  if (!serviceOptions.enableLLM || !llmClient) {
    console.debug("⚠️ No pattern match and LLM disabled");
    return { status: 'no_match', method: 'pattern' };
  }

  // 3️⃣ Build LLM prompt context (or reuse from retry)
  const llmStart = Date.now();
  const logLines = context.logLines || await loadLastLogLines(jobId, 50).catch(() => '');
  const messages = await buildLLMPrompt(context, errorAnnotations, failedSteps, logLines);

  if (!messages) {
    return { status: 'llm_failure', method: 'llm', error: 'Prompt build failed' };
  }

  // TODO save LLM prompt to DB for auditing

  // 4️⃣ Prompt-Based Semantic Search (Level 2)
  if (serviceOptions.enablePromptSemanticSearch) {
    const semanticResult = await trySemanticSearch(jobId, messages, errorAnnotations, failedSteps, context, logLines, llmStart);
    if (semanticResult) return semanticResult;
  }

  // 5️⃣ LLM Analysis (Level 3 - Most Expensive)
  return await performLLMAnalysis(jobId, messages, errorAnnotations, failedSteps, context, llmStart);
}

/* ---------- Analysis Phase Helpers ---------- */

/**
 * Phase 1: Pattern Matching
 */
async function tryPatternMatching(jobId, errorAnnotations, failedSteps, startTime) {
  const patternMatch = matchPattern(errorAnnotations, failedSteps);
  if (!patternMatch) return null;

  const duration = Date.now() - startTime;
  const rootCause = await findOrCreateRootCause(patternMatch);
  await linkJobAndUpdateRootCause(jobId, rootCause.id, {
    confidence: patternMatch.confidence,
    detection_method: 'pattern',
    analysis_duration_ms: duration,
    raw_analysis: JSON.stringify({ patternMatch })
  });


  console.log('is generic failure:', patternMatch.category === 'generic_failure');
  // TODO use config to decide whether to accept generic failures
  if (patternMatch.category !== 'generic_failure') {
    return {
      status: 'pattern_success',
      method: 'pattern',
      rootCause,
      confidence: patternMatch.confidence,
      duration
    };
  }

  return null; // Generic failure - continue to LLM
}

/**
 * Build LLM prompt messages
 */
async function buildLLMPrompt(context, errorAnnotations, failedSteps, logLines) {
  console.log("🤖 Preparing for LLM analysis...");

  try {
    return promptBuilder.build('rootCauseAnalysis', {
      jobName: context.jobName || 'Unknown Job',
      workflowName: context.workflowName || 'Unknown Workflow',
      repository: context.repository || 'unknown/repo',
      errorAnnotations: (errorAnnotations || []).map(a => simplifyAnnotation(a)),
      failedSteps: (failedSteps || []).map(s => simplifyStep(s)),
      logLines
    });
  } catch (err) {
    console.error(`❌ Prompt build failed: ${err.message}`);
    return null;
  }
}

/**
 * Phase 2: Semantic Search
 */
async function trySemanticSearch(jobId, messages, errorAnnotations, failedSteps, context, logLines, llmStart) {
  console.log("🔍 Checking for similar historical prompts...");

  try {
    const promptInfo = await llmPromptService.savePrompt({
      messages,
      jobId,
      errorAnnotations,
      failedSteps,
      context: { ...context, logLines }
    });

    // Exact cache hit
    if (promptInfo.cached && promptInfo.rootCauseId) {
      const rootCause = await getRootCauseById(promptInfo.rootCauseId);

      if (rootCause) {
        console.log(`💾 Exact prompt match found - reusing cached result!`);
        await linkJobAndUpdateRootCause(jobId, promptInfo.rootCauseId, {
          confidence: promptInfo.confidence,
          detection_method: 'prompt_cache_exact',
          analysis_duration_ms: Date.now() - llmStart,
          raw_analysis: `Cached from prompt ${promptInfo.promptId}`
        });

        return {
          status: 'prompt_cache_success',
          method: 'prompt_cache_exact',
          rootCause,
          confidence: promptInfo.confidence,
          duration: Date.now() - llmStart,
          promptId: promptInfo.promptId
        };
      }

      console.log(`   ⚠️ Cached root cause no longer exists - retrying with LLM`);
    }

    // Semantic similarity search
    if (!promptInfo.cached) {
      const similarPrompts = await llmPromptService.findSimilarPrompts(
        promptInfo.embedding,
        serviceOptions.promptSemanticSearchThreshold,
        5
      );

      if (similarPrompts.length > 0) {
        const topMatch = similarPrompts[0];
        console.log(`✅ Similar prompt found: "${topMatch.root_cause_title}" (similarity: ${topMatch.similarity.toFixed(3)})`);
        console.log(`   Reused ${topMatch.reused_count} times before`);

        const shouldUseSemantic = (
          topMatch.similarity >= 0.90 ||
          topMatch.reused_count >= 3 ||
          topMatch.discovery_method === 'pattern'
        );

        if (shouldUseSemantic) {
          console.log(`   ✅ High confidence - using semantic match`);
          const semanticDuration = Date.now() - llmStart;

          await llmPromptService.markPromptAsReused(topMatch.prompt_id);
          await linkJobAndUpdateRootCause(jobId, topMatch.root_cause_id, {
            confidence: topMatch.similarity,
            detection_method: 'prompt_semantic_search',
            analysis_duration_ms: semanticDuration,
            raw_analysis: JSON.stringify({
              promptId: promptInfo.promptId,
              matchedPromptId: topMatch.prompt_id,
              similarity: topMatch.similarity,
              reusedCount: topMatch.reused_count
            })
          });

          await llmPromptService.updatePromptWithResponse(promptInfo.promptId, {
            llmModel: 'semantic-reuse',
            llmResponse: `Reused from prompt ${topMatch.prompt_id}`,
            llmTokens: 0,
            llmDuration: semanticDuration,
            rootCauseId: topMatch.root_cause_id,
            confidence: topMatch.similarity
          });

          return {
            status: 'prompt_semantic_success',
            method: 'prompt_semantic_search',
            rootCause: {
              id: topMatch.root_cause_id,
              title: topMatch.root_cause_title,
              description: topMatch.root_cause_description,
              suggested_fix: topMatch.suggested_fix,
              category: topMatch.category
            },
            confidence: topMatch.similarity,
            duration: semanticDuration,
            promptId: promptInfo.promptId,
            matchedPromptId: topMatch.prompt_id
          };
        }

        console.log(`   ⚠️ Medium confidence (${topMatch.similarity.toFixed(3)}) - will validate with LLM`);
        context.semanticSuggestion = {
          title: topMatch.root_cause_title,
          confidence: topMatch.similarity,
          reusedCount: topMatch.reused_count
        };
      } else {
        console.log(`   ⚠️ No similar prompts found (threshold: ${serviceOptions.promptSemanticSearchThreshold})`);
      }
    }

    context.promptId = promptInfo.promptId;
  } catch (error) {
    console.error('❌ Prompt semantic search failed:', error.message);
  }

  return null; // Continue to LLM
}

/**
 * Phase 3: LLM Analysis
 */
async function performLLMAnalysis(jobId, messages, errorAnnotations, failedSteps, context, llmStart) {
  console.log("🤖 Invoking LLM for root cause analysis...");

  let rawContent, tokensMeta, model, provider;
  try {
    const response = await llmClient.send(messages);
    rawContent = response.content;
    tokensMeta = response.tokens || {};
    model = response.model;
    provider = response.provider;
  } catch (err) {
    return { status: 'llm_failure', method: 'llm', error: `LLM request failed: ${err.message}` };
  }

  const parsed = parseLLMResponse(rawContent);
  const llmDuration = Date.now() - llmStart;
  console.log(`🤖 LLM analysis completed in ${llmDuration}ms (model: ${model}, tokens: ${tokensMeta.total || 'n/a'})`);
  console.debug(JSON.stringify(parsed));

  if (!parsed.valid) {
    await recordLLMAnalysis(jobId, {
      confidence: 0,
      detection_method: 'llm_malformed',
      llm_model: model,
      llm_tokens_used: tokensMeta?.total || null,
      analysis_duration_ms: llmDuration,
      raw_analysis: rawContent
    });
    return { status: 'llm_failure', method: 'llm', error: parsed.error };
  }

  // Handle NEED_MORE_INFO response
  if (parsed.type === RESPONSE_TYPES.NEED_MORE_INFO) {
    return await handleNeedMoreInfo(jobId, errorAnnotations, failedSteps, context, parsed, model, tokensMeta, llmDuration, rawContent);
  }

  // Handle ROOT_CAUSE response
  return await handleRootCauseResponse(jobId, parsed.data, context, model, provider, tokensMeta, llmDuration, rawContent);
}

/**
 * Handle LLM NEED_MORE_INFO response with retry logic
 */
async function handleNeedMoreInfo(jobId, errorAnnotations, failedSteps, context, parsed, model, tokensMeta, llmDuration, rawContent) {
  await recordLLMAnalysis(jobId, {
    confidence: 0,
    detection_method: 'llm_need_more_info',
    llm_model: model,
    llm_tokens_used: tokensMeta?.total || null,
    analysis_duration_ms: llmDuration,
    raw_analysis: rawContent,
  });

  const maxRetries = 2;
  const retryAttempt = (context.retryAttempt || 0) + 1;

  if (retryAttempt > maxRetries) {
    console.warn(`⚠️ Max retry attempts (${maxRetries}) reached - giving up`);
    return {
      status: 'llm_need_more_info',
      method: 'llm',
      data: parsed.data,
      error: 'Max retry attempts exceeded'
    };
  }

  const request = parsed.data.request || {};
  const moreLines = request.more_lines || 100;
  const direction = request.direction || 'before';
  const currentLineCount = context.currentLogLineCount || 50;

  console.log(`🔄 LLM needs more info (attempt ${retryAttempt}/${maxRetries}): ${parsed.data.reason}`);
  console.log(`   Requesting ${moreLines} more lines (${direction})`);

  try {
    const enhancedLogLines = await loadLogLinesWithDirection(
      jobId,
      currentLineCount,
      moreLines,
      direction
    );

    const enhancedContext = {
      ...context,
      logLines: enhancedLogLines,
      currentLogLineCount: currentLineCount + moreLines,
      retryAttempt,
      previousRequest: parsed.data,
      phase: 'llm' // Skip pattern and semantic search on retry
    };

    return await analyzeJob(jobId, errorAnnotations, failedSteps, enhancedContext);
  } catch (retryError) {
    console.error(`❌ Failed to retry with more context: ${retryError.message}`);
    return {
      status: 'llm_need_more_info',
      method: 'llm',
      data: parsed.data,
      error: `Retry failed: ${retryError.message}`
    };
  }
}

/**
 * Handle successful ROOT_CAUSE response from LLM
 */
async function handleRootCauseResponse(jobId, rcData, context, model, provider, tokensMeta, llmDuration, rawContent) {
  const confidence = rcData.confidence ?? 0.5;

  if (confidence < serviceOptions.confidenceThreshold) {
    await recordLLMAnalysis(jobId, {
      detection_method: 'llm_below_threshold',
      confidence,
      llm_model: model,
      llm_tokens_used: tokensMeta?.total || null,
      analysis_duration_ms: llmDuration,
      raw_analysis: rawContent
    });
    return {
      status: 'llm_failure',
      method: 'llm',
      error: `Confidence ${confidence} below threshold ${serviceOptions.confidenceThreshold}`
    };
  }

  const rootCause = await findOrCreateRootCause({
    category: rcData.category || 'unknown',
    title: rcData.title?.slice(0, 255) || 'LLM Root Cause',
    description: rcData.description || rcData.reasoning || null,
    suggestedFix: rcData.suggested_fix || null,
    confidence,
    discoveryMethod: 'llm'
  });

  await linkJobAndUpdateRootCause(jobId, rootCause.id, {
    confidence,
    detection_method: 'llm',
    llm_model: model || provider || 'unknown',
    llm_tokens_used: tokensMeta?.total || null,
    analysis_duration_ms: llmDuration,
    raw_analysis: rawContent
  });

  if (context.promptId) {
    await llmPromptService.updatePromptWithResponse(context.promptId, {
      llmModel: model || provider || 'unknown',
      llmResponse: rawContent,
      llmTokens: tokensMeta?.total || null,
      llmDuration: llmDuration,
      rootCauseId: rootCause.id,
      confidence: confidence
    });
  }

  return { status: 'llm_success', method: 'llm', rootCause, confidence, duration: llmDuration };
}

/* ---------- Helpers ---------- */
async function linkJobAndUpdateRootCause(jobId, rootCauseId, linkOptions) {
  await linkJobToRootCause(jobId, rootCauseId, linkOptions);
  await incrementRootCauseOccurrence(rootCauseId);
  await updateLastSeen(rootCauseId);
}

function parseLLMResponse(raw) {
  if (!raw || typeof raw !== 'string') return { valid: false, error: 'Empty response' };
  const cleaned = raw.replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();

  try {
    const json = JSON.parse(cleaned);
    if (json.type === RESPONSE_TYPES.NEED_MORE_INFO || json.type === RESPONSE_TYPES.ROOT_CAUSE)
      return { valid: true, type: json.type, data: json };
    return { valid: false, error: `Unknown response type: ${json.type}` };
  } catch (err) {
    return { valid: false, error: `JSON parse error: ${err.message}` };
  }
}

async function loadLastLogLines(jobId, lineCount) {
  const result = await db.query('SELECT log_file_path FROM jobs WHERE job_id = $1', [jobId]);
  if (result.rows.length === 0) return '';
  const filePath = result.rows[0].log_file_path;
  if (!filePath || !fs.existsSync(filePath)) return '';
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split(/\r?\n/);
  return lines.slice(-lineCount).join('\n');
}

/**
 * Load log lines based on direction relative to current context
 * @param {string} jobId - Job ID
 * @param {number} currentLineCount - Current number of lines loaded
 * @param {number} additionalLines - How many more lines to load
 * @param {string} direction - 'before', 'after', or 'both'
 * @returns {Promise<string>} Enhanced log lines
 */
async function loadLogLinesWithDirection(jobId, currentLineCount, additionalLines, direction) {
  const result = await db.query('SELECT log_file_path FROM jobs WHERE job_id = $1', [jobId]);
  if (result.rows.length === 0) return '';
  const filePath = result.rows[0].log_file_path;
  if (!filePath || !fs.existsSync(filePath)) return '';

  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split(/\r?\n/);

  // Calculate which lines to return based on direction
  if (direction === 'after') {
    // Keep last N lines and add more after (older logs)
    const totalLines = Math.min(currentLineCount + additionalLines, lines.length);
    return lines.slice(-totalLines).join('\n');
  } else if (direction === 'before') {
    // Already showing last N, show more context before those
    const totalLines = Math.min(currentLineCount + additionalLines, lines.length);
    return lines.slice(-totalLines).join('\n');
  } else if (direction === 'both') {
    // Expand in both directions
    const totalLines = Math.min(currentLineCount + additionalLines, lines.length);
    return lines.slice(-totalLines).join('\n');
  }

  // Default: return last N lines
  return lines.slice(-currentLineCount).join('\n');
}

function simplifyAnnotation(a) {
  return { message: a.message, title: a.title, path: a.path, start_line: a.start_line, end_line: a.end_line };
}

function simplifyStep(s) {
  return { name: s.name || s.step_name, status: s.status || s.conclusion, conclusion: s.conclusion };
}

/* ---------- Persistence helpers ---------- */

async function getRootCauseById(rootCauseId) {
  const result = await db.query('SELECT * FROM root_causes WHERE id = $1', [rootCauseId]);
  return result.rows.length > 0 ? result.rows[0] : null;
}

async function findOrCreateRootCause(patternMatch) {
  const existing = await db.query(
    'SELECT * FROM root_causes WHERE category = $1 AND title = $2 LIMIT 1',
    [patternMatch.category, patternMatch.title]
  );
  if (existing.rows.length > 0) return existing.rows[0];

  const result = await db.query(
    `INSERT INTO root_causes (category, title, description, suggested_fix, confidence_threshold, discovery_method)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [
      patternMatch.category,
      patternMatch.title,
      patternMatch.description,
      patternMatch.suggestedFix,
      patternMatch.confidence,
      patternMatch.discoveryMethod || 'pattern'
    ]
  );
  return result.rows[0];
}

async function linkJobToRootCause(jobId, rootCauseId, options) {
  if (rootCauseId == null) {
    return null;
  }
  await db.query(
    `INSERT INTO job_root_causes (
      job_id, root_cause_id, confidence, detection_method,
      llm_model, llm_tokens_used, analysis_duration_ms, raw_analysis
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      jobId,
      rootCauseId,
      options.confidence,
      options.detection_method,
      options.llm_model || null,
      options.llm_tokens_used || null,
      options.analysis_duration_ms || null,
      options.raw_analysis || null
    ]
  );
}

async function incrementRootCauseOccurrence(rootCauseId) {
  if (rootCauseId == null) {
    return null;
  }
  await db.query(
    `UPDATE root_causes 
     SET occurrence_count = occurrence_count + 1,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $1`,
    [rootCauseId]
  );
}

async function updateLastSeen(rootCauseId) {
  if (rootCauseId == null) {
    return null;
  }
  await db.query(
    `UPDATE root_causes 
     SET last_seen_at = CURRENT_TIMESTAMP
     WHERE id = $1`,
    [rootCauseId]
  );
}

async function recordLLMAnalysis(jobId, options) {
  await db.query(
    `INSERT INTO job_root_causes (
      job_id, root_cause_id, confidence, detection_method,
      llm_model, llm_tokens_used, analysis_duration_ms, raw_analysis
    ) VALUES ($1, NULL, $2, $3, $4, $5, $6, $7)`,
    [
      jobId,
      options.confidence,
      options.detection_method,
      options.llm_model || null,
      options.llm_tokens_used || null,
      options.analysis_duration_ms || null,
      options.raw_analysis || null
    ]
  );
}

async function workflowRunExists(runId) {
  const result = await db.query(
    'SELECT 1 FROM workflow_runs WHERE run_id = $1',
    [runId]
  );
  return result.rows.length > 0;
}

/* ---------- Exports ---------- */
module.exports = {
  initialize,
  analyzeJob,
  _parseLLMResponse: parseLLMResponse,
  workflowRunExists,
  _setDb(newDb) { db = newDb; }
};

