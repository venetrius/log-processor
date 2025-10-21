# Architecture Documentation

**Last Updated:** October 21, 2025  
**Status:** Current Implementation

---

## System Overview

Log Processor is a GitHub Actions failure analysis tool that uses a three-tier intelligent detection system:

1. **Pattern Matching** (Level 1) - Instant, regex-based detection
2. **Prompt Semantic Search** (Level 2) - Find similar historical failures via embeddings
3. **LLM Analysis** (Level 3) - AI-powered root cause detection when needed

---

## Core Components

### Data Flow

```
GitHub Actions API
    ↓
parseJobsLazy.js (entry point for lazy loading)
    ↓
Pattern Analysis (rootCauseServiceExtensions.js)
    ↓ [if generic failure]
Full Analysis (rootCauseService.js)
    ↓
1. Pattern Matching
    ↓ [no match]
2. Prompt Semantic Search (llmPromptService.js)
    ↓ [no similar match]
3. LLM Analysis (llm/llmClient.js)
    ↓
Database Persistence (db/repository.js)
```

### Key Services

#### Root Cause Analysis
- **`services/rootCauseService.js`** - Main orchestrator for 3-tier analysis
- **`services/rootCauseServiceExtensions.js`** - Pattern-only analysis for lazy loading
- **`services/llmPromptService.js`** - Prompt caching and semantic search
- **`patternMatcher.js`** - Regex-based pattern catalog

#### LLM Integration
- **`llm/llmClient.js`** - LLM provider abstraction
- **`llm/promptBuilder.js`** - Prompt template management
- **`llm/adapters/`** - Provider-specific implementations (Copilot, OpenAI, Mock)
- **`llm/adapters/localEmbedAdapter.js`** - Local embedding generation (Xenova/transformers.js)

#### Embeddings & Search
- **`services/embeddingService.js`** - Root cause embedding generation
- Uses local model: `Xenova/all-MiniLM-L6-v2` (384 dimensions)
- pgvector for similarity search

#### Caching & Optimization
- **`services/cacheGHCLI.js`** - GitHub CLI response caching
- **`cacheManager.js`** - Cache management CLI
- Lazy loading prevents unnecessary log downloads

### Database Schema

**Core Tables:**
- `workflow_runs` - Workflow execution metadata
- `jobs` - Job details and status
- `job_steps` - Individual step failures
- `error_annotations` - GitHub error messages

**Intelligence Tables:**
- `root_causes` - Identified failure patterns (with embeddings)
- `job_root_causes` - Many-to-many linking jobs to root causes
- `llm_prompts` - Cached prompts with embeddings for semantic search
- `gh_cli_cache` - GitHub CLI response cache

**Key Features:**
- pgvector extension for semantic similarity search
- 384-dimensional embeddings (local model compatible)
- Prompt deduplication via SHA-256 hashing

---

## Configuration

See `config.example.json` for all options. Key settings:

```json
{
  "llm": {
    "enabled": true,
    "provider": "copilot",
    "enablePromptSemanticSearch": true,
    "promptSemanticSearchThreshold": 0.85
  },
  "downloadLogs": true,
  "lazyLoading": true
}
```

---

## Analysis Flow Detail

### 1. Lazy Loading (Optimization)
**File:** `parseJobsLazy.js`

- Pattern-only analysis runs first without downloading logs
- Only downloads logs if pattern match is generic or fails
- Saves bandwidth and speeds up processing

### 2. Pattern Matching
**File:** `patternMatcher.js`

- Regex-based matching against known failure patterns
- Returns confidence score (0-1)
- Generic failures trigger LLM analysis

### 3. Prompt Semantic Search
**File:** `services/llmPromptService.js`

**Process:**
1. Build prompt context from error annotations + failed steps + logs
2. Generate SHA-256 hash for exact deduplication
3. Check for exact hash match in cache (instant)
4. If no exact match, generate embedding (50-100ms)
5. Search for similar prompts using cosine similarity
6. If similar prompt found with confidence > threshold, reuse result

**Benefits:**
- Avoids redundant LLM calls for similar failures
- 50-100ms vs 2-5s for LLM
- Free (uses local embedding model)

### 4. LLM Analysis
**File:** `services/rootCauseService.js`, `llm/llmClient.js`

**Only triggered when:**
- No pattern match OR generic failure pattern
- No similar historical prompt found
- LLM enabled in config

**Discriminated Union Response:**
```typescript
{ type: "root_cause", category, title, confidence, ... }
// OR
{ type: "need_more_info", requested_context }
```

---

## File References

### Entry Points
- `src/index.js` - Main CLI entry point
- `src/parseJobsLazy.js` - Lazy loading workflow parser

### Database
- `src/db/schema.js` - Complete consolidated schema
- `src/db/repository.js` - Data access layer
- `src/db/migrations/` - Schema migrations

### Configuration
- `src/configLoader.js` - Config validation and loading
- `config.json` - User configuration
- `.env` - Database credentials

---

## Performance Characteristics

| Detection Method | Speed | Cost | Accuracy |
|-----------------|-------|------|----------|
| Pattern Match | <1ms | Free | High (known patterns) |
| Prompt Cache (exact) | <1ms | Free | 100% (exact match) |
| Prompt Semantic Search | 50-100ms | Free | High (similar failures) |
| LLM Analysis | 2-5s | $$ | Variable (depends on model) |

---

## Testing

- `test/llmClient.test.js` - LLM client tests
- `test/promptBuilder.test.js` - Prompt builder tests
- `src/test-lazy-loading.js` - Lazy loading integration test

---

## Future Enhancements

See README.md roadmap section for planned improvements.

