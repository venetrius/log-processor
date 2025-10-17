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

// const fs = require('fs');
// const path = require('path');

const { runGhCommand, runCommandToFile } = require('./ghCommand.js')
const { loadConfig, validateConfig, ensureLogsDirectory, logFileExists } = require('./configLoader.js')
const db = require('./db/db.js')
const repository = require('./db/repository.js')
const enhancedStats = require('./enhancedStats.js')
const rootCauseService = require('./services/rootCauseService')
const { createLLMClient } = require('./llm/llmClient')
const { PromptBuilder } = require('./llm/promptBuilder')
const { fetchJobLogs } = require('./services/manualLogDownload/index')

const getErrorAnnotations = async jobId => {
    const { repository: orgAndRepo }  = loadConfig();
    const command = `gh api repos/${orgAndRepo}/check-runs/${jobId}/annotations`;
    const annotations = await runGhCommand(command);
    // console.debug({jobId, annotations})
    return annotations.filter(({annotation_level}) => annotation_level === "failure")
}

/**
 * Downloads job log if needed based on configuration
 * @param {string} runId
 * @param {string} jobId - The job ID
 * @param {string}  jobName
 * @param {Object} config - Configuration object
 * @returns {string|null} Path to the log file or null if not downloaded
 */
const downloadJobLog = async (runId, jobId, jobName, config) => {
    if (!config.downloadLogs) {
        console.log(`   ⏭️  Log download disabled\n`);
        return null;
    }

    const logPath = `${config.logsDirectory}/${jobId}-job.log`;

    // Skip download if file exists and forceDownload is false
    if (!config.forceDownload && logFileExists(jobId, config.logsDirectory)) {
        console.log(`   ℹ️  Log already exists: ${logPath} (skipping download)\n`);
        return logPath;
    }


    console.log(`   ⬇️  Downloading log for job ${jobId}...`);
    const manualLogPath = await fetchJobLogs(jobId, runId, jobName, config.repository);
    // TODO would be better to use gh command directly, but it fails with large logs or maybe need more permission?
    // const downloadLogCommand = `gh run view ${runId} --job ${jobId} --log --repo ${config.repository}`;
    // console.log(downloadLogCommand)
    // await runCommandToFile(downloadLogCommand, logPath);

    //  TODO reconsider this - temporary workaround anyway though
    console.log(manualLogPath ? `   💾 Saved log to ${logPath}\n` : manualLogPath);
    return manualLogPath;
}

const parseJobs = async (jobs, runId, config) => {
    let job = null
    for(job of jobs) {
        const jobId = job.id
        // status: 'completed',
        // conclusion: 'success',
        if(job.conclusion !== 'success' && job.conclusion !== 'skipped') {
            console.log(`❌ FAILED - ${job.name}`)

            // Get error annotations
            const errorAnnotations = await getErrorAnnotations(jobId)
            errorAnnotations.forEach(element => {
                console.log(`   --- ${element.message}`)
            });

            // Display failed steps
            const failedSteps = job.steps.filter(step => step.conclusion === 'failure');
            failedSteps.forEach(step => {
                console.log(`   --------- ${step.name} failed`)
            });

            // Download log if configured
            const logPath = await downloadJobLog(runId, jobId, job.name, config);

            // Store job in database
            try {
                await repository.upsertJob({
                    id: job.id,
                    run_id: runId,
                    name: job.name,
                    status: job.status,
                    conclusion: job.conclusion,
                    started_at: job.started_at,
                    completed_at: job.completed_at,
                    html_url: job.html_url,
                    log_file_path: logPath
                });

                // Store failed steps
                for (const step of failedSteps) {
                    await repository.insertJobStep({
                        job_id: job.id,
                        name: step.name,
                        number: step.number,
                        status: step.status,
                        conclusion: step.conclusion,
                        started_at: step.started_at,
                        completed_at: step.completed_at
                    });
                }

                // Store error annotations
                for (const annotation of errorAnnotations) {
                    await repository.insertErrorAnnotation({
                        job_id: job.id,
                        annotation_level: annotation.annotation_level,
                        message: annotation.message,
                        path: annotation.path,
                        start_line: annotation.start_line,
                        end_line: annotation.end_line,
                        title: annotation.title,
                        raw_details: annotation
                    });
                }

                // Analyze root cause with context
                await rootCauseService.analyzeJob(job.id, errorAnnotations, failedSteps, {
                    jobName: job.name,
                    workflowName: config.workflowName || 'Unknown',
                    repository: config.repository
                });
            } catch (dbError) {
                console.error(`   ⚠️  Database error for job ${jobId}:`, dbError.message);
            }
        }
    }
}

