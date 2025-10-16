# Phase 3.2: LLM Integration - Implementation Plan

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
                             │  Adapter Layer (optional)    │
                             │  adapters/                   │
                             │  - copilotAdapter.js         │
                             │  - openaiAdapter.js          │
                             │  - anthropicAdapter.js       │
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
    "userTemplate": "...",
    "outputFormat": {
      "type": "json",
      "schema": {
        "category": "string",
        "title": "string",
        "description": "string",
        "confidence": "number (0-1)",
        "suggested_fix": "string",
        "reasoning": "string"
      }
    },
    "examples": []
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
// Returns: { content: '...', tokens: { input: 10, output: 20 } }
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
  errorAnnotations: [...],
  failedSteps: [...]
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
// Usage
const rootCauseService = new RootCauseService(llmClient, promptBuilder, db);
const result = await rootCauseService.analyzeJob(jobId, errorAnnotations, failedSteps, context);
// Returns: { rootCause, confidence, method, duration, tokens }
```

### Step 5: Create Adapters (`llm/adapters/`)

**Responsibilities:**
- Implement provider-specific communication logic
- Translate generic message format to provider format
- Handle provider-specific quirks (CLI vs API, auth, etc.)
- Return normalized responses

**copilotAdapter.js** - Uses opencode CLI
**openaiAdapter.js** - Direct API calls (future)
**mockAdapter.js** - For testing

### Step 6: Integrate into Existing Flow

Update `rootCauseAnalyzer.js` to use `rootCauseService` instead of inline logic.

## 🔨 Things That Need Hammering Out

### 1. **Prompt Template Structure**
- [ ] What template engine to use? (Handlebars, Mustache, simple string replacement?)
- [ ] How to handle multi-turn conversations vs single prompt?
- [ ] Should we support prompt versioning for A/B testing?
- [ ] How to handle different prompts for different error categories?
- [ ] Should we include few-shot examples in prompts?
- [ ] How to handle very large error logs (truncation strategy)?

### 2. **LLM Client Configuration**
- [ ] Should we support multiple LLM providers simultaneously?
- [ ] How to handle rate limiting across different providers?
- [ ] Should we implement request queuing/throttling?
- [ ] How to handle streaming responses (for future UI)?
- [ ] Should we cache LLM responses (same error = same response)?
- [ ] How to handle API key management (env vars, config file, secrets manager)?

### 3. **Response Parsing & Validation**
- [ ] What if LLM returns malformed JSON?
- [ ] Should we retry with a "fix your JSON" prompt?
- [ ] How strict should validation be (fail vs fallback)?
- [ ] Should we use JSON Schema for validation?
- [ ] What confidence threshold should we use by default?
- [ ] How to handle responses that don't fit our categories?

### 4. **Adapter Implementation Details**
- [ ] **Copilot via opencode**: 
  - Does opencode support system messages?
  - How to handle opencode CLI errors?
  - Should we use temp files or stdin/stdout?
  - How to track actual token usage (not estimates)?
- [ ] **Future adapters**: What providers should we prioritize?
  - OpenAI API (gpt-4, gpt-3.5-turbo)
  - Anthropic Claude
  - Local models (Ollama, LM Studio)
  - Azure OpenAI

### 5. **Cost & Performance Management**
- [ ] Should we set per-run or per-day token budgets?
- [ ] How to track costs across different providers?
- [ ] Should we implement cost estimation before calling LLM?
- [ ] What timeout values should we use?
- [ ] Should we batch multiple jobs in one LLM call?

### 6. **Error Handling & Fallbacks**
- [ ] What to do if LLM call fails? (retry, skip, use lower confidence pattern?)
- [ ] Should we store failed LLM attempts for debugging?
- [ ] How many retries before giving up?
- [ ] Should we have a fallback LLM provider?

### 7. **Testing Strategy**
- [ ] How to test LLM integration without API calls?
- [ ] Should we record real LLM responses for regression tests?
- [ ] How to test different error scenarios?
- [ ] Should we have integration tests with real APIs?

### 8. **Prompt Engineering**
- [ ] What system prompt works best for root cause analysis?
- [ ] Should we include GitHub Actions-specific context?
- [ ] How to handle different programming languages/frameworks?
- [ ] Should we include historical data (similar past failures)?
- [ ] What output format works best (JSON, structured text, XML)?

### 9. **Service Layer Design**
- [ ] Should `rootCauseService` be a class or module with functions?
- [ ] How to handle state (singleton, instance per request)?
- [ ] Should we support dependency injection for testing?
- [ ] How to make it extensible for future analysis levels (semantic search)?

### 10. **Migration Path**
- [ ] Should we run old and new analyzers in parallel initially?
- [ ] How to migrate existing data to new structure?
- [ ] Should we have a feature flag to enable/disable LLM?
- [ ] How to handle backward compatibility?

## 🎯 Recommended Implementation Order

### Phase 1: Foundation (No external LLM calls yet)
1. Create prompt templates structure (`llm/prompts.json`)
2. Implement `PromptBuilder` with template loading
3. Create `MockAdapter` for testing
4. Implement basic `llmClient` with mock adapter
5. **Test**: Verify prompt building works correctly

### Phase 2: Service Layer
1. Create `rootCauseService.js` with business logic
2. Integrate pattern matching flow
3. Add LLM fallback logic (using mock adapter)
4. Update `rootCauseAnalyzer.js` to use service
5. **Test**: Verify service orchestration works

### Phase 3: Real LLM Integration
1. Implement `copilotAdapter.js` with opencode CLI
2. Test with real GitHub Copilot calls
3. Add response parsing and validation
4. Add error handling and retries
5. **Test**: Verify real LLM calls work end-to-end

### Phase 4: Polish
1. Add token tracking and cost estimation
2. Implement caching if needed
3. Add comprehensive logging
4. Update documentation
5. Add integration tests

## 📚 Dependencies

```bash
# Required
npm install @sst/opencode  # For GitHub Copilot integration

