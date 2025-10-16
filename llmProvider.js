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

const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);
const fs = require('fs').promises;
const path = require('path');

/**
 * Abstract base class for LLM providers
 */
class LLMProvider {
  constructor(config = {}) {
    this.config = config;
    this.tokenUsage = { input: 0, output: 0, total: 0 };
  }

  /**
   * Analyze error annotations and return root cause analysis
   * @param {Array} errorAnnotations - Error annotations from GitHub
   * @param {Array} failedSteps - Failed step information
   * @param {Object} context - Additional context (job name, workflow, etc.)
   * @returns {Promise<Object>} Analysis result with confidence score
   */
  async analyzeRootCause(errorAnnotations, failedSteps, context = {}) {
    throw new Error('analyzeRootCause must be implemented by subclass');
  }

  /**
   * Get token usage statistics
   */
  getTokenUsage() {
    return { ...this.tokenUsage };
  }

  /**
   * Reset token usage counters
   */
  resetTokenUsage() {
    this.tokenUsage = { input: 0, output: 0, total: 0 };
  }
}

/**
 * GitHub Copilot provider via opencode CLI
 */
class GitHubCopilotProvider extends LLMProvider {
  constructor(config = {}) {
    super(config);
    this.model = config.model || 'gpt-4o';
    this.maxTokens = config.maxTokens || 1000;
    this.temperature = config.temperature || 0.1;
  }

  async analyzeRootCause(errorAnnotations, failedSteps, context = {}) {
    const startTime = Date.now();

    // Prepare the prompt
    const prompt = this._buildPrompt(errorAnnotations, failedSteps, context);

    // Create temporary files for opencode
    const tempDir = path.join(__dirname, 'temp');
    await fs.mkdir(tempDir, { recursive: true });

    const promptFile = path.join(tempDir, `prompt-${Date.now()}.txt`);
    const responseFile = path.join(tempDir, `response-${Date.now()}.json`);

    try {
      // Write prompt to file
      await fs.writeFile(promptFile, prompt);

      // Call opencode CLI
      const command = `npx @sst/opencode "${promptFile}" --model ${this.model} --max-tokens ${this.maxTokens} --temperature ${this.temperature} --output "${responseFile}"`;

      console.log(`   🤖 Calling GitHub Copilot...`);
      await execAsync(command, {
        timeout: 60000, // 60 second timeout
        maxBuffer: 1024 * 1024 // 1MB buffer
      });

      // Read and parse response
      const responseText = await fs.readFile(responseFile, 'utf8');
      const analysis = this._parseResponse(responseText);

      // Update token usage (estimated for Copilot)
      this._estimateTokenUsage(prompt, analysis.raw_response || '');

      // Clean up temp files
      await fs.unlink(promptFile).catch(() => {});
      await fs.unlink(responseFile).catch(() => {});

      return {
        ...analysis,
        provider: 'github-copilot',
        model: this.model,
        duration_ms: Date.now() - startTime
      };

    } catch (error) {
      // Clean up temp files on error
      await fs.unlink(promptFile).catch(() => {});
      await fs.unlink(responseFile).catch(() => {});

      throw new Error(`GitHub Copilot analysis failed: ${error.message}`);
    }
  }

  _buildPrompt(errorAnnotations, failedSteps, context) {
    return `You are an expert DevOps engineer analyzing GitHub Actions workflow failures. 

CONTEXT:
- Job: ${context.jobName || 'Unknown'}
- Workflow: ${context.workflowName || 'Unknown'}
- Repository: ${context.repository || 'Unknown'}

ERROR ANNOTATIONS:
${errorAnnotations.map(ann => `- ${ann.title || ann.message}`).join('\n')}

FAILED STEPS:
${failedSteps.map(step => `- ${step.name}: ${step.conclusion}`).join('\n')}

Please analyze this failure and provide a root cause analysis in this exact JSON format:

{
  "category": "one of: build, test, deployment, dependency, infrastructure, authentication, timeout, resource",
  "title": "concise root cause title (max 80 chars)",
  "description": "detailed explanation of what went wrong",
  "confidence": 0.85,
  "suggested_fix": "actionable fix recommendation",
  "reasoning": "brief explanation of your analysis"
}

Focus on the most likely root cause. Confidence should be 0.0-1.0 where 1.0 is completely certain.`;
  }

  _parseResponse(responseText) {
    try {
      // Try to extract JSON from the response
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in response');
      }

      const analysis = JSON.parse(jsonMatch[0]);

      // Validate required fields
      const required = ['category', 'title', 'description', 'confidence'];
      for (const field of required) {
        if (!(field in analysis)) {
          throw new Error(`Missing required field: ${field}`);
        }
      }

      // Ensure confidence is a number between 0 and 1
      analysis.confidence = Math.max(0, Math.min(1, parseFloat(analysis.confidence) || 0));

      return {
        ...analysis,
        raw_response: responseText
      };

    } catch (error) {
      console.warn(`   ⚠️  Failed to parse LLM response: ${error.message}`);
      return {
        category: 'unknown',
        title: 'Analysis parsing failed',
        description: 'Could not parse LLM response into expected format',
        confidence: 0.1,
        suggested_fix: 'Review error logs manually',
        reasoning: `Parse error: ${error.message}`,
        raw_response: responseText
      };
    }
  }

  _estimateTokenUsage(prompt, response) {
    // Rough estimation: ~4 characters per token
    const inputTokens = Math.ceil(prompt.length / 4);
    const outputTokens = Math.ceil(response.length / 4);

    this.tokenUsage.input += inputTokens;
    this.tokenUsage.output += outputTokens;
    this.tokenUsage.total += inputTokens + outputTokens;
  }
}

/**
 * Mock provider for testing (returns dummy analysis)
 */
class MockLLMProvider extends LLMProvider {
  async analyzeRootCause(errorAnnotations, failedSteps, context = {}) {
    // Simulate API delay
    await new Promise(resolve => setTimeout(resolve, 100));

    return {
      category: 'test',
      title: 'Mock analysis - test failure detected',
      description: 'This is a mock analysis for testing purposes',
      confidence: 0.75,
      suggested_fix: 'This is a mock suggestion',
      reasoning: 'Mock analysis based on error patterns',
      provider: 'mock',
      model: 'mock-v1',
      duration_ms: 100
    };
  }
}

/**
 * Factory function to create LLM provider instances
 */
function createLLMProvider(providerType = 'github-copilot', config = {}) {
  switch (providerType.toLowerCase()) {
    case 'github-copilot':
    case 'copilot':
      return new GitHubCopilotProvider(config);

    case 'mock':
    case 'test':
      return new MockLLMProvider(config);

    default:
      throw new Error(`Unknown LLM provider: ${providerType}`);
  }
}

module.exports = {
  LLMProvider,
  GitHubCopilotProvider,
  MockLLMProvider,
  createLLMProvider
};
