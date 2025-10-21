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

const db = require('../../db/db');

/**
 * Data aggregator for generating reports
 */

/**
 * Get executive summary statistics
 * @param {Object} options - Filter options
 * @returns {Promise<Object>} Summary statistics
 */
async function getExecutiveSummary(options = {}) {
  const { startDate, endDate, workflows, repository } = options;

  let whereConditions = [];
  let params = [];
  let paramCount = 0;

  if (repository) {
    params.push(repository);
    whereConditions.push(`wr.repository = $${++paramCount}`);
  }

  if (startDate) {
    params.push(startDate);
    whereConditions.push(`wr.created_at >= $${++paramCount}`);
  }

  if (endDate) {
    params.push(endDate);
    whereConditions.push(`wr.created_at <= $${++paramCount}`);
  }

  if (workflows && workflows.length > 0) {
    params.push(workflows);
    whereConditions.push(`wr.workflow_file_name = ANY($${++paramCount})`);
  }

  const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';

  const query = `
    SELECT 
      COUNT(DISTINCT wr.run_id) as total_runs,
      COUNT(DISTINCT CASE WHEN wr.conclusion = 'success' THEN wr.run_id END) as successful_runs,
      COUNT(DISTINCT CASE WHEN wr.conclusion = 'failure' THEN wr.run_id END) as failed_runs,
      COUNT(DISTINCT j.job_id) as total_jobs,
      COUNT(DISTINCT CASE WHEN j.conclusion = 'failure' THEN j.job_id END) as failed_jobs,
      COUNT(DISTINCT js.id) FILTER (WHERE js.conclusion = 'failure') as failed_steps,
      MIN(wr.created_at) as earliest_run,
      MAX(wr.created_at) as latest_run
    FROM workflow_runs wr
    LEFT JOIN jobs j ON wr.run_id = j.run_id
    LEFT JOIN job_steps js ON j.job_id = js.job_id
    ${whereClause}
  `;

  const result = await db.query(query, params);
  return result.rows[0];
}

/**
 * Get top root causes across all failures
 * @param {Object} options - Filter options
 * @param {number} limit - Number of results
 * @returns {Promise<Array>} Top root causes
 */
async function getTopRootCauses(options = {}, limit = 10) {
  const { startDate, endDate, workflows, repository, minConfidence } = options;

  let whereConditions = [];
  let params = [limit];
  let paramCount = 1;

  if (repository) {
    params.push(repository);
    whereConditions.push(`wr.repository = $${++paramCount}`);
  }

  if (startDate) {
    params.push(startDate);
    whereConditions.push(`wr.created_at >= $${++paramCount}`);
  }

  if (endDate) {
    params.push(endDate);
    whereConditions.push(`wr.created_at <= $${++paramCount}`);
  }

  if (workflows && workflows.length > 0) {
    params.push(workflows);
    whereConditions.push(`wr.workflow_file_name = ANY($${++paramCount})`);
  }

  if (minConfidence) {
    params.push(minConfidence);
    whereConditions.push(`jrc.confidence >= $${++paramCount}`);
  }

  const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';

  const query = `
    WITH latest_root_causes AS (
      SELECT DISTINCT ON (jrc.job_id)
        jrc.job_id,
        jrc.root_cause_id,
        jrc.confidence,
        jrc.created_at
      FROM job_root_causes jrc
      ORDER BY jrc.job_id, jrc.created_at DESC
    )
    SELECT 
      rc.id,
      rc.category,
      rc.title,
      rc.description,
      rc.suggested_fix,
      COUNT(DISTINCT lrc.job_id) as occurrence_count,
      AVG(lrc.confidence) as avg_confidence,
      MAX(wr.created_at) as last_seen,
      STRING_AGG(DISTINCT j.job_name, ', ' ORDER BY j.job_name) as affected_jobs
    FROM root_causes rc
    JOIN latest_root_causes lrc ON rc.id = lrc.root_cause_id
    JOIN jobs j ON lrc.job_id = j.job_id
    JOIN workflow_runs wr ON j.run_id = wr.run_id
    ${whereClause}
    GROUP BY rc.id, rc.category, rc.title, rc.description, rc.suggested_fix
    ORDER BY occurrence_count DESC
    LIMIT $1
  `;

  const result = await db.query(query, params);
  return result.rows;
}

