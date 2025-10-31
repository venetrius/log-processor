#!/usr/bin/env node

/*
 * Simplified Log Processor
 *
 * This script:
 * 1. Reads workflow configuration from config.json (or environment variables)
 * 2. Fetches workflow runs from GitHub (including from the same repository)
 * 3. Downloads job logs for all runs (even if passed)
 *
 * No processing or analysis is performed - just log collection.
 */

const fs = require('fs');
const path = require('path');
const { runGhCommand, runCommandToFile } = require('./ghCommand.js');
const {
  loadSimplifiedConfig,
  validateSimplifiedConfig,
  ensureLogsDirectory,
  displayConfigSummary
} = require('./simplifiedConfigLoader.js');

/**
 * Fetches workflow runs for a specific workflow
 * @param {string} repository - Repository in format "owner/repo"
 * @param {string} workflowFileName - Workflow file name (e.g., "ci.yml")
 * @param {string} branch - Branch name
 * @param {number} limit - Number of runs to fetch
 * @returns {Promise<Array>} Array of workflow runs
 */
async function fetchWorkflowRuns(repository, workflowFileName, branch, limit = 5) {
  console.log(`📥 Fetching ${limit} runs for ${workflowFileName} on branch ${branch}...`);

  const command = `gh api repos/${repository}/actions/workflows/${workflowFileName}/runs?branch=${branch}&per_page=${limit} --jq '.workflow_runs'`;

  try {
    const runs = await runGhCommand(command);
    console.log(`   ✅ Found ${runs.length} runs\n`);
    return runs;
  } catch (error) {
    console.error(`   ❌ Failed to fetch workflow runs:`, error.message);
    return [];
  }
}

/**
 * Fetches jobs for a workflow run
 * @param {string} repository - Repository in format "owner/repo"
 * @param {string} runId - Workflow run ID
 * @returns {Promise<Array>} Array of jobs
 */
async function fetchRunJobs(repository, runId) {
  const command = `gh api repos/${repository}/actions/runs/${runId}/jobs --jq '.jobs'`;

  try {
    const jobs = await runGhCommand(command);
    return jobs;
  } catch (error) {
    console.error(`   ❌ Failed to fetch jobs for run ${runId}:`, error.message);
    return [];
  }
}

/**
 * Downloads log for a specific job
 * @param {string} repository - Repository in format "owner/repo"
 * @param {string} runId - Workflow run ID
 * @param {string} jobId - Job ID
 * @param {string} jobName - Job name (for display)
 * @param {string} logsDirectory - Directory to save logs
 * @returns {Promise<string|null>} Path to the log file or null if failed
 */
async function downloadJobLog(repository, runId, jobId, jobName, logsDirectory) {
  const logPath = path.join(logsDirectory, `${jobId}-job.log`);

  // Check if log already exists
  if (fs.existsSync(logPath)) {
    console.log(`   ℹ️  Log already exists: ${logPath} (skipping download)`);
    return logPath;
  }

  console.log(`   ⬇️  Downloading log for job: ${jobName} (${jobId})...`);

  try {
    const command = `gh run view ${runId} --job ${jobId} --log --repo ${repository}`;
    await runCommandToFile(command, logPath);
    console.log(`   💾 Saved log to ${logPath}`);
    return logPath;
  } catch (error) {
    console.error(`   ❌ Failed to download log for job ${jobId}:`, error.message);
    return null;
  }
}

/**
 * Processes a single workflow run
 * @param {string} repository - Repository in format "owner/repo"
 * @param {Object} run - Workflow run object
 * @param {string} logsDirectory - Directory to save logs
 */