const loadLogs = async (url, config, runData = null) => {
    const match = url.match(/\/actions\/runs\/(\d+)/);
    const runId = match ? match[1] : null;

    const exists = await rootCauseService.workflowRunExists(runId);
    if (exists) {
      console.log(`⏭️  Run ${runId} already processed, skipping...`);
      return;
    }

    console.log(`\n🔍 Processing run ID: ${runId}`)

    // Store workflow run in database if we have the data
    if (runData) {
        try {
            await repository.upsertWorkflowRun({
                id: runData.id,
                run_number: runData.run_number,
                workflow_name: runData.name,
                workflow_file_name: runData.path,
                repository: config.repository,
                status: runData.status,
                conclusion: runData.conclusion,
                html_url: runData.html_url,
                created_at: runData.created_at,
                updated_at: runData.updated_at
            });
        } catch (dbError) {
            console.error(`   ⚠️  Database error for run ${runId}:`, dbError.message);
        }
    }

    const command = `gh api repos/${config.repository}/actions/runs/${runId}/jobs`
    const jobs = await runGhCommand(command)

    await parseJobs(jobs.jobs, runId, config)
}

/**
 * Fetches the last N workflow runs for a specific workflow
 * @param {string} workflowFileName - The workflow file name (e.g., "ci.yml")
 * @param {number} count - Number of runs to fetch
 * @param {Object} config - Configuration object
 * @param {string|null} branch - Optional branch name to filter runs
 * @returns {Promise<Array>} Array of workflow runs
 */
const getWorkflowRuns = async (workflowFileName, count, config, branch = null) => {
    const branchInfo = branch ? ` (branch: ${branch})` : '';
    console.log(`\n📋 Fetching last ${count} runs for workflow: ${workflowFileName}${branchInfo}`)

    let command = `gh api repos/${config.repository}/actions/workflows/${workflowFileName}/runs?per_page=${count}`;
    if (branch) {
        command += `&branch=${branch}`;
    }

    const response = await runGhCommand(command);
    return response.workflow_runs || [];
}

/**
 * Main function to process all configured sources
 */
