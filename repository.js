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

/**
 * Repository for database operations
 */

/**
 * Inserts or updates a workflow run
 * @param {Object} runData - Workflow run data
 * @returns {Promise<Object>} Inserted/updated run
 */
async function upsertWorkflowRun(runData) {
  const query = `
    INSERT INTO workflow_runs (
      run_id, run_number, workflow_name, workflow_file_name,
      repository, status, conclusion, html_url, created_at, updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    ON CONFLICT (run_id) 
    DO UPDATE SET
      status = EXCLUDED.status,
      conclusion = EXCLUDED.conclusion,
      updated_at = EXCLUDED.updated_at,
      fetched_at = CURRENT_TIMESTAMP
    RETURNING *;
  `;

  const values = [
    runData.id,
    runData.run_number,
    runData.name || runData.workflow_name,
    runData.path || runData.workflow_file_name,
    runData.repository?.full_name || runData.repository,
    runData.status,
    runData.conclusion,
    runData.html_url,
    runData.created_at,
    runData.updated_at
  ];

  const result = await db.query(query, values);
  return result.rows[0];
}

/**
 * Inserts or updates a job
 * @param {Object} jobData - Job data
 * @returns {Promise<Object>} Inserted/updated job
 */
async function upsertJob(jobData) {
  const query = `
    INSERT INTO jobs (
      job_id, run_id, job_name, status, conclusion,
      started_at, completed_at, html_url, log_file_path
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    ON CONFLICT (job_id)
    DO UPDATE SET
      status = EXCLUDED.status,
      conclusion = EXCLUDED.conclusion,
      completed_at = EXCLUDED.completed_at,
      log_file_path = EXCLUDED.log_file_path,
      fetched_at = CURRENT_TIMESTAMP
    RETURNING *;
  `;

  const values = [
    jobData.id,
    jobData.run_id,
    jobData.name,
    jobData.status,
    jobData.conclusion,
    jobData.started_at,
    jobData.completed_at,
    jobData.html_url,
    jobData.log_file_path || null
  ];

  const result = await db.query(query, values);
  return result.rows[0];
}

/**
 * Inserts a job step
 * @param {Object} stepData - Step data
 * @returns {Promise<Object>} Inserted step
 */
async function insertJobStep(stepData) {
  const query = `
    INSERT INTO job_steps (
      job_id, step_name, step_number, status, conclusion,
      started_at, completed_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7)
    ON CONFLICT DO NOTHING
    RETURNING *;
  `;

  const values = [
    stepData.job_id,
    stepData.name,
    stepData.number,
    stepData.status,
    stepData.conclusion,
    stepData.started_at,
    stepData.completed_at
  ];

  const result = await db.query(query, values);
  return result.rows[0];
}

/**
 * Inserts an error annotation
 * @param {Object} annotationData - Annotation data
 * @returns {Promise<Object>} Inserted annotation
 */
async function insertErrorAnnotation(annotationData) {
  const query = `
    INSERT INTO error_annotations (
      job_id, annotation_level, message, path,
      start_line, end_line, title, raw_details
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    RETURNING *;
  `;

  const values = [
    annotationData.job_id,
    annotationData.annotation_level,
    annotationData.message,
    annotationData.path || null,
    annotationData.start_line || null,
    annotationData.end_line || null,
    annotationData.title || null,
    annotationData.raw_details ? JSON.stringify(annotationData.raw_details) : null
  ];

  const result = await db.query(query, values);
  return result.rows[0];
}

/**
 * Get all failed jobs for a repository
 * @param {string} repository - Repository name (owner/repo)
 * @param {number} limit - Number of results to return
 * @returns {Promise<Array>} Failed jobs
 */
async function getFailedJobs(repository, limit = 50) {
  const query = `
    SELECT 
      j.*,
      wr.workflow_name,
      wr.run_number,
      wr.created_at as run_created_at
    FROM jobs j
    JOIN workflow_runs wr ON j.run_id = wr.run_id
    WHERE wr.repository = $1
      AND j.conclusion = 'failure'
    ORDER BY j.completed_at DESC
    LIMIT $2;
  `;

  const result = await db.query(query, [repository, limit]);
  return result.rows;
}

/**
 * Get error annotations for a job
 * @param {number} jobId - Job ID
 * @returns {Promise<Array>} Error annotations
 */
async function getErrorAnnotationsForJob(jobId) {
  const query = `
    SELECT * FROM error_annotations
    WHERE job_id = $1
    ORDER BY created_at DESC;
  `;

  const result = await db.query(query, [jobId]);
  return result.rows;
}

/**
 * Get failure statistics for a repository
 * @param {string} repository - Repository name
 * @returns {Promise<Object>} Statistics
 */
async function getFailureStats(repository) {
  const query = `
    SELECT 
      COUNT(DISTINCT wr.run_id) as total_runs,
      COUNT(DISTINCT CASE WHEN wr.conclusion = 'failure' THEN wr.run_id END) as failed_runs,
      COUNT(DISTINCT j.job_id) as total_jobs,
      COUNT(DISTINCT CASE WHEN j.conclusion = 'failure' THEN j.job_id END) as failed_jobs,
      COUNT(ea.id) as total_error_annotations
    FROM workflow_runs wr
    LEFT JOIN jobs j ON wr.run_id = j.run_id
    LEFT JOIN error_annotations ea ON j.job_id = ea.job_id
    WHERE wr.repository = $1;
  `;

  const result = await db.query(query, [repository]);
  return result.rows[0];
}

/**
 * Get most frequently failing jobs
 * @param {string} repository - Repository name
 * @param {number} limit - Number of results
 * @returns {Promise<Array>} Top failing jobs
 */
async function getTopFailingJobs(repository, limit = 10) {
  const query = `
    SELECT 
      j.job_name,
      COUNT(*) as failure_count,
      MAX(j.completed_at) as last_failure
    FROM jobs j
    JOIN workflow_runs wr ON j.run_id = wr.run_id
    WHERE wr.repository = $1
      AND j.conclusion = 'failure'
    GROUP BY j.job_name
    ORDER BY failure_count DESC
    LIMIT $2;
  `;

  const result = await db.query(query, [repository, limit]);
  return result.rows;
}

module.exports = {
  upsertWorkflowRun,
  upsertJob,
  insertJobStep,
  insertErrorAnnotation,
  getFailedJobs,
  getErrorAnnotationsForJob,
  getFailureStats,
  getTopFailingJobs
};

