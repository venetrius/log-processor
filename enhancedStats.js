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

/*
 * Enhanced Root Cause Statistics
 * Provides comprehensive statistics including unmatched jobs
 */

const db = require('./db');

/**
 * Get detailed statistics about root cause detection including unmatched jobs
 */
async function getRootCauseStatsDetailed(repository) {
  const result = await db.query(`
    SELECT 
      -- Jobs with root causes detected
      COUNT(DISTINCT jrc.job_id) as jobs_with_root_cause,
      COUNT(DISTINCT CASE WHEN jrc.detection_method = 'pattern' THEN jrc.job_id END) as pattern_matched,
      COUNT(DISTINCT CASE WHEN jrc.detection_method LIKE 'llm%' THEN jrc.job_id END) as llm_analyzed,
      AVG(jrc.confidence) as avg_confidence,
      SUM(jrc.llm_tokens_used) as total_llm_tokens,
      
      -- Total failed jobs (for calculating unmatched)
      COUNT(DISTINCT CASE WHEN j.conclusion IN ('failure', 'cancelled', 'timed_out') THEN j.job_id END) as total_failed_jobs,
      
      -- Jobs with errors but no root cause match
      COUNT(DISTINCT CASE 
        WHEN j.conclusion IN ('failure', 'cancelled', 'timed_out') 
        AND jrc.job_id IS NULL 
        THEN j.job_id 
      END) as jobs_without_root_cause,
      
      -- Jobs that have error annotations but no root cause
      COUNT(DISTINCT CASE 
        WHEN ea.job_id IS NOT NULL 
        AND jrc.job_id IS NULL 
        THEN j.job_id 
      END) as jobs_with_errors_no_match
      
    FROM jobs j
    JOIN workflow_runs wr ON j.run_id = wr.run_id
    LEFT JOIN job_root_causes jrc ON j.job_id = jrc.job_id
    LEFT JOIN error_annotations ea ON j.job_id = ea.job_id
    WHERE wr.repository = $1
  `, [repository]);

  const stats = result.rows[0];

  // Calculate match rate
  const matchRate = stats.total_failed_jobs > 0
    ? (stats.jobs_with_root_cause / stats.total_failed_jobs * 100).toFixed(1)
    : '0.0';

  return {
    ...stats,
    match_rate_percent: parseFloat(matchRate)
  };
}

/**
 * Get a list of unmatched failed jobs for further analysis
 */
async function getUnmatchedFailedJobs(repository, limit = 10) {
  const result = await db.query(`
    SELECT 
      j.job_id,
      j.job_name,
      j.conclusion,
      wr.run_id,
      wr.workflow_name,
      j.html_url,
      COUNT(ea.id) as error_annotation_count,
      COUNT(js.id) as failed_step_count
    FROM jobs j
    JOIN workflow_runs wr ON j.run_id = wr.run_id
    LEFT JOIN job_root_causes jrc ON j.job_id = jrc.job_id
    LEFT JOIN error_annotations ea ON j.job_id = ea.job_id
    LEFT JOIN job_steps js ON j.job_id = js.job_id AND js.conclusion = 'failure'
    WHERE wr.repository = $1
      AND j.conclusion IN ('failure', 'cancelled', 'timed_out')
      AND jrc.job_id IS NULL
    GROUP BY j.job_id, j.job_name, j.conclusion, wr.run_id, wr.workflow_name, j.html_url
    ORDER BY j.completed_at DESC
    LIMIT $2
  `, [repository, limit]);

  return result.rows;
}

module.exports = {
  getRootCauseStatsDetailed,
  getUnmatchedFailedJobs
};
