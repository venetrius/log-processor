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

const fs = require('fs');
const path = require('path');

/**
 * Hardcoded configuration for simplified processor
 * Modify these values directly in this file
 */
const HARDCODED_CONFIG = {
  repository: "venetrius/log-processor",
  logsDirectory: "./files",
  workflows: [
    {
      name: "Test Workflow",
      branch: "master",
      enabled: true,
      fetchLastRuns: 3,
      workflowFileName: "test-workflow.yml"
    }
  ]
};

/**
 * Loads simplified configuration
 * Returns hardcoded config from this file
 * @returns {Object} Simplified configuration object
 */
function loadSimplifiedConfig() {
  return { ...HARDCODED_CONFIG };
}

/**
 * Validates simplified configuration
 * @param {Object} config - Simplified configuration object
 * @returns {boolean} True if valid, false otherwise
 */
function validateSimplifiedConfig(config) {
  return true;
}

/**
 * Ensures the logs directory exists
 * @param {string} dirPath - Directory path
 */
function ensureLogsDirectory(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
    console.log(`📁 Created logs directory: ${dirPath}`);
  }
}

/**
 * Checks if a log file already exists
 * @param {string} jobId - Job ID
 * @param {string} logsDir - Logs directory path
 * @returns {boolean} True if exists, false otherwise
 */
function logFileExists(jobId, logsDir) {
  const logPath = path.join(logsDir, `${jobId}-job.log`);
  return fs.existsSync(logPath);
}

/**
 * Displays current configuration summary
 * @param {Object} config - Simplified configuration
 */
function displayConfigSummary(config) {
  console.log('📋 Configuration Summary:');
  console.log(`   Repository: ${config.repository}`);
  console.log(`   Logs Directory: ${config.logsDirectory}`);
  console.log(`   Enabled Workflows: ${config.workflows.filter(w => w.enabled).length}`);

  config.workflows.filter(w => w.enabled).forEach(workflow => {
    console.log(`     • ${workflow.name} (${workflow.branch})`);
    console.log(`       File: ${workflow.workflowFileName}`);
    console.log(`       Fetch: ${workflow.fetchLastRuns} run(s)`);
  });
  console.log('');
}

module.exports = {
  loadSimplifiedConfig,
  validateSimplifiedConfig,
  ensureLogsDirectory,
  logFileExists,
  displayConfigSummary,
  HARDCODED_CONFIG
};

