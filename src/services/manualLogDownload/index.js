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
const { execSync } = require('child_process');
const { fetchSuitId } = require('../../ghCommand');
const db = require("../../db/db");
const { updateJobLogsAccessibility } = require('../../db/repositoryExtensions');

const TMP_DOWNLOAD_WORKFLOW_DIR = path.resolve(__dirname, '../../../files/tmp/downloaded-logs');
const FINAL_JOB_DIR = path.resolve(__dirname, '../../../files');
console.log('🗂️ Final job log directory:', FINAL_JOB_DIR);
console.log('🗂️ Temporary download directory:', TMP_DOWNLOAD_WORKFLOW_DIR);
/**
 * Try to find and extract the job log for a given workflow run.
 *
 * - Looks for ~/Downloads/logs_<runId>.zip
 * - Extracts it into TMP_DOWNLOAD_WORKFLOW_DIR/logs_<runId>
 * - Finds the job log by its name (runName)
 * - Copies it to ./files/<jobId>-job.log
 */
async function fetchJobLogs(jobId, runId, runName, repository) {
  const finalJobLogPath = path.join(FINAL_JOB_DIR, `${jobId}-job.log`);

  // 1️⃣ Check if job log already exists
  if (fs.existsSync(finalJobLogPath)) {
    console.debug('✅ Job log already exists:', finalJobLogPath);
    return finalJobLogPath;
  }

  // 2️⃣ Locate downloaded zip
  const suiteId = await fetchSuitId(runId, repository);
  const zipPath = path.resolve(process.env.HOME, `Downloads/logs_${suiteId}.zip`);
  const extractPath = path.join(TMP_DOWNLOAD_WORKFLOW_DIR, `logs_${runId}`);

  if (!fs.existsSync(zipPath)) {
    const workflowUrl = `https://github.com/${repository}/actions/runs/${runId}`;
    // TODO nice to have: collect the download URL and list them at the and of the run, could be saved in the DB as well
    console.warn(`⚠️ Log archive not found at ${zipPath}`);
    console.warn(`Please download it manually from: ${workflowUrl}`);
    return null;
  }

  // 3️⃣ Extract if not already done
  if (!fs.existsSync(extractPath)) {
    console.debug(`📦 Extracting ${zipPath} → ${extractPath}`);
    fs.mkdirSync(extractPath, { recursive: true });
    execSync(`unzip -o "${zipPath}" -d "${extractPath}"`);
  } else {
    console.debug('📁 Logs already extracted:', extractPath);
  }

  // 4️⃣ Find the job log by name
  console.debug(`🔍 Looking for job "${runName}" in ${extractPath}`);
  const dirents = fs.readdirSync(extractPath, { withFileTypes: true });
  const jobFiles = dirents
    .filter(dirent => dirent.isFile())
    .map(dirent => dirent.name);

  // GitHub Actions replaces "/" with " _ " (space-underscore-space) in log filenames
  const normalizedRunName = runName.replace(/\//g, '_');
  // Find matching files (could be multiple if there are numbered prefixes)
  const matchingFiles = jobFiles.filter((f) => {
    // Remove the numbered prefix (e.g., "7_") and .txt extension for comparison
    const normalizedFileName = f.replace(/^\d+_/, '').replace(/\.txt$/, '');
    return normalizedFileName === normalizedRunName;
  });

  if (matchingFiles.length === 0) {
    console.debug(`❌ No log file found for job "${runName}"`);
    console.debug(`   Normalized search: "${normalizedRunName}"`);
    console.debug(`   Available files: ${jobFiles.filter(f => f.endsWith('.txt')).join(', ')}`);
    return null;
  }

  if (matchingFiles.length > 1) {
    console.warn(`⚠️  Multiple log files found for job "${runName}": ${matchingFiles.join(', ')}`);
    console.warn(`   Using first match: ${matchingFiles[0]}`);
  }

  // 5️⃣ Copy the job log
  const jobSourcePath = path.join(extractPath, matchingFiles[0]);
  fs.copyFileSync(jobSourcePath, finalJobLogPath);

  console.debug(`✅ Job log copied to: ${finalJobLogPath} from ${jobSourcePath}`);

  // UPDATE: Mark logs as accessible in database
  try {
    await updateJobLogsAccessibility(jobId, finalJobLogPath, true);
    console.debug(`✅ Database updated: logs_accessible = true for job ${jobId}`);
  } catch (error) {
    console.warn(`⚠️  Could not update logs_accessible for job ${jobId}:`, error.message);
  }

  return finalJobLogPath;
}

module.exports = {
  fetchJobLogs
};

