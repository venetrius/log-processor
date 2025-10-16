# Phase 3.2: LLM Integration - Implementation Plan (WITH DECISIONS)

## 🎯 Overview

Integrate LLM-based root cause analysis as Level 3 fallback when pattern matching fails. This implementation follows a clean, layered architecture with proper separation of concerns.

## 🏗️ Architecture Layers

```
┌─────────────────────────────────────────────────────────────┐
│                    Client Layer (index.js)                   │
│              Orchestrates the overall workflow               │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│              Business Logic Layer (services)                 │
│         rootCauseService.js - Domain logic for root          │
│         cause detection, uses patterns & LLM provider        │
└─────────────────────────────────────────────────────────────┘
                            ↓
                    ┌───────┴───────┐
                    ↓               ↓
┌─────────────────────────┐  ┌──────────────────────────────┐
│   Prompt Management     │  │    LLM Provider Layer        │
│   promptBuilder.js      │  │    llmClient.js              │
│   - Load prompts        │  │    - Read config             │
│   - Build prompts       │  │    - Initialize LLM client   │
│   - Template rendering  │  │    - Send/receive messages   │
└─────────────────────────┘  │    - No business logic       │
                             └──────────────────────────────┘
                                          ↓
                             ┌──────────────────────────────┐
                             │  Adapter Layer               │
                             │  adapters/                   │
                             │  - copilotAdapter.js         │
                             │  - openaiAdapter.js          │
                             │  - mockAdapter.js            │
                             └──────────────────────────────┘
```

## 📁 File Structure

```
log-processor/
├── llm/
│   ├── llmClient.js           # LLM provider abstraction (reads config, returns client)
│   ├── promptBuilder.js       # Loads and builds prompts from templates
│   ├── prompts.json          # Prompt templates and configurations
│   ├── adapters/
│   │   ├── copilotAdapter.js # GitHub Copilot via opencode CLI
│   │   ├── openaiAdapter.js  # Direct OpenAI API (future)
│   │   └── mockAdapter.js    # Mock for testing
│   └── README.md             # LLM module documentation
├── services/
│   └── rootCauseService.js   # Business logic for root cause detection
├── rootCauseAnalyzer.js      # Existing analyzer (uses rootCauseService)
└── index.js                  # Main entry point
```

## 🔧 Implementation Steps

### Step 1: Define Prompt Templates (`llm/prompts.json`)

Create a JSON file with structured prompt templates:

```json
{
  "rootCauseAnalysis": {
    "version": "1.0",
    "system": "You are an expert DevOps engineer analyzing GitHub Actions workflow failures.",
    "userTemplate": "Analyze the following failure:\n\nJob: {{jobName}}\nWorkflow: {{workflowName}}\n\nError Annotations:\n{{errorAnnotations}}\n\nFailed Steps:\n{{failedSteps}}\n\nLast 50 log lines:\n{{logLines}}\n\nProvide root cause analysis in JSON format.",
    "outputFormat": {
      "type": "json",
      "schema": {
        "category": "string (build|test|deployment|dependency|infrastructure|authentication|timeout|resource|unknown)",
        "title": "string (max 80 chars)",
        "description": "string",
        "confidence": "number (0-1)",
        "suggested_fix": "string",
        "reasoning": "string",
        "needs_more_logs": "boolean (optional)",
        "log_patterns": "array of regex patterns (optional)"
      }
    }
  }
}
```

### Step 2: Create LLM Client (`llm/llmClient.js`)

**Responsibilities:**
- Read LLM configuration from config.json
- Initialize and return LLM client object
- Provide simple `send(messages)` interface
- Handle retries and error handling at transport level
- **Does NOT know about**: root causes, jobs, GitHub, business logic

**Interface:**
```javascript
// Usage
const llmClient = createLLMClient(config);
const response = await llmClient.send([
  { role: 'system', content: '...' },
  { role: 'user', content: '...' }
]);
// Returns: { content: '...', tokens: { input: 10, output: 20 }, provider: 'copilot' }
```

### Step 3: Create Prompt Builder (`llm/promptBuilder.js`)

**Responsibilities:**
- Load prompts from prompts.json
- Build prompts from templates with variable substitution
- Validate prompt structure
- **Does NOT know about**: LLM providers, API calls, business logic

**Interface:**
```javascript
// Usage
const promptBuilder = new PromptBuilder();
const messages = promptBuilder.build('rootCauseAnalysis', {
  jobName: 'Build',
  workflowName: 'CI',
  errorAnnotations: [...],
  failedSteps: [...],
  logLines: '...'
});
// Returns: [{ role: 'system', content: '...' }, { role: 'user', content: '...' }]
```

### Step 4: Create Root Cause Service (`services/rootCauseService.js`)

**Responsibilities:**
- Implement business logic for root cause detection
- Orchestrate pattern matching → LLM analysis flow
- Use promptBuilder to create prompts
- Use llmClient to communicate with LLM
- Parse and validate LLM responses
- Store results in database
- **This is the only layer that understands root cause domain logic**

