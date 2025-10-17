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

const util = require('util');
const { exec } = require('child_process');
const fs = require("fs");
const cacheService = require('./services/cacheGHCLI');
const { loadConfig } = require('./configLoader');

const execAsync = util.promisify(exec);

// Initialize cache based on config
const config = loadConfig();
cacheService.setCacheEnabled(config.cacheGHRequests || false);

async function runGhCommand(command, skipParse) {
  // Check cache first
  const cached = await cacheService.getCachedResponse(command);
  if (cached) {
    return cached.is_json && !skipParse ? JSON.parse(cached.response) : cached.response;
  }

  // Execute command if not cached
  try {
    const { stdout } = await execAsync(command, { maxBuffer: 1024 * 1024 * 50 });

    // Cache the response
    await cacheService.setCachedResponse(command, stdout, !skipParse);

    if(skipParse) {
        return stdout;
    }
    const issues = JSON.parse(stdout);
    return issues;
  } catch (error) {
    console.error('Command failed:', error);
  }
}

async function runCommandToFile(command, outputPath) {
  // Check cache first
  const cached = await cacheService.getCachedResponse(command);
  if (cached) {
    // Write cached response to file
    await fs.promises.writeFile(outputPath, cached.response);
    console.log(`💾 Restored from cache to: ${outputPath}`);
    return outputPath;
  }

  // Execute command if not cached
  return new Promise((resolve, reject) => {
    const child = exec(command, { maxBuffer: 1024 * 1024 * 50 });

    let responseData = '';
    const output = fs.createWriteStream(outputPath);

    child.stdout.on('data', (chunk) => {
      responseData += chunk;
    });

    child.stdout.pipe(output);
    child.stderr.pipe(process.stderr);

    child.on("error", reject);

    child.on("close", async (code) => {
      output.end(); // ensure stream closes
      output.on("finish", async () => {
        console.log(`Command finished with code ${code}`);
        if (code === 0) {
          // Cache the response
          await cacheService.setCachedResponse(command, responseData, false);
          resolve(outputPath);
        } else {
          reject(new Error(`Command exited with code ${code}`));
        }
      });
    });
  });
}

async function fetchSuitId(runId, repository) {
  const command = `gh api /repos/${repository}/actions/runs/${runId} --jq .check_suite_id`;
  const { stdout } = await execAsync(command, { maxBuffer: 1024 * 50 });
  console.log({stdout})
  return stdout.trim();
}

module.exports = { fetchSuitId, runGhCommand, runCommandToFile };

