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

// Response discriminator values
const RESPONSE_TYPES = {
  ROOT_CAUSE: 'root_cause',
  NEED_MORE_INFO: 'need_more_info'
};

let llmClient = null;
let promptBuilder = null;
let serviceOptions = {
  confidenceThreshold: 0.8,
  enableLLM: true
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
 * Analyze a job:
 * 1. Pattern match
 * 2. LLM fallback
 * 3. Persist and link
 */
async function analyzeJob(jobId, errorAnnotations, failedSteps, context = {}) {
  const startOverall = Date.now();

  // 1️⃣ Pattern Matching
  const patternMatch = matchPattern(errorAnnotations, failedSteps);
  if (patternMatch) {
    // console.debug("✅ Pattern match found:", patternMatch);
    const duration = Date.now() - startOverall;
    const rootCause = await findOrCreateRootCause(patternMatch);
    await linkJobToRootCause(jobId, rootCause.id, {
      confidence: patternMatch.confidence,
      detection_method: 'pattern',
      analysis_duration_ms: duration,
      raw_analysis: JSON.stringify({ patternMatch })
    });
    await incrementRootCauseOccurrence(rootCause.id);
    console.log('is generic failure:', patternMatch.category === 'generic_failure');
    if(patternMatch.category !== 'generic_failure') {
      return {
        status: 'pattern_success',
        method: 'pattern',
        rootCause,
        confidence: patternMatch.confidence,
        duration
      };
    }

  }

  // 2️⃣ LLM disabled?
  if (!serviceOptions.enableLLM || !llmClient) {
    console.debug("⚠️ No pattern match and LLM disabled");
    return { status: 'no_match', method: 'pattern' };
  }

  // 3️⃣ LLM Analysis
  const llmStart = Date.now();
  console.log("retrieving log lines for job:", jobId);
  // TODO should be able to download the logs at this point, instead of relying on a path in the DB
  // TODO should fetch lines in a better way eg.: match `##[error]Process completed with exit code 1.` and get lines
  // around it
  let logLines = context.logLines || await loadLastLogLines(jobId, 50).catch(() => '');

  let messages;
  try {
    console.log("🤖 Invoking LLM for root cause analysis...");
    messages = promptBuilder.build('rootCauseAnalysis', {
      jobName: context.jobName || 'Unknown Job',
      workflowName: context.workflowName || 'Unknown Workflow',
      repository: context.repository || 'unknown/repo',
      errorAnnotations: (errorAnnotations || []).map(a => simplifyAnnotation(a)),
      failedSteps: (failedSteps || []).map(s => simplifyStep(s)),
      logLines
    });
    console.log(`   Messages: ${JSON.stringify(messages)}`);
  } catch (err) {
    return { status: 'llm_failure', method: 'llm', error: `Prompt build failed: ${err.message}` };
  }

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

  if (!parsed.valid) {
    await recordLLMAnalysis(jobId, {
      detection_method: 'llm_malformed',
      llm_model: model,
      llm_tokens_used: tokensMeta?.total || null,
      analysis_duration_ms: llmDuration,
      raw_analysis: rawContent
    });
    return { status: 'llm_failure', method: 'llm', error: parsed.error };
  }

  if (parsed.type === RESPONSE_TYPES.NEED_MORE_INFO) {
    await recordLLMAnalysis(jobId, {
      detection_method: 'llm_need_more_info',
      llm_model: model,
      llm_tokens_used: tokensMeta?.total || null,
      analysis_duration_ms: llmDuration,
      raw_analysis: rawContent
    });
    return { status: 'llm_need_more_info', method: 'llm', data: parsed.data };
  }

  // Valid root cause
  const rc = parsed.data;
  const confidence = rc.confidence ?? 0.5;

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
    category: rc.category || 'unknown',
    title: rc.title?.slice(0, 255) || 'LLM Root Cause',
    description: rc.description || rc.reasoning || null,
    suggestedFix: rc.suggested_fix || null,
    confidence
  });

  await linkJobToRootCause(jobId, rootCause.id, {
    confidence,
    detection_method: 'llm',
    llm_model: model || provider || 'unknown',
    llm_tokens_used: tokensMeta?.total || null,
    analysis_duration_ms: llmDuration,
    raw_analysis: rawContent
  });
  await incrementRootCauseOccurrence(rootCause.id);

  return { status: 'llm_success', method: 'llm', rootCause, confidence, duration: llmDuration };
}

/* ---------- Helpers ---------- */

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
  console.log('Log file path query result:', result.rows);
  if (result.rows.length === 0) return '';
  const filePath = result.rows[0].log_file_path;
  console.log("Loading log file:", filePath);
  if (!filePath || !fs.existsSync(filePath)) return '';
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split(/\r?\n/);
  console.log(`Log file has ${lines.length} lines, returning last ${lineCount}`);
  return lines.slice(-lineCount).join('\n');
}

function simplifyAnnotation(a) {
  return { message: a.message, title: a.title, path: a.path, start_line: a.start_line, end_line: a.end_line };
}

function simplifyStep(s) {
  return { name: s.name || s.step_name, status: s.status || s.conclusion, conclusion: s.conclusion };
}

/* ---------- Persistence helpers ---------- */

async function findOrCreateRootCause(patternMatch) {
  const existing = await db.query(
    'SELECT * FROM root_causes WHERE category = $1 AND title = $2 LIMIT 1',
    [patternMatch.category, patternMatch.title]
  );
  if (existing.rows.length > 0) return existing.rows[0];

  const result = await db.query(
    `INSERT INTO root_causes (category, title, description, suggested_fix, confidence_threshold)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [
      patternMatch.category,
      patternMatch.title,
      patternMatch.description,
      patternMatch.suggestedFix,
      patternMatch.confidence
    ]
  );
  return result.rows[0];
}

async function linkJobToRootCause(jobId, rootCauseId, options) {
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
  await db.query(
    `UPDATE root_causes 
     SET occurrence_count = occurrence_count + 1,
         updated_at = CURRENT_TIMESTAMP
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
