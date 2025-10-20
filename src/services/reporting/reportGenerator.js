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

const fs = require('fs').promises;
const path = require('path');
const dataAggregator = require('./dataAggregator');
const htmlBuilder = require('./htmlBuilder');

/**
 * Main report generator module
 */

/**
 * Default report options
 */
const DEFAULT_OPTIONS = {
  outputPath: './reports',
  filename: null, // Auto-generate if not provided
  includeSuccessfulRuns: false,
  maxRunsPerWorkflow: 50,
  minConfidenceThreshold: 0.0,
  groupBy: 'workflow-branch',
  workflows: [],
  branches: [],
  repository: null,
  startDate: null,
  endDate: null,
};

/**
 * Generate a complete HTML report
 * @param {Object} options - Report generation options
 * @returns {Promise<Object>} Report metadata
 */
async function generate(options = {}) {
  console.log('📊 Starting report generation...');

  // Merge with defaults
  const config = { ...DEFAULT_OPTIONS, ...options };

  try {
    // Step 1: Gather data
    console.log('📦 Aggregating data from database...');
    const data = await aggregateData(config);

    // Step 2: Generate HTML
    console.log('🎨 Building HTML report...');
    const html = htmlBuilder.generateHTML(data, config);

    // Step 3: Write to file
    console.log('💾 Writing report to file...');
    const filePath = await writeReport(html, config);

    // Step 4: Generate summary
    const summary = {
      filePath,
      generatedAt: new Date().toISOString(),
      stats: {
        totalRuns: data.summary.total_runs,
        failedRuns: data.summary.failed_runs,
        successfulRuns: data.summary.successful_runs,
        topRootCauses: data.topRootCauses.length,
        workflowsAnalyzed: data.workflowData.length,
      }
    };

    console.log('✅ Report generated successfully!');
    console.log(`📄 Report location: ${filePath}`);
    console.log(`📊 Total runs analyzed: ${summary.stats.totalRuns}`);
    console.log(`❌ Failed runs: ${summary.stats.failedRuns}`);
    console.log(`✅ Successful runs: ${summary.stats.successfulRuns}`);

    return summary;

  } catch (error) {
    console.error('❌ Error generating report:', error);
    throw error;
  }
}

/**
 * Aggregate all necessary data for the report
 * @param {Object} config - Report configuration
 * @returns {Promise<Object>} Aggregated data
 */
async function aggregateData(config) {
  const filterOptions = {
    repository: config.repository,
    startDate: config.startDate,
    endDate: config.endDate,
    workflows: config.workflows,
    branches: config.branches,
    includeSuccessfulRuns: config.includeSuccessfulRuns,
    minConfidence: config.minConfidenceThreshold,
  };

  // Fetch all data in parallel
  const [summary, topRootCauses, workflowData, stepFailures] = await Promise.all([
    dataAggregator.getExecutiveSummary(filterOptions),
    dataAggregator.getTopRootCauses(filterOptions, 10),
    dataAggregator.getWorkflowBranchData(filterOptions),
    dataAggregator.getStepFailureSummary(filterOptions),
  ]);

  return {
    summary,
    topRootCauses,
    workflowData,
    stepFailures,
  };
}

/**
 * Write report HTML to file
 * @param {string} html - HTML content
 * @param {Object} config - Report configuration
 * @returns {Promise<string>} File path
 */
async function writeReport(html, config) {
  // Ensure output directory exists
  await fs.mkdir(config.outputPath, { recursive: true });

  // Generate filename if not provided
  let filename = config.filename;
  if (!filename) {
    const timestamp = new Date().toISOString().split('T')[0];
    filename = `workflow-report-${timestamp}.html`;
  }

  // Ensure .html extension
  if (!filename.endsWith('.html')) {
    filename += '.html';
  }

  const filePath = path.join(config.outputPath, filename);

  // Write file
  await fs.writeFile(filePath, html, 'utf8');

  return filePath;
}

/**
 * Generate a report for a specific time range
 * @param {number} days - Number of days to look back
 * @param {Object} options - Additional options
 * @returns {Promise<Object>} Report metadata
 */
async function generateForLastDays(days, options = {}) {
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  return generate({
    ...options,
    startDate: startDate.toISOString().split('T')[0],
    endDate: endDate.toISOString().split('T')[0],
  });
}

/**
 * Generate a report for a specific workflow
 * @param {string} workflowName - Workflow file name
 * @param {Object} options - Additional options
 * @returns {Promise<Object>} Report metadata
 */
async function generateForWorkflow(workflowName, options = {}) {
  return generate({
    ...options,
    workflows: [workflowName],
  });
}

/**
 * Generate a report for a specific branch
 * @param {string} branchName - Branch name
 * @param {Object} options - Additional options
 * @returns {Promise<Object>} Report metadata
 */
async function generateForBranch(branchName, options = {}) {
  return generate({
    ...options,
    branches: [branchName],
  });
}

module.exports = {
  generate,
  generateForLastDays,
  generateForWorkflow,
  generateForBranch,
};

