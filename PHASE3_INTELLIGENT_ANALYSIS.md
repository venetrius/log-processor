# Phase 3: Intelligent Analysis - Implementation Plan

## Overview

Implement AI-powered root cause analysis for GitHub Actions failures using a tiered approach: pattern matching → semantic search → LLM analysis.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Workflow Processing                       │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│              Check if Run Already Processed                  │
│                 (workflow_runs table)                        │
└─────────────────────────────────────────────────────────────┘
                            ↓
                     [New Run Only]
                            ↓
┌─────────────────────────────────────────────────────────────┐
│                   Parse Failed Jobs                          │
└─────────────────────────────────────────────────────────────┘
                            ↓
                  [For Each Failed Job]
                            ↓
┌─────────────────────────────────────────────────────────────┐
│     Level 1: Pattern Matching (Regex/String Match)          │
│     • API rate limits                                        │
│     • Missing dependencies                                   │
│     • Network timeouts                                       │
│     • Common test failures                                   │
└─────────────────────────────────────────────────────────────┘
                            ↓
                      [No Match?]
                            ↓
┌─────────────────────────────────────────────────────────────┐
│     Level 2: Semantic Similarity Search (pgvector)          │
│     • Generate embedding of error annotations                │
│     • Search for similar past failures                       │
│     • Threshold: similarity > 0.85                           │
└─────────────────────────────────────────────────────────────┘
                            ↓
                   [Low Similarity?]
                            ↓
┌─────────────────────────────────────────────────────────────┐
│     Level 3: LLM Analysis (Annotations Only)                │
│     • Send error annotations to LLM                          │
│     • Request root cause + confidence                        │
│     • Threshold: confidence > 0.8                            │
└─────────────────────────────────────────────────────────────┘
                            ↓
                    [Inconclusive?]
                            ↓
