/*
 * Unit tests for PromptBuilder
 */

const { PromptBuilder } = require('../llm/promptBuilder');
const fs = require('fs');
const path = require('path');

// Test helper to create a temporary prompts file
function createTestPromptsFile() {
  const testPrompts = {
    testTemplate: {
      version: "1.0",
      system: "You are a test assistant for {{repository}}.",
      userTemplate: "Analyze: {{jobName}}\nErrors: {{errorAnnotations}}\nSteps: {{failedSteps}}",
      outputFormat: {
        type: "json"
      }
    },
    rootCauseAnalysis: {
      version: "1.0",
      system: "You are an expert DevOps engineer.",
      userTemplate: "Job: {{jobName}}\nWorkflow: {{workflowName}}\nErrors:\n{{errorAnnotations}}",
      outputFormat: {
        type: "discriminated_union",
        discriminator: "type"
      },
      examples: [
        { scenario: "test", response: { type: "root_cause" } }
      ]
    }
  };

  const testPath = path.join(__dirname, 'test-prompts.json');
  fs.writeFileSync(testPath, JSON.stringify(testPrompts, null, 2));
  return testPath;
}

// Clean up test file
function cleanupTestFile(filePath) {
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
}

// Test runner
function runTests() {
  console.log('🧪 Running PromptBuilder Tests\n');

  let passed = 0;
  let failed = 0;

  const testCases = [
    testLoadTemplates,
    testBuildBasicPrompt,
    testVariableSubstitution,
    testArrayVariables,
    testObjectVariables,
    testMissingVariables,
    testGetMetadata,
    testInvalidTemplate,
    testMissingTemplateFile
  ];

  for (const testCase of testCases) {
    try {
      testCase();
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
}

// Test: Load templates successfully
function testLoadTemplates() {
  const testPath = createTestPromptsFile();

  try {
    const builder = new PromptBuilder(testPath);
    const templates = builder.loadTemplates();

    if (!templates.testTemplate) {
      throw new Error('Expected testTemplate to be loaded');
    }

    if (templates.testTemplate.system !== "You are a test assistant for {{repository}}.") {
      throw new Error('System message not loaded correctly');
    }
  } finally {
    cleanupTestFile(testPath);
  }
}

// Test: Build basic prompt with simple variables
function testBuildBasicPrompt() {
  const testPath = createTestPromptsFile();

  try {
    const builder = new PromptBuilder(testPath);
    const messages = builder.build('testTemplate', {
      repository: 'my-org/my-repo',
      jobName: 'Build',
      errorAnnotations: 'Error 1\nError 2',
      failedSteps: 'Step 1\nStep 2'
    });

    if (messages.length !== 2) {
      throw new Error('Expected 2 messages (system + user)');
    }

    if (messages[0].role !== 'system') {
      throw new Error('First message should be system');
    }

    if (!messages[0].content.includes('my-org/my-repo')) {
      throw new Error('System message should include repository');
    }

    if (messages[1].role !== 'user') {
      throw new Error('Second message should be user');
    }

    if (!messages[1].content.includes('Build')) {
      throw new Error('User message should include job name');
    }
  } finally {
    cleanupTestFile(testPath);
  }
}

// Test: Variable substitution with strings
function testVariableSubstitution() {
  const testPath = createTestPromptsFile();

  try {
    const builder = new PromptBuilder(testPath);
    const messages = builder.build('rootCauseAnalysis', {
      jobName: 'Test Job',
      workflowName: 'CI Pipeline',
      errorAnnotations: 'Test error'
    });

    const userContent = messages[1].content;

    if (!userContent.includes('Job: Test Job')) {
      throw new Error('Job name not substituted correctly');
    }

    if (!userContent.includes('Workflow: CI Pipeline')) {
      throw new Error('Workflow name not substituted correctly');
    }
  } finally {
    cleanupTestFile(testPath);
  }
}

// Test: Array variables should be joined with newlines
function testArrayVariables() {
  const testPath = createTestPromptsFile();

  try {
    const builder = new PromptBuilder(testPath);
    const messages = builder.build('testTemplate', {
      repository: 'test/repo',
      jobName: 'Build',
      errorAnnotations: ['Error 1', 'Error 2', 'Error 3'],
      failedSteps: ['Step A', 'Step B']
    });

    const userContent = messages[1].content;

    if (!userContent.includes('Error 1\nError 2\nError 3')) {
      throw new Error('Array should be joined with newlines');
    }
  } finally {
    cleanupTestFile(testPath);
  }
}

// Test: Object variables should be stringified
function testObjectVariables() {
  const testPath = createTestPromptsFile();

  try {
    const builder = new PromptBuilder(testPath);
    const messages = builder.build('testTemplate', {
      repository: 'test/repo',
      jobName: { name: 'Build', id: 123 },
      errorAnnotations: 'errors',
      failedSteps: 'steps'
    });

    const userContent = messages[1].content;

    if (!userContent.includes('"name"') || !userContent.includes('"Build"')) {
      throw new Error('Object should be stringified as JSON');
    }
  } finally {
    cleanupTestFile(testPath);
  }
}

// Test: Missing variables remain as placeholders
function testMissingVariables() {
  const testPath = createTestPromptsFile();

  try {
    const builder = new PromptBuilder(testPath);
    const messages = builder.build('testTemplate', {
      repository: 'test/repo'
      // Missing: jobName, errorAnnotations, failedSteps
    });

    const userContent = messages[1].content;

    if (!userContent.includes('{{jobName}}')) {
      throw new Error('Missing variables should remain as placeholders');
    }

    const missing = builder.getMissingVariables(
      messages[1].content,
      { repository: 'test/repo' }
    );

    if (!missing.includes('jobName')) {
      throw new Error('getMissingVariables should detect missing vars');
    }
  } finally {
    cleanupTestFile(testPath);
  }
}

// Test: Get template metadata
function testGetMetadata() {
  const testPath = createTestPromptsFile();

  try {
    const builder = new PromptBuilder(testPath);
    const metadata = builder.getTemplateMetadata('rootCauseAnalysis');

    if (!metadata.outputFormat) {
      throw new Error('Should return output format');
    }

    if (metadata.outputFormat.type !== 'discriminated_union') {
      throw new Error('Output format should match template');
    }

    if (!Array.isArray(metadata.examples)) {
      throw new Error('Should return examples array');
    }
  } finally {
    cleanupTestFile(testPath);
  }
}

// Test: Invalid template name throws error
function testInvalidTemplate() {
  const testPath = createTestPromptsFile();

  try {
    const builder = new PromptBuilder(testPath);

    try {
      builder.build('nonExistentTemplate', {});
      throw new Error('Should have thrown error for invalid template');
    } catch (error) {
      if (!error.message.includes('not found')) {
        throw new Error('Should throw "not found" error');
      }
    }
  } finally {
    cleanupTestFile(testPath);
  }
}

// Test: Missing prompts file throws error
function testMissingTemplateFile() {
  const builder = new PromptBuilder('/path/to/nonexistent/prompts.json');

  try {
    builder.loadTemplates();
    throw new Error('Should have thrown error for missing file');
  } catch (error) {
    if (!error.message.includes('Failed to load prompts')) {
      throw new Error('Should throw appropriate error message');
    }
  }
}

// Run all tests
runTests();

