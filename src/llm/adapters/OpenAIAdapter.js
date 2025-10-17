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
/*
 * OpenAI Adapter - Real LLM integration
 *
 * Uses OpenAI API (api.openai.com)
 * Official OpenAI endpoint as of 2025
 * Requires OPENAI_API_KEY environment variable
 */

const https = require('https');

class OpenAIAdapter {
  constructor(config = {}) {
    this.config = config;
    this.model = config.model || 'gpt-4o';
    this.maxTokens = config.maxTokens || 1000;
    this.temperature = config.temperature || 0.1;
    this.timeout = config.timeout || 60000;

    // Check for OpenAI API key
    this.apiKey = process.env.OPENAI_API_KEY;
    if (!this.apiKey) {
      throw new Error('OPENAI_API_KEY environment variable is required for OpenAI adapter');
    }
  }

  /**
   * Send messages to OpenAI Chat API
   *
   * @param {Array} messages - Array of {role, content} objects
   * @returns {Promise<Object>} Response with content and token usage
   */
  async send(messages) {
    const requestBody = JSON.stringify({
      model: this.model,
      messages: messages.map(m => ({
        role: m.role,
        content: m.content
      })),
      temperature: this.temperature,
      max_tokens: this.maxTokens
    });

    const options = {
      hostname: 'api.openai.com',
      port: 443,
      path: '/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Length': Buffer.byteLength(requestBody)
      },
      timeout: this.timeout
    };

    try {
      const response = await this._makeRequest(options, requestBody);

      const data = JSON.parse(response);

      if (!data.choices || data.choices.length === 0) {
        throw new Error('No response from OpenAI API');
      }

      const content = data.choices[0].message.content;
      const usage = data.usage || {};

      return {
        content: content,
        tokens: {
          input: usage.prompt_tokens || 0,
          output: usage.completion_tokens || 0,
          total: usage.total_tokens || 0
        },
        provider: 'openai',
        model: data.model || this.model
      };
    } catch (error) {
      throw new Error(`OpenAI request failed: ${error.message}`);
    }
  }

  /**
   * Make HTTPS request to OpenAI API
   *
   * @private
   */
  _makeRequest(options, body) {
    return new Promise((resolve, reject) => {
      const req = https.request(options, (res) => {
        let data = '';

        res.on('data', (chunk) => {
          data += chunk;
        });

        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(data);
          } else {
            reject(new Error(`API returned status ${res.statusCode}: ${data}`));
          }
        });
      });

      req.on('error', (error) => reject(error));

      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Request timeout'));
      });

      req.write(body);
      req.end();
    });
  }

  /**
   * Get adapter info for debugging
   */
  getInfo() {
    return {
      provider: 'openai',
      model: this.model,
      maxTokens: this.maxTokens,
      temperature: this.temperature,
      hasApiKey: !!this.apiKey,
      endpoint: 'api.openai.com/v1/chat/completions'
    };
  }
}

module.exports = { OpenAIAdapter };
