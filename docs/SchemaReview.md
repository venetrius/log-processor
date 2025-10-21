# Database Schema Review

**Last Updated:** October 21, 2025  
**Status:** ✅ **CURRENT** - Schema is complete and production-ready

---

## Schema Overview

The database schema supports the three-tier intelligent analysis system with semantic search capabilities.

### Quick Start Commands

```bash
npm run db:init      # Reset database + seed patterns (recommended for dev)
npm run db:reset     # Drop and recreate all tables
npm run db:seed      # Seed root cause patterns
```

---

## Core Tables

### Workflow Tracking
- **`workflow_runs`** - Workflow execution metadata (run_id, workflow_name, conclusion, timestamps)
- **`jobs`** - Job details (job_id, job_name, conclusion, log_file_path, logs_accessible)
- **`job_steps`** - Individual step failures
- **`error_annotations`** - GitHub error messages

### Intelligence & Analysis
- **`root_causes`** - Identified failure patterns with embeddings
  - `annotation_embedding vector(384)` - Root cause embeddings for semantic search
  - `embedding_model` - Tracks which model generated the embedding
  - `embedding_config` - JSONB metadata (dimensions, duration, etc.)
  - `discovery_method` - 'pattern', 'llm', 'manual'
  - `last_seen_at` - Last occurrence timestamp
  
- **`job_root_causes`** - Many-to-many linking jobs to root causes
  - Stores confidence, detection method, LLM metadata, analysis duration
  
- **`llm_prompts`** - Prompt caching and semantic search
  - `prompt_hash` - SHA-256 for exact deduplication
  - `prompt_embedding vector(384)` - For similarity search
  - `root_cause_id` - Linked result
  - `reused_count` - Usage tracking

### Caching
- **`gh_cli_cache`** - GitHub CLI response cache for development

---

## Key Features

### pgvector Extension
- Enabled for semantic similarity search
- 384-dimensional embeddings (local model: `Xenova/all-MiniLM-L6-v2`)
- IVFFlat indexes for efficient cosine similarity queries

### Indexes
```sql
-- Semantic search indexes
idx_root_causes_embedding (ivfflat on annotation_embedding)
idx_llm_prompts_embedding (ivfflat on prompt_embedding)

-- Hash lookup (exact deduplication)
idx_llm_prompts_hash (on prompt_hash)

-- Batch processing
idx_root_causes_no_embedding (partial index for async embedding generation)
```

---

## Schema File

**Single Source of Truth:** `src/db/schema.js`

All schema definitions consolidated into one file. Migration scripts in `src/db/migrations/` for incremental changes.

---

## See Also

- `docs/ARCHITECTURE.md` - System architecture
- `src/db/schema.js` - Complete schema definition
- `src/db/repository.js` - Data access layer
