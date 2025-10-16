#!/usr/bin/env node
/*
 * Simple test script for GitHub Copilot adapter
 * Tests the connection and basic functionality without the full system
 */

require('dotenv').config();
const { CopilotAdapter } = require('../../llm/adapters/copilotAdapter');
const { OpenAIAdapter } = require('../../llm/adapters/OpenAIAdapter');

async function testCopilotConnection() {
  console.log('🧪 GitHub Copilot Adapter Test\n');

  // Check for token
  if (!process.env.OPENAI_API_KEY) {
    console.error('❌ Error: GITHUB_TOKEN environment variable not set');
    console.log('\nPlease set it:');
    console.log('  export GITHUB_TOKEN="github_pat_YOUR_TOKEN_HERE"');
    console.log('\nOr add it to .env file:');
    console.log('  echo "GITHUB_TOKEN=your_token" >> .env');
    process.exit(1);
  }

  console.log('✅ OPENAI_API_KEY found');

  // Create adapter
  console.log('\n📦 Creating OPENAI_API_KEY adapter...');
  let adapter;

  try {
    adapter = new OpenAIAdapter({
      model: 'gpt-4o',
      maxTokens: 100,
      temperature: 0.7,
      timeout: 30000
    });
    console.log('✅ Adapter created successfully');
    console.log(`   Info:`, adapter.getInfo());
  } catch (error) {
    console.error(`❌ Failed to create adapter: ${error.message}`);
    process.exit(1);
  }

  // Send a simple "Hello World" test message
  console.log('\n🚀 Sending test message to GitHub Copilot...');
  console.log('   Prompt: "Hello! Please respond with a friendly greeting."');

  const messages = [
    {
      role: 'system',
      content: 'You are a helpful assistant. Respond concisely.'
    },
    {
      role: 'user',
      content: 'Hello! Please respond with a friendly greeting and tell me what you can help with.'
    }
  ];

  try {
    const startTime = Date.now();
    const response = await adapter.send(messages);
    const duration = Date.now() - startTime;

    console.log('\n✅ Response received!\n');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📝 RESPONSE CONTENT:');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(response.content);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    console.log('📊 Metadata:');
    console.log(`   Provider: ${response.provider}`);
    console.log(`   Model: ${response.model}`);
    console.log(`   Duration: ${duration}ms`);
    console.log(`   Tokens:`);
    console.log(`     - Input: ${response.tokens.input}`);
    console.log(`     - Output: ${response.tokens.output}`);
    console.log(`     - Total: ${response.tokens.total}`);

    console.log('\n🎉 Success! GitHub Copilot adapter is working correctly.\n');

  } catch (error) {
    console.error('\n❌ Test failed!');
    console.error(`   Error: ${error.message}`);
    console.error(`\n   Full error:`, error);

    console.log('\n💡 Troubleshooting tips:');
    console.log('   1. Check your GITHUB_TOKEN is valid');
    console.log('   2. Ensure you have internet connectivity');
    console.log('   3. Verify GitHub Models API is accessible');
    console.log('   4. Try regenerating your GitHub token');

    process.exit(1);
  }
}

// Run the test
console.log('═══════════════════════════════════════════════════════');
console.log('  GitHub Copilot Connection Test');
console.log('═══════════════════════════════════════════════════════\n');

testCopilotConnection()
  .then(() => {
    console.log('═══════════════════════════════════════════════════════');
    console.log('  Test Complete ✅');
    console.log('═══════════════════════════════════════════════════════\n');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n💥 Unexpected error:', error);
    process.exit(1);
  });