const processAll = async () => {
    const config = loadConfig();

    if (!validateConfig(config)) {
        console.error('❌ Invalid configuration. Please check your config.json');
        process.exit(1);
    }

    ensureLogsDirectory(config.logsDirectory);

    // Test database connection
    console.log('\n🔌 Testing database connection...');
    const dbConnected = await db.testConnection();
    if (!dbConnected) {
        console.warn('⚠️  Database connection failed. Continuing without database persistence.');
    }

    // Initialize LLM integration if enabled
    if (config.llm && config.llm.enabled) {
        console.log('\n🤖 Initializing LLM integration...');
        console.log(`   Provider: ${config.llm.provider}`);
        console.log(`   Model: ${config.llm.model}`);
        console.log(`   Confidence threshold: ${config.llm.confidenceThreshold}`);

        try {
            const llmClient = createLLMClient(config.llm);
            const promptBuilder = new PromptBuilder();

            rootCauseService.initialize({
                llmClient,
                promptBuilder,
                options: {
                    enableLLM: true,
                    confidenceThreshold: config.llm.confidenceThreshold || 0.8
                }
            });
            console.log('   ✅ LLM integration initialized');
        } catch (error) {
            console.error(`   ⚠️  LLM initialization failed: ${error.message}`);
            console.log('   Continuing with pattern-only analysis...');
        }
    } else {
        // Initialize service with LLM disabled
        const promptBuilder = new PromptBuilder();
        rootCauseService.initialize({
            llmClient: null,
            promptBuilder,
            options: { enableLLM: false }
        });
    }

    console.log(`\n🚀 Log Processor Started`);
    console.log(`📦 Repository: ${config.repository}`);
    console.log(`💾 Download logs: ${config.downloadLogs ? 'Yes' : 'No'}`);
    console.log(`🔄 Force download: ${config.forceDownload ? 'Yes' : 'No'}`);
    console.log(`🤖 LLM Analysis: ${config.llm?.enabled ? 'Enabled' : 'Disabled'}`);

    // Process single run if enabled
    if (config.singleRun.enabled && config.singleRun.url) {
        console.log(`\n━━━ Single Run Mode ━━━`);

        // Extract run ID and fetch run data
        const match = config.singleRun.url.match(/\/actions\/runs\/(\d+)/);
        const runId = match ? match[1] : null;

        if (runId) {
            try {
                const command = `gh api repos/${config.repository}/actions/runs/${runId}`;
                const runData = await runGhCommand(command);
                await loadLogs(config.singleRun.url, config, runData);
            } catch (error) {
                console.error(`   ⚠️  Could not fetch run data: ${error.message}`);
                await loadLogs(config.singleRun.url, config);
            }
        } else {
            await loadLogs(config.singleRun.url, config);
        }
    }

    // Process configured workflows
    const enabledWorkflows = config.workflows.filter(w => w.enabled);
    if (enabledWorkflows.length > 0) {
        console.log(`\n━━━ Workflow Monitoring Mode ━━━`);

        for (const workflow of enabledWorkflows) {
            console.log(`\n📊 Workflow: ${workflow.name}`);
            const runs = await getWorkflowRuns(
                workflow.workflowFileName,
                workflow.fetchLastRuns,
                config,
                workflow.branch || null
            );

            for (const run of runs) {
                const url = run.html_url;
                const status = run.conclusion || run.status;
                console.log(`\n  Run #${run.run_number} - Status: ${status} - ${new Date(run.created_at).toLocaleString()}`);

                if (run.conclusion === 'failure') {
                    await loadLogs(url, config, run);
                } else {
                    console.log(`  ✅ Run succeeded, skipping`);
                }
            }
        }
    }

    console.log(`\n✨ Processing complete!`);

    // Display statistics if database is connected
    // TODO: connect to DB only if stats or persistence is enabled
    // TODO: move stats display to separate module
    if (dbConnected) {
        try {
            console.log(`\n📊 Database Statistics:`);
            const stats = await repository.getFailureStats(config.repository);
            console.log(`   Total runs tracked: ${stats.total_runs}`);
            console.log(`   Failed runs: ${stats.failed_runs}`);
            console.log(`   Failed jobs: ${stats.failed_jobs}`);
            console.log(`   Error annotations: ${stats.total_error_annotations}`);
            console.log(`\n🎯 Root Cause Analysis:`);
            const rcStats = await enhancedStats.getRootCauseStatsDetailed(config.repository);
            console.log(`   Jobs analyzed: ${rcStats.jobs_with_root_cause || 0}`);
            console.log(`   Pattern matched: ${rcStats.pattern_matched || 0}`);
            console.log(`   Jobs without match: ${rcStats.jobs_without_root_cause || 0}`);
            console.log(`   Jobs w/ errors (no match): ${rcStats.jobs_with_errors_no_match || 0}`);
            console.log(`   Total failed jobs: ${rcStats.total_failed_jobs || 0}`);
            console.log(`   Match rate: ${rcStats.match_rate_percent || 0}%`);
            console.log(`   Avg confidence: ${parseFloat(rcStats.avg_confidence || 0).toFixed(2)}`);
        } catch (error) {
            console.error('   ⚠️  Could not fetch statistics:', error.message);
        }
    }
}

// Run the processor
processAll().catch(error => {
    console.error('❌ Fatal error:', error.message);
    process.exit(1);
}).finally(async () => {
    // Close database connection pool
    await db.end();
});

