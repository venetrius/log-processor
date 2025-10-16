/*
 * Mock LLM Adapter - For testing without real API calls
 *
 * Returns predefined responses based on input patterns
 */

const { RESPONSE_TYPES, CATEGORIES } = require('../constants');

class MockAdapter {
  constructor(config = {}) {
    this.config = config;
    this.callCount = 0;
    this.lastMessages = null;
  }

  /**
   * Send messages to mock LLM (returns predefined response)
   *
   * @param {Array} messages - Array of {role, content} objects
   * @returns {Promise<Object>} Response with content and tokens
   */
  async send(messages) {
    this.callCount++;
    this.lastMessages = messages;

    // Simulate API delay
    await new Promise(resolve => setTimeout(resolve, 10));

    // Extract user message content
    const userMessage = messages.find(m => m.role === 'user');
    const content = userMessage?.content || '';

    // Return different responses based on content
    let response;

    if (content.includes('need more logs') || content.includes('unclear')) {
      // Simulate LLM requesting more info
      response = {
        type: RESPONSE_TYPES.NEED_MORE_INFO,
        reason: 'The error context is unclear, need to see more logs around the failure point',
        request: {
          more_lines: 50,
          direction: 'before'
        }
      };
    } else if (content.includes('npm') || content.includes('package')) {
      // Simulate NPM dependency issue
      response = {
        type: RESPONSE_TYPES.ROOT_CAUSE,
        category: CATEGORIES.DEPENDENCY,
        title: 'NPM package installation failed',
        description: 'The build failed because a required npm package could not be installed',
        confidence: 0.9,
        suggested_fix: 'Check package.json for typos or verify npm registry access',
        reasoning: 'Error messages indicate npm install failure'
      };
    } else if (content.includes('test') || content.includes('assertion')) {
      // Simulate test failure
      response = {
        type: RESPONSE_TYPES.ROOT_CAUSE,
        category: CATEGORIES.TEST,
        title: 'Unit test assertion failed',
        description: 'One or more test assertions failed during test execution',
        confidence: 0.85,
        suggested_fix: 'Review the failing test and check for recent code changes',
        reasoning: 'Test failure patterns detected in error logs'
      };
    } else {
      // Default response
      response = {
        type: RESPONSE_TYPES.ROOT_CAUSE,
        category: CATEGORIES.UNKNOWN,
        title: 'Mock root cause analysis',
        description: 'This is a mock analysis for testing purposes',
        confidence: 0.75,
        suggested_fix: 'This is a mock suggestion',
        reasoning: 'Mock analysis based on error patterns'
      };
    }

    // Estimate tokens (rough approximation)
    const inputTokens = Math.ceil(messages.reduce((acc, m) => acc + m.content.length, 0) / 4);
    const outputTokens = Math.ceil(JSON.stringify(response).length / 4);

    return {
      content: JSON.stringify(response, null, 2),
      tokens: {
        input: inputTokens,
        output: outputTokens,
        total: inputTokens + outputTokens
      },
      provider: 'mock',
      model: 'mock-v1'
    };
  }

  /**
   * Get call statistics (for testing)
   */
  getStats() {
    return {
      callCount: this.callCount,
      lastMessages: this.lastMessages
    };
  }

  /**
   * Reset statistics
   */
  reset() {
    this.callCount = 0;
    this.lastMessages = null;
  }
}

module.exports = { MockAdapter };