async function processWorkflowRun(repository, run, logsDirectory) {
  const runId = run.id;
  const runNumber = run.run_number;
  const status = run.status;
  const conclusion = run.conclusion;
  const createdAt = new Date(run.created_at).toLocaleString();

  console.log(`\n${'='.repeat(80)}`);
  console.log(`🔄 Processing Run #${runNumber} (ID: ${runId})`);
  console.log(`   Status: ${status} | Conclusion: ${conclusion || 'N/A'}`);
  console.log(`   Created: ${createdAt}`);
  console.log(`   URL: ${run.html_url}`);
  console.log(`${'='.repeat(80)}\n`);

  // Fetch jobs for this run
  const jobs = await fetchRunJobs(repository, runId);

  if (jobs.length === 0) {
    console.log(`   ⚠️  No jobs found for this run\n`);
    return {
      runId,
      runNumber,
      status,
      conclusion,
      jobsProcessed: 0,
      logsDownloaded: 0
    };
  }

  console.log(`   📋 Found ${jobs.length} job(s) in this run\n`);

  let logsDownloaded = 0;

  // Process each job - download logs regardless of status
  for (const job of jobs) {
    const jobStatus = job.conclusion || job.status;
    const statusEmoji = job.conclusion === 'success' ? '✅' :
                       job.conclusion === 'failure' ? '❌' :
                       job.conclusion === 'cancelled' ? '🚫' :
                       job.conclusion === 'skipped' ? '⏭️' : '⏳';

    console.log(`${statusEmoji} Job: ${job.name} (${jobStatus})`);

    const logPath = await downloadJobLog(repository, runId, job.id, job.name, logsDirectory);

    if (logPath) {
      logsDownloaded++;
    }

    console.log('');
  }

  console.log(`✨ Run #${runNumber} complete: ${logsDownloaded}/${jobs.length} logs downloaded\n`);

  return {
    runId,
    runNumber,
    status,
    conclusion,
    jobsProcessed: jobs.length,
    logsDownloaded
  };
}

/**
 * Processes a workflow configuration
 * @param {Object} workflowConfig - Workflow configuration object
 * @param {string} repository - Repository in format "owner/repo"
 * @param {string} logsDirectory - Directory to save logs
 */
async function processWorkflow(workflowConfig, repository, logsDirectory) {
  console.log(`\n${'#'.repeat(80)}`);
  console.log(`# Processing Workflow: ${workflowConfig.name}`);
  console.log(`# Repository: ${repository}`);
  console.log(`# Branch: ${workflowConfig.branch}`);
  console.log(`# Workflow File: ${workflowConfig.workflowFileName}`);
  console.log(`${'#'.repeat(80)}\n`);

  // Fetch workflow runs
  const runs = await fetchWorkflowRuns(
    repository,
    workflowConfig.workflowFileName,
    workflowConfig.branch,
    workflowConfig.fetchLastRuns || 5
  );

  if (runs.length === 0) {
    console.log(`⚠️  No runs found for workflow ${workflowConfig.name}\n`);
    return {
      workflow: workflowConfig.name,
      runsProcessed: 0,
      totalJobs: 0,
      totalLogs: 0
    };
  }

  // Process each run
  const results = [];
  for (const run of runs) {
    const result = await processWorkflowRun(repository, run, logsDirectory);
    results.push(result);
  }

  // Calculate summary
  const summary = {
    workflow: workflowConfig.name,
    branch: workflowConfig.branch,
    runsProcessed: results.length,
    totalJobs: results.reduce((sum, r) => sum + r.jobsProcessed, 0),
    totalLogs: results.reduce((sum, r) => sum + r.logsDownloaded, 0)
  };

  console.log(`\n${'='.repeat(80)}`);
  console.log(`📊 Workflow Summary: ${workflowConfig.name}`);
  console.log(`   Runs Processed: ${summary.runsProcessed}`);
  console.log(`   Total Jobs: ${summary.totalJobs}`);
  console.log(`   Total Logs Downloaded: ${summary.totalLogs}`);
  console.log(`${'='.repeat(80)}\n`);

  return summary;
}

/**
 * Generates a processing report
 * @param {Array} summaries - Array of workflow summaries
 * @param {string} reportsDirectory - Directory to save report
 */
