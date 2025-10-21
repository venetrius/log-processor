/*
 * Lazy Loading Implementation for Log Downloads
 * New parseJobs function that downloads logs only when needed
 */

const { analyzeJobPatternOnly } = require('./services/rootCauseServiceExtensions');
const { updateJobLogsAccessibility } = require('./db/repositoryExtensions');

/**
 * Process jobs with lazy loading optimization
 * Flow:
 * 1. Store job + errors + steps (without logs)
 * 2. Run pattern-only analysis
 * 3. Download logs only if pattern confidence is low or LLM is needed
 * 4. Run full analysis if logs were downloaded
 */
async function parseJobsLazy(jobs, runId, config, dependencies) {
    const {
        getErrorAnnotations,
        downloadJobLog,
        repository,
        rootCauseService
    } = dependencies;

    for (const job of jobs) {
        const jobId = job.id;

        if (job.conclusion !== 'success' && job.conclusion !== 'skipped') {
            console.log(`❌ FAILED - ${job.name}`);

            // Get error annotations
            const errorAnnotations = await getErrorAnnotations(jobId);
            errorAnnotations.forEach(element => {
                console.log(`   --- ${element.message}`);
            });

            // Display failed steps
            const failedSteps = job.steps.filter(step => step.conclusion === 'failure');
            failedSteps.forEach(step => {
                console.log(`   --------- ${step.name} failed`);
            });

            // Store job in database WITHOUT logs (logs_accessible=false)
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
                    log_file_path: null,
                    logs_accessible: false
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

                // PHASE 1: Pattern-only analysis (fast, no logs needed)
                console.log(`   🔍 Running pattern-only analysis...`);
                const patternResult = await analyzeJobPatternOnly(jobId, errorAnnotations, failedSteps);

                console.log(`   📊 Pattern confidence: ${(patternResult.confidence * 100).toFixed(1)}% (${patternResult.duration}ms)`);

                // Determine if we need logs
                const llmEnabled = config.llm?.enabled;
                const confidenceThreshold = config.llm?.confidenceThreshold || 0.8;
                const needsLogs = patternResult.needsLogs ||
                                (llmEnabled && patternResult.confidence < confidenceThreshold);

                if (needsLogs && config.downloadLogs) {
                    console.log(`   ⚡ Pattern confidence low - downloading logs for LLM analysis...`);

                    // PHASE 2: Download logs (only when needed)
                    const logPath = await downloadJobLog(runId, jobId, job.name, config);

                    // Update job with log path
                    if (logPath) {
                        await updateJobLogsAccessibility(jobId, logPath, true);
                        console.log(`   ✅ Logs downloaded and marked accessible`);

                        // PHASE 3: Full analysis with logs
                        if (llmEnabled) {
                            console.log(`   🤖 Running full LLM analysis...`);
                            await rootCauseService.analyzeJob(job.id, errorAnnotations, failedSteps, {
                                jobName: job.name,
                                workflowName: config.workflowName || 'Unknown',
                                repository: config.repository
                            });
                        }
                    } else {
                        await updateJobLogsAccessibility(jobId, null, false);
                        console.log(`   ⚠️  Log download failed - marked as inaccessible`);
                    }
                } else if (needsLogs && !config.downloadLogs) {
                    console.log(`   ⏭️  Logs needed but download disabled`);
                } else {
                    console.log(`   ✅ Pattern match sufficient - skipping log download`);
                    if (patternResult.rootCause) {
                        console.log(`   🎯 Root cause: ${patternResult.rootCause.title}`);
                    }
                }

            } catch (dbError) {
                console.error(`   ⚠️  Database error for job ${jobId}:`, dbError.message);
            }
        }
    }
}

module.exports = {
    parseJobsLazy
};