**Interface:**
```javascript
// Usage (module-based, not class-based)
const result = await analyzeJob(jobId, errorAnnotations, failedSteps, context);
// Returns: { rootCause, confidence, method, duration, tokens } or null
```

### Step 5: Create Adapters (`llm/adapters/`)

**Responsibilities:**
- Implement provider-specific communication logic
- Translate generic message format to provider format
- Handle provider-specific quirks (CLI vs API, auth, etc.)
- Return normalized responses

**copilotAdapter.js** - Uses opencode CLI
**mockAdapter.js** - For testing
**openaiAdapter.js** - Direct API calls (future)

### Step 6: Integrate into Existing Flow

Update `rootCauseAnalyzer.js` to use `rootCauseService` instead of inline logic.

---

## ✅ DECISIONS MADE

### 1. **Prompt Template Structure** ✅
**DECIDED:**
- ✅ Simple string substitution (no template engine)
- ✅ Expected ~10-20 prompt types, string replacement is sufficient
- ✅ Placeholder syntax: `{{variable}}` format
- ✅ Include error annotations + last 50 log lines
- ✅ Single prompt initially (LLM can optionally request more logs via response field)
- ✅ No versioning initially (can add later)
- ✅ Single prompt for all error types initially

**Still to finalize during implementation:**
- Exact structure for "LLM requests more logs" in response JSON
- How to handle if LLM provides regex patterns for additional log retrieval

---

### 2. **LLM Client Configuration** ✅
**DECIDED:**
- ✅ Single provider only for now
- ✅ Track token usage (input/output/total) and allow configurable token limit
- ✅ No throttling/queueing initially
- ✅ No streaming support initially
- ✅ No caching initially (future enhancement)
- ✅ API keys via `.env` file
- ✅ Store timestamped token usage in DB for later cost analysis

