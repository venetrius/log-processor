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

const db = require('./db');
const { matchPattern } = require('./patternMatcher');

/**
 * Root Cause Analyzer - Phase 3.1
 * Implements pattern-based root cause detection
 */

/**
 * Analyze a failed job and detect root cause
 * @param {number} jobId - Job ID
 * @param {Array} errorAnnotations - Error annotations
 * @param {Array} failedSteps - Failed steps
 * @returns {Promise<Object|null>} Analysis result
 */
async function analyzeJob(jobId, errorAnnotations, failedSteps) {
  const startTime = Date.now();

  // Level 1: Pattern Matching
  console.log(`   🔍 Analyzing root cause...`);
  const patternMatch = matchPattern(errorAnnotations, failedSteps);

  if (patternMatch) {
    const duration = Date.now() - startTime;
    console.log(`   ✅ Root cause detected: ${patternMatch.title} (confidence: ${patternMatch.confidence})`);

    // Find or create root cause in database
    const rootCause = await findOrCreateRootCause(patternMatch);

    // Link job to root cause
    await linkJobToRootCause(jobId, rootCause.id, {
      confidence: patternMatch.confidence,
      detection_method: 'pattern',
      analysis_duration_ms: duration,
      raw_analysis: JSON.stringify(patternMatch)
    });

    // Increment occurrence count
    await incrementRootCauseOccurrence(rootCause.id);

    return {
      rootCause,
      confidence: patternMatch.confidence,
      method: 'pattern',
      duration
    };
  }

  console.log(`   ⚠️  No pattern match found`);
  return null;
}

/**
 * Find existing root cause or create new one
 */
async function findOrCreateRootCause(patternMatch) {
  // Try to find existing root cause
  const existing = await db.query(
    'SELECT * FROM root_causes WHERE category = $1 AND title = $2 LIMIT 1',
    [patternMatch.category, patternMatch.title]
  );

  if (existing.rows.length > 0) {
    return existing.rows[0];
  }

  // Create new root cause
  const result = await db.query(`
    INSERT INTO root_causes (
      category, title, description, suggested_fix, confidence_threshold
    ) VALUES ($1, $2, $3, $4, $5)
    RETURNING *
  `, [
    patternMatch.category,
    patternMatch.title,
    patternMatch.description,
    patternMatch.suggestedFix,
    patternMatch.confidence
  ]);

  return result.rows[0];
}

/**
 * Link a job to a root cause
 */
async function linkJobToRootCause(jobId, rootCauseId, options) {
  await db.query(`
    INSERT INTO job_root_causes (
      job_id, root_cause_id, confidence, detection_method,
      llm_model, llm_tokens_used, analysis_duration_ms, raw_analysis
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
  `, [
    jobId,
    rootCauseId,
    options.confidence,
    options.detection_method,
    options.llm_model || null,
    options.llm_tokens_used || null,
    options.analysis_duration_ms || null,
    options.raw_analysis || null
  ]);
}

/**
 * Increment occurrence count for a root cause
 */
async function incrementRootCauseOccurrence(rootCauseId) {
  await db.query(`
    UPDATE root_causes 
    SET occurrence_count = occurrence_count + 1,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = $1
  `, [rootCauseId]);
}

/**
 * Get root causes for a job
 */
async function getRootCausesForJob(jobId) {
  const result = await db.query(`
    SELECT 
      jrc.*,
      rc.category,
      rc.title,
      rc.description,
      rc.suggested_fix
    FROM job_root_causes jrc
    JOIN root_causes rc ON jrc.root_cause_id = rc.id
    WHERE jrc.job_id = $1
    ORDER BY jrc.confidence DESC
  `, [jobId]);

  return result.rows;
}

/**
 * Check if a workflow run already exists
 */
async function workflowRunExists(runId) {
  const result = await db.query(
    'SELECT 1 FROM workflow_runs WHERE run_id = $1',
    [runId]
  );
  return result.rows.length > 0;
}

/**
 * Get statistics about root cause detection
 */
async function getRootCauseStats(repository) {
  const result = await db.query(`
    SELECT 
      COUNT(DISTINCT jrc.job_id) as jobs_with_root_cause,
      COUNT(DISTINCT CASE WHEN jrc.detection_method = 'pattern' THEN jrc.job_id END) as pattern_matched,
      COUNT(DISTINCT CASE WHEN jrc.detection_method LIKE 'llm%' THEN jrc.job_id END) as llm_analyzed,
      AVG(jrc.confidence) as avg_confidence,
      SUM(jrc.llm_tokens_used) as total_llm_tokens
    FROM job_root_causes jrc
    JOIN jobs j ON jrc.job_id = j.job_id
    JOIN workflow_runs wr ON j.run_id = wr.run_id
    WHERE wr.repository = $1
  `, [repository]);

  return result.rows[0];
}

module.exports = {
  analyzeJob,
  findOrCreateRootCause,
  linkJobToRootCause,
  incrementRootCauseOccurrence,
  getRootCausesForJob,
  workflowRunExists,
  getRootCauseStats
};

