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

const util = require("util");
const { exec } = require("child_process");
const fs = require("fs").promises;
const cacheService = require("./services/cacheGHCLI");
const { loadConfig } = require("./configLoader");

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

  try {
    const { stdout } = await execAsync(command, {
      maxBuffer: 1024 * 1024 * 50,
      encoding: "utf8",
    });

    await cacheService.setCachedResponse(command, stdout, !skipParse);

    return skipParse ? stdout : JSON.parse(stdout);
  } catch (error) {
    console.error("Command failed:", error);
    throw error;
  }
}

async function runCommandToFile(command, outputPath) {
  const cached = await cacheService.getCachedResponse(command);
  if (cached) {
    await fs.writeFile(outputPath, cached.response, "utf8");
    console.log(`✅ Restored from cache to: ${outputPath}`);
    return outputPath;
  }

  try {
    const { stdout, stderr } = await execAsync(command, {
      maxBuffer: 1024 * 1024 * 50,
      encoding: "utf8",
    });

    const stdoutStr = stringifyOutput(stdout);
    const stderrStr = stringifyOutput(stderr);

    if (stderrStr.trim().length > 0) {
      console.warn("⚠️ Command produced stderr output:\n", stderrStr);
    }

    await fs.writeFile(outputPath, stdoutStr, "utf8");
    console.log(`💾 Output written to: ${outputPath}`);

    await cacheService.setCachedResponse(command, stdoutStr, false);
    return outputPath;
  } catch (error) {
    console.error(`❌ Command failed: ${command}`);
    console.error(error);
    throw error;
  }
}

function stringifyOutput(output) {
  if (output == null) return "";
  if (typeof output === "string") return output;
  if (Buffer.isBuffer(output)) return output.toString("utf8");
  try {
    return JSON.stringify(output, null, 2);
  } catch {
    return String(output);
  }
}

async function fetchSuitId(runId, repository) {
  const command = `gh api /repos/${repository}/actions/runs/${runId} --jq .check_suite_id`;
  const { stdout } = await execAsync(command, {
    maxBuffer: 1024 * 50,
    encoding: "utf8",
  });
  console.log({ stdout });
  return stdout.trim();
}

module.exports = { fetchSuitId, runGhCommand, runCommandToFile };

