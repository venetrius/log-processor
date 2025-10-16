/*
 * Unit tests for LLM Client
 */

const { createLLMClient } = require('../llm/llmClient');
const { RESPONSE_TYPES, CATEGORIES } = require('../llm/constants');

// Test runner
async function runTests() {
  console.log('🧪 Running LLM Client Tests\n');

  let passed = 0;
  let failed = 0;

  const testCases = [
    testCreateMockClient,
    testSendMessages,
    testValidateMessages,
    testEmptyMessages,
    testInvalidMessageFormat,
    testProviderInfo,
    testMockAdapterResponses,
    testNeedMoreInfoResponse,
    testTokenTracking,
    testUnknownProvider
  ];

  for (const testCase of testCases) {
    try {
      await testCase(); // Add await here
      console.log(`✅ ${testCase.name}`);
      passed++;
    } catch (error) {
      console.log(`❌ ${testCase.name}`);
      console.log(`   Error: ${error.message}\n`);
      failed++;
    }
  }

  console.log(`\n📊 Results: ${passed} passed, ${failed} failed`);

  if (failed > 0) {
    process.exit(1);
  }

  process.exit(0); // Explicit exit on success
}

// Test: Create mock client successfully
async function testCreateMockClient() {
  const client = createLLMClient({ provider: 'mock' });

  if (!client.send) {
    throw new Error('Client should have send method');
  }

  if (!client.getProvider) {
    throw new Error('Client should have getProvider method');
  }
}

// Test: Send messages and get response
async function testSendMessages() {
  const client = createLLMClient({ provider: 'mock' });

  const messages = [
    { role: 'system', content: 'You are a test assistant' },
    { role: 'user', content: 'Test message with npm error' }
  ];

  const response = await client.send(messages);

  if (!response.content) {
    throw new Error('Response should have content');
  }

  if (!response.tokens) {
    throw new Error('Response should have tokens');
  }

  if (!response.provider) {
    throw new Error('Response should have provider info');
  }

  // Verify the response is what mockAdapter returns
  const parsedContent = JSON.parse(response.content);
  if (parsedContent.type !== RESPONSE_TYPES.ROOT_CAUSE) {
    throw new Error('Should return root_cause type for npm error');
  }

  if (parsedContent.category !== CATEGORIES.DEPENDENCY) {
    throw new Error('MockAdapter should return dependency category for npm error');
  }

  if (response.provider !== 'mock') {
    throw new Error('Provider should be "mock"');
  }

  if (response.model !== 'mock-v1') {
    throw new Error('Model should be "mock-v1" from adapter');
  }
}

// Test: Validate message format
async function testValidateMessages() {
  const client = createLLMClient({ provider: 'mock' });

  const messages = [
    { role: 'system', content: 'System message' },
    { role: 'user', content: 'User message' }
  ];

  const response = await client.send(messages);

  if (!response) {
    throw new Error('Should return response for valid messages');
  }
}

// Test: Empty messages array should throw error
async function testEmptyMessages() {
  const client = createLLMClient({ provider: 'mock' });

  try {
    await client.send([]);
    throw new Error('Should throw error for empty messages');
  } catch (error) {
    if (!error.message.includes('non-empty array')) {
      throw new Error('Should throw appropriate error message');
    }
  }
}

// Test: Invalid message format should throw error
async function testInvalidMessageFormat() {
  const client = createLLMClient({ provider: 'mock' });

  try {
    await client.send([{ role: 'user' }]); // Missing content
    throw new Error('Should throw error for invalid format');
  } catch (error) {
    if (!error.message.includes('role and content')) {
      throw new Error('Should throw appropriate error message');
    }
  }
}

// Test: Get provider information
async function testProviderInfo() {
  const client = createLLMClient({
    provider: 'mock',
    model: 'test-model'
  });

  const info = client.getProvider();

  if (info.name !== 'mock') {
    throw new Error('Provider name should be "mock"');
  }

  if (info.model !== 'test-model') {
    throw new Error('Model should be "test-model"');
  }
}

// Test: Mock adapter different responses
async function testMockAdapterResponses() {
  const client = createLLMClient({ provider: 'mock' });

  // Test NPM error response
  const npmResponse = await client.send([
    { role: 'user', content: 'npm install failed for package xyz' }
  ]);

  const npmResult = JSON.parse(npmResponse.content);

  if (npmResult.category !== CATEGORIES.DEPENDENCY) {
    throw new Error('NPM errors should return dependency category');
  }

  // Test test failure response
  const testResponse = await client.send([
    { role: 'user', content: 'test assertion failed in unit tests' }
  ]);

  const testResult = JSON.parse(testResponse.content);

  if (testResult.category !== CATEGORIES.TEST) {
    throw new Error('Test errors should return test category');
  }
}

// Test: Need more info response
async function testNeedMoreInfoResponse() {
  const client = createLLMClient({ provider: 'mock' });

  const response = await client.send([
    { role: 'user', content: 'The error is unclear, need more logs' }
  ]);

  const result = JSON.parse(response.content);

  if (result.type !== RESPONSE_TYPES.NEED_MORE_INFO) {
    throw new Error('Should return need_more_info type');
  }

  if (!result.request || !result.request.more_lines) {
    throw new Error('Should include request with more_lines');
  }

  if (!result.reason) {
    throw new Error('Should include reason for requesting more info');
  }
}

// Test: Token tracking
async function testTokenTracking() {
  const client = createLLMClient({ provider: 'mock' });

  const response = await client.send([
    { role: 'system', content: 'System prompt' },
    { role: 'user', content: 'User message' }
  ]);

  if (!response.tokens.input) {
    throw new Error('Should track input tokens');
  }

  if (!response.tokens.output) {
    throw new Error('Should track output tokens');
  }

  if (!response.tokens.total) {
    throw new Error('Should track total tokens');
  }

  if (response.tokens.total !== response.tokens.input + response.tokens.output) {
    throw new Error('Total should equal input + output');
  }
}

// Test: Unknown provider throws error
async function testUnknownProvider() {
  try {
    createLLMClient({ provider: 'unknown-provider' });
    throw new Error('Should throw error for unknown provider');
  } catch (error) {
    if (!error.message.includes('Unknown LLM provider')) {
      throw new Error('Should throw appropriate error message');
    }
  }
}

// Run all tests
runTests();