# Optional (for future providers)
npm install openai         # For OpenAI API
npm install @anthropic-ai/sdk  # For Anthropic Claude
```

## 🔍 Example Usage Flow

```javascript
// In index.js or rootCauseAnalyzer.js
const { createLLMClient } = require('./llm/llmClient');
const { PromptBuilder } = require('./llm/promptBuilder');
const { RootCauseService } = require('./services/rootCauseService');

// Setup (once)
const config = loadConfig();
const llmClient = createLLMClient(config.llm);
const promptBuilder = new PromptBuilder();
const rootCauseService = new RootCauseService(llmClient, promptBuilder, db);

// Analyze a job
const result = await rootCauseService.analyzeJob(
  jobId, 
  errorAnnotations, 
  failedSteps,
  { jobName: 'Build', workflowName: 'CI' }
);

if (result) {
  console.log(`Root cause: ${result.rootCause.title}`);
  console.log(`Method: ${result.method}, Confidence: ${result.confidence}`);
  console.log(`Tokens used: ${result.tokens}`);
}
```

## 🚀 Benefits of This Architecture

1. **Separation of Concerns**: Each layer has a single responsibility
2. **Testability**: Easy to test each layer independently with mocks
3. **Flexibility**: Easy to swap LLM providers without changing business logic
4. **Maintainability**: Clear boundaries make code easier to understand and modify
5. **Extensibility**: Easy to add new providers, prompts, or analysis methods
6. **Reusability**: LLM client and prompt builder can be used for other features

## 📝 Next Steps

1. Review and discuss "Things That Need Hammering Out"
2. Make decisions on open questions
3. Start Phase 1 implementation
4. Iterate based on feedback

---

**Status**: 📋 Planning Phase
**Last Updated**: 2025-10-16