/**
 * Get workflow-branch combinations with their runs
 * @param {Object} options - Filter options
 * @returns {Promise<Array>} Workflow-branch data
 */
async function getWorkflowBranchData(options = {}) {
  const { startDate, endDate, workflows, branches, repository, includeSuccessfulRuns = false } = options;

  let whereConditions = [];
  let params = [];
  let paramCount = 0;

  if (repository) {
    params.push(repository);
    whereConditions.push(`wr.repository = $${++paramCount}`);
  }

  if (startDate) {
    params.push(startDate);
    whereConditions.push(`wr.created_at >= $${++paramCount}`);
  }

  if (endDate) {
    params.push(endDate);
    whereConditions.push(`wr.created_at <= $${++paramCount}`);
  }

  if (workflows && workflows.length > 0) {
    params.push(workflows);
    whereConditions.push(`wr.workflow_file_name = ANY($${++paramCount})`);
  }

  if (branches && branches.length > 0) {
    params.push(branches);
    whereConditions.push(`wr.head_branch = ANY($${++paramCount})`);
  }

  if (!includeSuccessfulRuns) {
    whereConditions.push(`wr.conclusion != 'success' OR wr.conclusion IS NULL`);
  }

  const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';

  const query = `
    SELECT 
      wr.run_id,
      wr.run_number,
      wr.workflow_name,
      wr.workflow_file_name,
      wr.repository,
      wr.head_branch,
      wr.status,
      wr.conclusion,
      wr.html_url,
      wr.created_at,
      wr.updated_at,
      COUNT(DISTINCT j.job_id) as total_jobs,
      COUNT(DISTINCT CASE WHEN j.conclusion = 'failure' THEN j.job_id END) as failed_jobs,
      COUNT(DISTINCT js.id) FILTER (WHERE js.conclusion = 'failure') as failed_steps
    FROM workflow_runs wr
    LEFT JOIN jobs j ON wr.run_id = j.run_id
    LEFT JOIN job_steps js ON j.job_id = js.job_id
    ${whereClause}
    GROUP BY wr.run_id, wr.run_number, wr.workflow_name, wr.workflow_file_name, 
             wr.repository, wr.head_branch, wr.status, wr.conclusion, 
             wr.html_url, wr.created_at, wr.updated_at
    ORDER BY wr.created_at DESC
  `;

  const result = await db.query(query, params);
  return result.rows;
}

/**
 * Get step failure summary for a workflow-branch combination
 * @param {Object} options - Filter options
 * @returns {Promise<Array>} Step failure summary
 */
async function getStepFailureSummary(options = {}) {
  const { startDate, endDate, workflows, branches, repository } = options;

  let whereConditions = [];
  let params = [];
  let paramCount = 0;

  if (repository) {
    params.push(repository);
    whereConditions.push(`wr.repository = $${++paramCount}`);
  }

  if (startDate) {
    params.push(startDate);
    whereConditions.push(`wr.created_at >= $${++paramCount}`);
  }

  if (endDate) {
    params.push(endDate);
    whereConditions.push(`wr.created_at <= $${++paramCount}`);
  }

  if (workflows && workflows.length > 0) {
    params.push(workflows);
    whereConditions.push(`wr.workflow_file_name = ANY($${++paramCount})`);
  }

  if (branches && branches.length > 0) {
    params.push(branches);
    whereConditions.push(`wr.head_branch = ANY($${++paramCount})`);
  }

  whereConditions.push(`js.conclusion = 'failure'`);

  const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';

  const query = `
    WITH latest_root_causes AS (
      SELECT DISTINCT ON (jrc.job_id)
        jrc.job_id,
        jrc.root_cause_id,
        jrc.confidence,
        jrc.created_at
      FROM job_root_causes jrc
      ORDER BY jrc.job_id, jrc.created_at DESC
    )
    SELECT 
      js.step_name,
      j.job_name,
      COUNT(*) as failure_count,
      MAX(wr.created_at) as last_failure,
      ARRAY_AGG(DISTINCT rc.title ORDER BY rc.title) FILTER (WHERE rc.title IS NOT NULL) as root_causes,
      ARRAY_AGG(DISTINCT rc.category ORDER BY rc.category) FILTER (WHERE rc.category IS NOT NULL) as root_cause_categories
    FROM job_steps js
    JOIN jobs j ON js.job_id = j.job_id
    JOIN workflow_runs wr ON j.run_id = wr.run_id
    LEFT JOIN latest_root_causes lrc ON j.job_id = lrc.job_id
    LEFT JOIN root_causes rc ON lrc.root_cause_id = rc.id
    ${whereClause}
    GROUP BY js.step_name, j.job_name
    ORDER BY failure_count DESC, last_failure DESC
  `;

  const result = await db.query(query, params);
  return result.rows;
}