function generateReport(summaries, reportsDirectory) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const reportPath = path.join(reportsDirectory, `processing-report-${timestamp}.json`);

  const report = {
    timestamp: new Date().toISOString(),
    totalWorkflows: summaries.length,
    totalRuns: summaries.reduce((sum, s) => sum + s.runsProcessed, 0),
    totalJobs: summaries.reduce((sum, s) => sum + s.totalJobs, 0),
    totalLogs: summaries.reduce((sum, s) => sum + s.totalLogs, 0),
    workflows: summaries
  };

  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`📄 Report saved to ${reportPath}\n`);

  return report;
}

/**
 * Main function
 */
async function main() {
  console.log(`\n${'*'.repeat(80)}`);
  console.log(`* SIMPLIFIED LOG PROCESSOR`);
  console.log(`* Started at: ${new Date().toLocaleString()}`);
  console.log(`${'*'.repeat(80)}\n`);

  // Load simplified configuration
  const config = loadSimplifiedConfig();

  // Validate configuration
  if (!validateSimplifiedConfig(config)) {
    console.error('❌ Configuration validation failed. Please fix the errors above.\n');
    process.exit(1);
  }

  // Display configuration summary
  displayConfigSummary(config);

  // Ensure directories exist
  ensureLogsDirectory(config.logsDirectory);
  const reportsDirectory = './reports';
  if (!fs.existsSync(reportsDirectory)) {
    fs.mkdirSync(reportsDirectory, { recursive: true });
  }

  // Check for environment variable overrides (from workflow inputs)
  const workflowFile = process.env.WORKFLOW_FILE;
  const branch = process.env.BRANCH;
  const fetchRuns = process.env.FETCH_RUNS;

  let workflowsToProcess = [];

  if (workflowFile) {
    // Use workflow input parameters
    console.log(`📝 Using workflow inputs:\n`);
    console.log(`   Workflow File: ${workflowFile || 'from config'}`);
    console.log(`   Branch: ${branch || 'from config'}`);
    console.log(`   Fetch Runs: ${fetchRuns || 'from config'}\n`);

    workflowsToProcess = [{
      name: workflowFile,
      workflowFileName: workflowFile,
      branch: branch || config.workflows[0]?.branch || 'master',
      fetchLastRuns: parseInt(fetchRuns) || 5,
      enabled: true
    }];
  } else {
    // Use workflows from config.json
    workflowsToProcess = config.workflows.filter(w => w.enabled);
    console.log(`📝 Using workflows from config.json\n`);
  }

  if (workflowsToProcess.length === 0) {
    console.error(`❌ No workflows configured or enabled in config.json\n`);
    process.exit(1);
  }

  // Get repository from config or environment
  const repository = config.repository;

  if (!repository) {
    console.error(`❌ No repository configured in config.json\n`);
    process.exit(1);
  }

  console.log(`🎯 Target Repository: ${repository}\n`);
  console.log(`📦 Logs Directory: ${config.logsDirectory}\n`);
  console.log(`🔧 Workflows to Process: ${workflowsToProcess.length}\n`);

  // Process each workflow
  const summaries = [];
  for (const workflowConfig of workflowsToProcess) {
    const summary = await processWorkflow(workflowConfig, repository, config.logsDirectory);
    summaries.push(summary);
  }

  // Generate final report
  console.log(`\n${'*'.repeat(80)}`);
  console.log(`* FINAL SUMMARY`);
  console.log(`${'*'.repeat(80)}\n`);

  const report = generateReport(summaries, reportsDirectory);

  console.log(`✅ Total Workflows Processed: ${report.totalWorkflows}`);
  console.log(`✅ Total Runs Processed: ${report.totalRuns}`);
  console.log(`✅ Total Jobs Processed: ${report.totalJobs}`);
  console.log(`✅ Total Logs Downloaded: ${report.totalLogs}\n`);

  console.log(`${'*'.repeat(80)}`);
  console.log(`* COMPLETED at: ${new Date().toLocaleString()}`);
  console.log(`${'*'.repeat(80)}\n`);
}

// Run the main function
if (require.main === module) {
  main().catch(error => {
    console.error(`\n❌ Fatal error:`, error);
    process.exit(1);
  });
}

module.exports = {
  fetchWorkflowRuns,
  fetchRunJobs,
  downloadJobLog,
  processWorkflowRun,
  processWorkflow
};

