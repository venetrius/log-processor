/*
 * Repository extensions for lazy loading optimization
 * Additional methods to support the logs_accessible column
 */

const db = require('./db');

/**
 * Update job with log file path and accessibility status
 * @param {number} jobId - Job ID
 * @param {string} logPath - Path to the log file
 * @param {boolean} accessible - Whether logs were successfully downloaded
 * @returns {Promise<Object>} Updated job
 */
async function updateJobLogsAccessibility(jobId, logPath, accessible) {
  const query = `
    UPDATE jobs 
    SET log_file_path = $1, 
        logs_accessible = $2,
        fetched_at = CURRENT_TIMESTAMP
    WHERE job_id = $3
    RETURNING *;
  `;

  const result = await db.query(query, [logPath, accessible, jobId]);
  return result.rows[0];
}

/**
 * Get jobs that need log download (low confidence or no root cause)
 * @param {string} repository - Repository name
 * @param {number} limit - Number of jobs to return
 * @returns {Promise<Array>} Jobs needing log download
 */
async function getJobsNeedingLogs(repository, limit = 50) {
  const query = `
    SELECT DISTINCT j.*
    FROM jobs j
    JOIN workflow_runs wr ON j.run_id = wr.run_id
    LEFT JOIN job_root_causes jrc ON j.job_id = jrc.job_id
    WHERE wr.repository = $1
      AND j.conclusion = 'failure'
      AND j.logs_accessible = false
      AND (
        jrc.id IS NULL 
        OR jrc.confidence < 0.8
        OR jrc.detection_method = 'pattern'
      )
    ORDER BY j.completed_at DESC
    LIMIT $2;
  `;

  const result = await db.query(query, [repository, limit]);
  return result.rows;
}

/**
 * Check if a job has logs accessible
 * @param {number} jobId - Job ID
 * @returns {Promise<boolean>} True if logs are accessible
 */
async function areLogsAccessible(jobId) {
  const query = `
    SELECT logs_accessible, log_file_path
    FROM jobs
    WHERE job_id = $1;
  `;

  const result = await db.query(query, [jobId]);
  if (result.rows.length === 0) return false;

  return result.rows[0].logs_accessible && result.rows[0].log_file_path !== null;
}

/**
 * Check if a workflow run has jobs that need log downloads
 * Returns true if any failed jobs in the run have logs_accessible=false
 * AND either have no root cause or have low confidence root cause
 * @param {string} runId - Workflow run ID
 * @returns {Promise<boolean>} True if logs are needed for reprocessing
 */
async function runHasJobsNeedingLogs(runId) {
  const query = `
    SELECT COUNT(*) as count
    FROM jobs j
    LEFT JOIN job_root_causes jrc ON j.job_id = jrc.job_id
    WHERE j.run_id = $1
      AND j.conclusion = 'failure'
      AND j.logs_accessible = false
      AND (
        jrc.id IS NULL                          -- No root cause found yet
        OR jrc.confidence < 0.8                 -- Low confidence (needs LLM)
      );
  `;

  const result = await db.query(query, [runId]);
  return parseInt(result.rows[0].count) > 0;
}

module.exports = {
  updateJobLogsAccessibility,
  getJobsNeedingLogs,
  areLogsAccessible,
  runHasJobsNeedingLogs
};
