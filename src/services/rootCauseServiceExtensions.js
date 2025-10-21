/*
 * Root Cause Service Extensions for Lazy Loading
 * Provides pattern-only analysis method
 */

const { matchPattern } = require('../patternMatcher');
const db = require('../db/db');

/**
 * Analyze a job using only pattern matching (no LLM, no logs needed)
 * Used for lazy loading optimization - runs immediately without downloading logs
 * @param {number} jobId - Job ID
 * @param {Array} errorAnnotations - Error annotations from GitHub
 * @param {Array} failedSteps - Failed steps
 * @returns {Promise<Object>} Analysis result with confidence score
 */
async function analyzeJobPatternOnly(jobId, errorAnnotations, failedSteps) {
  const startTime = Date.now();

  // Run pattern matching
  const patternMatch = matchPattern(errorAnnotations, failedSteps);

  if (!patternMatch) {
    return {
      status: 'no_pattern_match',
      confidence: 0,
      needsLogs: true,
      duration: Date.now() - startTime
    };
  }

  // Check if this is a generic failure (needs LLM)
  if (patternMatch.category === 'generic_failure') {
    return {
      status: 'generic_failure',
      confidence: patternMatch.confidence,
      needsLogs: true,
      duration: Date.now() - startTime,
      patternMatch
    };
  }

  // We have a specific pattern match - store it
  const duration = Date.now() - startTime;
  const rootCause = await findOrCreateRootCause(patternMatch);

  await linkJobToRootCause(jobId, rootCause.id, {
    confidence: patternMatch.confidence,
    detection_method: 'pattern',
    analysis_duration_ms: duration,
    raw_analysis: JSON.stringify({ patternMatch })
  });

  await incrementRootCauseOccurrence(rootCause.id);
  await updateLastSeen(rootCause.id);

  return {
    status: 'pattern_success',
    confidence: patternMatch.confidence,
    needsLogs: false,
    rootCause,
    duration
  };
}

/* Helper functions - duplicated from rootCauseService for now */

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

async function updateLastSeen(rootCauseId) {
  await db.query(
    `UPDATE root_causes 
     SET last_seen_at = CURRENT_TIMESTAMP
     WHERE id = $1`,
    [rootCauseId]
  );
}

module.exports = {
  analyzeJobPatternOnly
};

