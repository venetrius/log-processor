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

const DEFAULT_CONFIG = {
  repository: null,
  downloadLogs: true,
  forceDownload: false,
  logsDirectory: "./files",
  workflows: [],
  singleRun: {
    enabled: true,
    url: ""
  }
};

/**
 * Loads configuration from config.json
 * @returns {Object} Configuration object
 */
function loadConfig() {
  const configPath = path.join(__dirname, 'config.json');
  let config = {};
  if (!fs.existsSync(configPath)) {
    console.errpr('❌ config.json not found, using defaults');
    process.exit(-1);
  }

  try {
    const configData = fs.readFileSync(configPath, 'utf8');
    config = JSON.parse(configData);
    return { ...DEFAULT_CONFIG, ...config };
  } catch (error) {
    console.error('❌ Failed to parse config.json:', error.message);
    process.exit(-1);
  }
}

/**
 * Validates configuration
 * @param {Object} config
 * @returns {boolean}
 */
function validateConfig(config) {
  if (!config.repository && config.workflows.length === 0) {
    console.error('❌ Config error: No repository specified');
    return false;
  }

  if (!config.singleRun.enabled && config.workflows.filter(w => w.enabled).length === 0) {
    console.warn('⚠️  Warning: No workflows enabled and singleRun is disabled');
    return false;
  }

  return true;
}

/**
 * Ensures the logs directory exists
 * @param {string} dirPath
 */
function ensureLogsDirectory(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
    console.log(`📁 Created logs directory: ${dirPath}`);
  }
}

/**
 * Checks if a log file already exists
 * @param {string} jobId
 * @param {string} logsDir
 * @returns {boolean}
 */
function logFileExists(jobId, logsDir) {
  const logPath = path.join(logsDir, `${jobId}-job.log`);
  return fs.existsSync(logPath);
}

module.exports = {
  loadConfig,
  validateConfig,
  ensureLogsDirectory,
  logFileExists,
  DEFAULT_CONFIG
};

