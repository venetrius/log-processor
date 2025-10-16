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

const execAsync = util.promisify(exec);

async function runGhCommand(command, skipParse) {
  try {
    const { stdout } = await execAsync(command, { maxBuffer: 1024 * 1024 * 50 });
    if(skipParse) {
        return stdout;
    }
    const issues = JSON.parse(stdout);
    return issues;
  } catch (error) {
    console.error('Command failed:', error);
  }
}

function runCommandToFile(command, outputPath) {
  return new Promise((resolve, reject) => {
    const child = exec(command, { maxBuffer: 1024 * 1024 * 50 });

    const output = fs.createWriteStream(outputPath);
    child.stdout.pipe(output);
    child.stderr.pipe(process.stderr);

    child.on("error", reject);

    child.on("close", (code) => {
      output.end(); // ensure stream closes
      output.on("finish", () => {
        console.log(`Command finished with code ${code}`);
        if (code === 0) resolve(outputPath);
        else reject(new Error(`Command exited with code ${code}`));
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