**Still to finalize during implementation:**
- Token counting method per adapter (use estimates if provider doesn't return counts)
- Where to enforce token limit (client vs service layer)

---

### 3. **Response Parsing & Validation** ✅
**DECIDED:**
- ✅ Keep flexible; refine during testing
- ✅ Wrap parsing in try/catch and return "malformed" marker in result
- ✅ No retry on malformed JSON initially
- ✅ Flexible validation initially (no JSON Schema yet)
- ✅ Default confidence threshold: 0.8 (configurable)
- ✅ Accept any category initially

**Still to finalize during implementation:**
- Exact structure of "malformed" marker in result object
- Policy for storing malformed responses in DB

---

### 4. **Adapter Implementation Details** 🔄
**DECIDED:**
- ✅ Primary: GitHub Copilot via opencode CLI
- ✅ Use temp files for opencode communication (simpler initially)
- ✅ Log CLI errors and return error in normalized format
- ✅ Estimate token usage based on character count if not provided
- ✅ Future adapters: OpenAI API priority, then others as needed

**To test during implementation:**
- Whether opencode supports system/user message roles
- Actual error formats from opencode CLI

---

### 5. **Cost & Performance Management** ✅
**DECIDED:**
- ✅ Configurable token limit per request
- ✅ Store token usage in DB with timestamps
- ✅ Default timeout: 60 seconds (configurable)
- ✅ No batching initially
- ✅ No cost estimation before call (future)

---

### 6. **Error Handling & Fallbacks** ✅
**DECIDED:**
- ✅ Log LLM failures and save to DB
- ✅ No retry initially
- ✅ No fallback provider initially
- ✅ Result object clearly distinguishes: "pattern_success", "llm_success", "llm_failure", "no_match"

**Still to finalize during implementation:**
- Exact DB schema for failure entries
- Error categorization (timeout vs API error vs parse error)

---

### 7. **Testing Strategy** ✅
**DECIDED:**
- ✅ Mock-based unit tests alongside implementation
- ✅ Integration tests after core functionality works
- ✅ Use real error examples from existing logs for test data
- ✅ Recorded responses for regression tests (future)

---

### 8. **Prompt Engineering** ✅
**DECIDED:**
- ✅ Separate iterative step after architecture is in place
- ✅ Define `prompts.json` structure early even with rough content
- ✅ Include GitHub Actions-specific context
- ✅ JSON output format
- ✅ Historical data (future enhancement)

---

### 9. **Service Layer Design** ✅
**DECIDED:**
- ✅ Module-based with functions (NOT class-based)
- ✅ Singleton pattern, async/await
- ✅ Support dependency injection for testing
- ✅ Extensibility handled by higher-level orchestrator
- ✅ Maintain stable interface for orchestration layer

---

### 10. **Migration Path** ✅
**DECIDED:**
- ✅ Replace existing analyzer directly (no parallel runs)
- ✅ No data migration needed
- ✅ Add `USE_LLM_ANALYZER=true` env toggle for testing rollout
- ✅ No backward compatibility needed (forward-only)

---

## 🎯 Implementation Order (WITH TESTS)

### Phase 1: Foundation with Tests (Mock-based, no real LLM calls)
1. Create directory structure (`llm/`, `services/`, `llm/adapters/`)
2. Create `llm/prompts.json` with basic root cause analysis prompt template
3. Implement `llm/promptBuilder.js` with:
   - Load prompts from JSON
   - String substitution with `{{variable}}` syntax
   - Basic validation
4. **✅ Create tests for promptBuilder:**
   - Test template loading
   - Test variable substitution
   - Test missing variables handling
   - Test invalid template handling
5. Create `llm/adapters/mockAdapter.js` that returns predefined responses
6. Implement `llm/llmClient.js` with mock adapter support
7. **✅ Create tests for llmClient:**
   - Test client initialization
   - Test message sending with mockAdapter
   - Test error handling
   - Test token tracking
8. **Run tests**: Verify all foundation components work

### Phase 2: Service Layer with Tests (Mock LLM)
1. Create `services/rootCauseService.js` with:
   - Pattern matching flow (reuse existing patternMatcher)
   - LLM fallback logic
   - Response parsing and validation
   - DB storage
2. **✅ Create tests for rootCauseService:**
   - Test pattern matching path (no LLM call)
   - Test LLM fallback path (with mockAdapter)
   - Test response parsing (valid JSON)
   - Test response parsing (malformed JSON)
   - Test confidence threshold filtering
   - Test DB storage (can use mock DB or test DB)
3. Update `rootCauseAnalyzer.js` to use `rootCauseService`
4. **Run tests**: Verify service orchestration works end-to-end with mocks

### Phase 3: Real LLM Integration (GitHub Copilot)
1. Install dependencies: `npm install @sst/opencode`
2. Implement `llm/adapters/copilotAdapter.js` with:
   - opencode CLI wrapper
   - Temp file management
   - Error handling
   - Response parsing
3. Add `.env` configuration for API keys
4. Test manually with real GitHub Copilot:
   - Test with various error types
   - Verify token tracking
   - Verify response format
   - Test timeout handling
   - Test error scenarios
5. Update configuration docs

### Phase 4: Polish & Production Ready
1. Add feature flag support (`USE_LLM_ANALYZER` in `.env`)
2. Add comprehensive logging throughout
3. Add token usage tracking in DB
4. Create integration tests with recorded responses
5. Update main README with LLM features
6. Performance testing and optimization
7. Create troubleshooting guide

---

## 📚 Dependencies

```bash
# Required for Phase 3
npm install @sst/opencode  # For GitHub Copilot integration

# Optional (for future providers)
npm install openai         # For OpenAI API
npm install @anthropic-ai/sdk  # For Anthropic Claude
```

---

## 🔍 Example Usage Flow

```javascript
// In rootCauseAnalyzer.js
const { createLLMClient } = require('./llm/llmClient');
const { PromptBuilder } = require('./llm/promptBuilder');
const rootCauseService = require('./services/rootCauseService');

// Setup (once, at module level)
const config = loadConfig();
const llmClient = config.llm?.enabled ? createLLMClient(config.llm) : null;
const promptBuilder = new PromptBuilder();

// Initialize service
rootCauseService.initialize(llmClient, promptBuilder, db);

// Analyze a job
async function analyzeJob(jobId, errorAnnotations, failedSteps) {
  const result = await rootCauseService.analyzeJob(
    jobId, 
    errorAnnotations, 
    failedSteps,
    { 
      jobName: 'Build', 
      workflowName: 'CI',
      repository: config.repository 
    }
  );

  if (result) {
    console.log(`Root cause: ${result.rootCause.title}`);
    console.log(`Method: ${result.method}, Confidence: ${result.confidence}`);
    if (result.tokens) {
      console.log(`Tokens used: ${result.tokens}`);
    }
  } else {
    console.log('No root cause detected');
  }
}
```

---

## 🚀 Benefits of This Architecture

1. **Separation of Concerns**: Each layer has a single responsibility
2. **Testability**: Easy to test each layer independently with mocks
3. **Flexibility**: Easy to swap LLM providers without changing business logic
4. **Maintainability**: Clear boundaries make code easier to understand and modify
5. **Extensibility**: Easy to add new providers, prompts, or analysis methods
6. **Reusability**: LLM client and prompt builder can be used for other features
7. **Cost Control**: Token tracking and limits prevent runaway costs
8. **Gradual Rollout**: Feature flag allows safe testing in production

---

## 📝 Next Steps

1. ✅ Review decisions (DONE)
2. **START HERE**: Begin Phase 1 implementation
3. Write tests alongside each component
4. Iterate based on test results

---

**Status**: 📋 Planning Complete → 🚀 Ready for Implementation
**Last Updated**: 2025-10-16 (Decisions finalized)