/**
 * Get detailed failure information for a specific run
 * @param {number} runId - Run ID
 * @returns {Promise<Object>} Detailed failure data
 */
async function getRunDetails(runId) {
  const query = `
    SELECT 
      j.job_id,
      j.job_name,
      j.status,
      j.conclusion,
      j.started_at,
      lrc.confidence,
      lrc.detection_method
      js.id as step_id,
      js.step_name,
      js.step_number,
    LEFT JOIN latest_root_causes lrc ON j.job_id = lrc.job_id
    LEFT JOIN root_causes rc ON lrc.root_cause_id = rc.id
      js.started_at as step_started_at,
      js.completed_at as step_completed_at,
      ea.id as annotation_id,
      ea.annotation_level,
      ea.message as annotation_message,
      ea.path as annotation_path,
      ea.title as annotation_title,
      rc.id as root_cause_id,
      rc.category as root_cause_category,
      rc.title as root_cause_title,
      rc.suggested_fix,
      jrc.confidence,
      jrc.detection_method
    FROM jobs j
    LEFT JOIN job_steps js ON j.job_id = js.job_id
    LEFT JOIN error_annotations ea ON j.job_id = ea.job_id
    LEFT JOIN job_root_causes jrc ON j.job_id = jrc.job_id
    LEFT JOIN root_causes rc ON jrc.root_cause_id = rc.id
    WHERE j.run_id = $1
    ORDER BY j.job_id, js.step_number, ea.id
  `;

  const result = await db.query(query, [runId]);

  // Transform flat results into nested structure
  const jobs = {};

  result.rows.forEach(row => {
    if (!jobs[row.job_id]) {
      jobs[row.job_id] = {
        job_id: row.job_id,
        job_name: row.job_name,
        status: row.status,
        conclusion: row.conclusion,
        started_at: row.started_at,
        completed_at: row.completed_at,
        html_url: row.html_url,
        steps: {},
        annotations: [],
        root_causes: []
      };
    }

    const job = jobs[row.job_id];

    // Add step
    if (row.step_id && !job.steps[row.step_id]) {
      job.steps[row.step_id] = {
        step_id: row.step_id,
        step_name: row.step_name,
        step_number: row.step_number,
        status: row.step_status,
        conclusion: row.step_conclusion,
        started_at: row.step_started_at,
        completed_at: row.step_completed_at
      };
    }

    // Add annotation
    if (row.annotation_id && !job.annotations.find(a => a.id === row.annotation_id)) {
      job.annotations.push({
        id: row.annotation_id,
        level: row.annotation_level,
        message: row.annotation_message,
        path: row.annotation_path,
        title: row.annotation_title
      });
    }

    // Add root cause
    if (row.root_cause_id && !job.root_causes.find(rc => rc.id === row.root_cause_id)) {
      job.root_causes.push({
        id: row.root_cause_id,
        category: row.root_cause_category,
        title: row.root_cause_title,
        suggested_fix: row.suggested_fix,
        confidence: row.confidence,
        detection_method: row.detection_method
      });
    }
  });

  // Convert steps object to array
  Object.values(jobs).forEach(job => {
    job.steps = Object.values(job.steps);
  });

  return Object.values(jobs);
}

module.exports = {
  getExecutiveSummary,
  getTopRootCauses,
  getWorkflowBranchData,
  getStepFailureSummary,
  getRunDetails,
};
