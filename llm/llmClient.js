/*
 * LLM Client - Abstraction layer for LLM providers
 *
 * Responsibilities:
 * - Initialize LLM client from config
 * - Provide simple send(messages) interface
 * - Handle errors at transport level
 * - Track token usage
 *
 * Does NOT know about: root causes, jobs, GitHub, business logic
 */

const { MockAdapter } = require('./adapters/mockAdapter');
const { PROVIDERS, DEFAULTS } = require('./constants');

/**
 * Create an LLM client from configuration
 *
 * @param {Object} config - LLM configuration
 * @param {string} config.provider - Provider name ('mock', 'github-copilot', etc.)
 * @param {string} config.model - Model name
 * @param {number} config.maxTokens - Max tokens per request
 * @param {number} config.temperature - Temperature setting
 * @param {number} config.timeout - Timeout in milliseconds (default: 60000)
 * @returns {Object} LLM client with send() method
 */
function createLLMClient(config = {}) {
  const provider = (config.provider || PROVIDERS.MOCK).toLowerCase();
  const timeout = config.timeout || DEFAULTS.TIMEOUT;

  let adapter;

  // Initialize appropriate adapter based on provider
  switch (provider) {
    case PROVIDERS.MOCK:
    case PROVIDERS.TEST:
      adapter = new MockAdapter(config);
      break;

    case PROVIDERS.GITHUB_COPILOT:
    case PROVIDERS.COPILOT:
      // TODO: Implement in Phase 3
      throw new Error('GitHub Copilot adapter not yet implemented. Use "mock" for testing.');

    default:
      throw new Error(`Unknown LLM provider: ${provider}`);
  }

  // Return client object with unified interface
  return {
    /**
     * Send messages to LLM
     *
     * @param {Array} messages - Array of message objects [{role, content}, ...]
     * @returns {Promise<Object>} Response object with content and metadata
     */
    async send(messages) {
      if (!Array.isArray(messages) || messages.length === 0) {
        throw new Error('Messages must be a non-empty array');
      }

      // Validate message format
      for (const msg of messages) {
        if (!msg.role || !msg.content) {
          throw new Error('Each message must have role and content properties');
        }
      }

      try {
        // Call adapter with timeout
        const responsePromise = adapter.send(messages);
        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('LLM request timeout')), timeout)
        );

        const response = await Promise.race([responsePromise, timeoutPromise]);

        return response;
      } catch (error) {
        throw new Error(`LLM request failed: ${error.message}`);
      }
    },

    /**
     * Get provider information
     */
    getProvider() {
      return {
        name: provider,
        model: config.model || 'default',
        adapter: adapter.constructor.name
      };
    },

    /**
     * Get adapter instance (useful for testing)
     */
    _getAdapter() {
      return adapter;
    }
  };
}

module.exports = { createLLMClient };
