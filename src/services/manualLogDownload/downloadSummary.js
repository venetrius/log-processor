/*
 * Helper functions for displaying jobs that need manual log downloads
 */

const db = require('../../db/db');

/**
 * Get all workflow runs that have jobs needing manual log downloads
 * @param {string} repository - Repository name
 * @returns {Promise<Array>} Workflow runs with job counts
 */
async function getJobsNeedingManualLogDownload(repository) {
  const query = `
    SELECT 
      wr.run_id,
      wr.run_number,
      wr.workflow_name,
      wr.head_branch,
      wr.html_url as run_url,
      COUNT(j.job_id) as jobs_needing_logs
    FROM workflow_runs wr
    JOIN jobs j ON wr.run_id = j.run_id
    LEFT JOIN job_root_causes jrc ON j.job_id = jrc.job_id
    WHERE wr.repository = $1
      AND j.conclusion = 'failure'
      AND j.logs_accessible = false
      AND (
        jrc.id IS NULL              -- No root cause found
        OR jrc.confidence < 0.8     -- Low confidence TODO move to CONST, consider when it is used: download, call LLM, etc.
      )
    GROUP BY wr.run_id, wr.run_number, wr.workflow_name, wr.head_branch, wr.html_url
    ORDER BY wr.run_number DESC;
  `;

  const result = await db.query(query, [repository]);
  return result.rows;
}

/**
 * Display a summary of workflow runs that need manual log downloads
 * @param {string} repository - Repository name
 */
async function displayManualLogDownloadSummary(repository) {
  const runsNeedingLogs = await getJobsNeedingManualLogDownload(repository);

  if (runsNeedingLogs.length === 0) {
    return; // No jobs need logs
  }

  console.log('\n' + '='.repeat(80));
  console.log('📥 MANUAL LOG DOWNLOADS NEEDED');
  console.log('='.repeat(80));
  console.log('');
  console.log(`${runsNeedingLogs.length} workflow run(s) have jobs that need log files for deeper analysis.`);
  console.log('These jobs either have no root cause or low confidence matches.');
  console.log('');

  const totalJobs = runsNeedingLogs.reduce((sum, run) => sum + parseInt(run.jobs_needing_logs), 0);

  for (const run of runsNeedingLogs) {
    const branch = run.head_branch ? ` [${run.head_branch}]` : '';
    console.log(`📦 ${run.workflow_name}${branch} (Run #${run.run_number})`);
    console.log(`   Jobs needing logs: ${run.jobs_needing_logs}`);
    console.log(`   Download: ${run.run_url}`);
    console.log('');
  }

  console.log('='.repeat(80));
  console.log(`📋 Total: ${totalJobs} job(s) from ${runsNeedingLogs.length} run(s) need logs`);
  console.log('');
  console.log('🔧 How to download:');
  console.log('   1. Click on each Download URL above');
  console.log('   2. Click "Download log archive" in the top-right');
  console.log('   3. Save to ~/Downloads/logs_<suiteId>.zip');
  console.log('   4. Re-run this script to process the logs');
  console.log('='.repeat(80));
  console.log('');
}

module.exports = {
  getJobsNeedingManualLogDownload,
  displayManualLogDownloadSummary
};