┌─────────────────────────────────────────────────────────────┐
│     Level 4: LLM Analysis (Full Logs)                       │
│     • Fetch full job logs                                    │
│     • Send to LLM with token limits                          │
│     • Extract root cause + suggested fix                     │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│              Save Root Cause + Link to Job                   │
└─────────────────────────────────────────────────────────────┘
```

## Database Schema Updates

### New Tables

#### `root_causes`
Stores identified root causes that can be reused across jobs.

```sql
CREATE TABLE root_causes (
  id SERIAL PRIMARY KEY,
  category VARCHAR(100) NOT NULL,           -- 'rate_limit', 'dependency_missing', 'test_flake', 'network_timeout', etc.
  title VARCHAR(255) NOT NULL,              -- Short description
  description TEXT,                         -- Detailed explanation
  pattern TEXT,                             -- Regex/string pattern for Level 1 matching
  annotation_embedding VECTOR(1536),        -- For semantic search (OpenAI text-embedding-3-small)
  suggested_fix TEXT,                       -- Recommended solution
  confidence_threshold FLOAT DEFAULT 0.85,  -- Minimum confidence to auto-assign
  occurrence_count INTEGER DEFAULT 1,       -- How many times seen
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_root_causes_category ON root_causes(category);
CREATE INDEX idx_root_causes_embedding ON root_causes USING ivfflat (annotation_embedding vector_cosine_ops);
```

#### `job_root_causes`
Links jobs to their identified root causes.

```sql
CREATE TABLE job_root_causes (
  id SERIAL PRIMARY KEY,
  job_id BIGINT NOT NULL REFERENCES jobs(job_id) ON DELETE CASCADE,
  root_cause_id INTEGER REFERENCES root_causes(id) ON DELETE SET NULL,
  confidence FLOAT NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  detection_method VARCHAR(50) NOT NULL,    -- 'pattern', 'similarity', 'llm_annotations', 'llm_full_logs'
  llm_model VARCHAR(100),                   -- e.g., 'gpt-4', 'claude-3-sonnet'
  llm_tokens_used INTEGER,                  -- Track cost
  analysis_duration_ms INTEGER,             -- Performance tracking
  raw_analysis TEXT,                        -- Full LLM response for review
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_job_root_causes_job_id ON job_root_causes(job_id);
CREATE INDEX idx_job_root_causes_root_cause_id ON job_root_causes(root_cause_id);
CREATE INDEX idx_job_root_causes_method ON job_root_causes(detection_method);
```

## Implementation Phases

### Phase 3.1: Foundation ✅ (1-2 hours)

**Goal:** Set up infrastructure for root cause analysis

**Tasks:**
- [x] Install pgvector extension in PostgreSQL
- [x] Create root_causes and job_root_causes tables
- [x] Add pattern-based root cause detector
- [x] Create seed data with common failure patterns
- [x] Refactor workflow processing to check if run already exists
- [x] Update index.js to skip already-processed runs

**Deliverables:**
- Schema migration script with new tables
- `patternMatcher.js` module with regex-based detection
- `seedRootCauses.js` script to populate initial patterns
- Updated workflow processing logic

### Phase 3.2: Semantic Search (2-3 hours)

**Goal:** Enable similarity-based root cause matching

**Tasks:**
- [ ] Install OpenAI SDK (or alternative embedding provider)
- [ ] Create `embeddings.js` module for generating embeddings
- [ ] Implement similarity search function using pgvector
- [ ] Add embeddings to existing root_causes
- [ ] Update root cause detection to use similarity search

**Deliverables:**
- `embeddings.js` with embedding generation
- `similaritySearch.js` for vector search
- Migration script to add embeddings to seed data

### Phase 3.3: LLM Integration (3-4 hours)

**Goal:** Use LLM for complex failure analysis

**Tasks:**
- [ ] Choose LLM provider (OpenAI GPT-4, Anthropic Claude, etc.)
- [ ] Create `llmAnalyzer.js` module
- [ ] Design prompt templates for root cause analysis
- [ ] Implement annotation-only analysis
- [ ] Implement full-log analysis with token management
- [ ] Add cost tracking and limits
- [ ] Implement response caching

**Deliverables:**
- `llmAnalyzer.js` with analysis functions
- `prompts/` directory with prompt templates
- Configuration for LLM settings (model, max tokens, etc.)

### Phase 3.4: Learning System (nice-to-have)

**Goal:** Improve accuracy over time

**Tasks:**
- [ ] When LLM identifies new root cause, save pattern for future matching
- [ ] Add confidence scoring feedback loop
- [ ] Create admin UI/CLI for reviewing and approving root causes
- [ ] Implement A/B testing for different prompts
- [ ] Add metrics dashboard

**Deliverables:**
- Feedback mechanism
- Root cause review CLI
- Analytics queries

## Configuration Updates

Add to `config.json`:

```json
{
  "rootCauseAnalysis": {
    "enabled": true,
    "skipExistingRuns": true,
    "patternMatching": {
      "enabled": true
    },
    "semanticSearch": {
      "enabled": true,
      "similarityThreshold": 0.85,
      "embeddingModel": "text-embedding-3-small"
    },
    "llm": {
      "enabled": true,
      "provider": "openai",
      "model": "gpt-4o-mini",
      "maxTokens": 2000,
      "confidenceThreshold": 0.8,
      "maxCostPerRun": 0.50
    }
  }
}
```

Add to `.env`:

```env
# LLM Configuration
OPENAI_API_KEY=your_key_here
# or
ANTHROPIC_API_KEY=your_key_here
```

## Cost Estimation

### Embedding Costs (OpenAI text-embedding-3-small)
- $0.020 per 1M tokens
- ~100 tokens per error annotation
- Cost per job: ~$0.000002

### LLM Costs (GPT-4o-mini)
- Input: $0.150 per 1M tokens
- Output: $0.600 per 1M tokens
- Annotation-only: ~500 input + 200 output = $0.00015 per job
- Full logs: ~5000 input + 500 output = $0.00105 per job

**Estimated cost per failed job with LLM analysis: $0.001 - $0.002**

## Common Root Cause Patterns (Seed Data)

1. **GitHub API Rate Limit**
   - Pattern: `API rate limit exceeded`
   - Category: `rate_limit`
   - Fix: Wait for rate limit reset or use a different token

2. **Missing Docker Image**
   - Pattern: `Error.*artifact.*not found`
   - Category: `dependency_missing`
   - Fix: Check if Docker image exists and repository access

3. **Network Timeout**
   - Pattern: `(timeout|timed out|connection.*refused)`
   - Category: `network_timeout`
   - Fix: Retry the job or check network connectivity

4. **NPM Install Failure**
   - Pattern: `npm ERR!|Failed to install dependencies`
   - Category: `dependency_missing`
   - Fix: Check package.json and npm registry availability

5. **Test Flake**
   - Pattern: `(flaky|intermittent|randomly fail)`
   - Category: `test_flake`
   - Fix: Review test for race conditions or timing issues

6. **Out of Memory**
   - Pattern: `(OOM|out of memory|heap.*out of memory)`
   - Category: `resource_limit`
   - Fix: Increase memory allocation for the job

7. **Exit Code 1 (Generic)**
   - Pattern: `Process completed with exit code 1`
   - Category: `generic_failure`
   - Fix: Requires log analysis to determine specific cause

## Success Metrics

- **Detection Rate**: % of failures with identified root cause
- **Accuracy**: % of correct root cause identifications (requires manual review)
- **Cost**: Average cost per analyzed job
- **Speed**: Average time to analyze a job
- **Reuse Rate**: % of jobs using cached root causes vs. new LLM calls

## Future Enhancements

- Cluster similar failures across different repositories
- Trend analysis: "This error is becoming more common"
- Proactive alerts: "Pattern detected that often leads to failures"
- Integration with issue tracking (auto-create GitHub issues)
- Root cause dashboard with visualizations

