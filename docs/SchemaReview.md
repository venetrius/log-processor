# Database Schema Review - Semantic Search Readiness

**Date:** October 17, 2025  
**Status:** ✅ **Phase 3.2 COMPLETE** - All semantic search features implemented!  
**Schema Version:** Consolidated (schema.js includes all features)

---

## ✅ COMPLETED - Schema is Ready for Semantic Search!

All identified issues have been resolved. The consolidated schema now includes:

### **✅ Resolved Issues:**

1. ✅ **Embedding Dimension** - Changed from 1536 → 384 (local model compatible)
2. ✅ **Embedding Metadata** - Added `embedding_model`, `embedding_config` (JSONB), `embedding_generated`
3. ✅ **Discovery Tracking** - Added `discovery_method` and `last_seen_at`
4. ✅ **Unique Constraint** - Added to prevent duplicate root causes
5. ✅ **Batch Processing Index** - Added partial index for finding root causes needing embeddings
6. ✅ **Schema Consolidation** - Merged into single `schema.js` file
7. ✅ **NPM Scripts** - Added convenient database commands

### **🚀 Quick Start Commands:**
```bash
npm run db:init      # Reset database + seed patterns (recommended for dev)
npm run db:reset     # Drop and recreate all tables
npm run db:seed      # Seed root cause patterns
```

---

## 📊 Current Schema Analysis (UPDATED)

### **Table 1: `root_causes`**

```sql
CREATE TABLE root_causes (
    id SERIAL PRIMARY KEY,
    category VARCHAR(100) NOT NULL,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    pattern TEXT,
    annotation_embedding VECTOR(384),  -- Changed to 384 dims for local model compatibility
    embedding_model VARCHAR(100),       -- Track which model was used
    embedding_config JSONB,             -- Store metadata (dimensions, duration, etc.)
    embedding_generated BOOLEAN DEFAULT FALSE,  -- Flag for async processing
    suggested_fix TEXT,
    confidence_threshold FLOAT DEFAULT 0.85,
    occurrence_count INTEGER DEFAULT 1,
    discovery_method VARCHAR(50) DEFAULT 'pattern',  -- 'pattern', 'llm', 'manual'
    last_seen_at TIMESTAMP,                           -- When was this last matched?
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

**Current Data Sample:**
- 10 seed root causes (from pattern matching)
- Categories: `rate_limit`, `dependency_missing`, `network_timeout`, `test_failure`, etc.
- All have `pattern` field for regex matching
- All have `annotation_embedding = NULL` (no embeddings generated yet)

**Indexes:**
- ✅ `idx_root_causes_category` on `category`
- ✅ `idx_root_causes_embedding` - IVFFlat for cosine similarity (ready for pgvector)

---

### **Table 2: `job_root_causes`** (Junction Table)

```sql
CREATE TABLE job_root_causes (
    id SERIAL PRIMARY KEY,
    job_id BIGINT NOT NULL REFERENCES jobs(job_id) ON DELETE CASCADE,
    root_cause_id INTEGER REFERENCES root_causes(id) ON DELETE SET NULL,
    confidence FLOAT NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
    detection_method VARCHAR(50) NOT NULL,  -- 'pattern', 'llm', 'semantic_search'
    llm_model VARCHAR(100),
    llm_tokens_used INTEGER,
    analysis_duration_ms INTEGER,
    raw_analysis TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

**Indexes:**
- ✅ `idx_job_root_causes_job_id` on `job_id`
- ✅ `idx_job_root_causes_root_cause_id` on `root_cause_id`
- ✅ `idx_job_root_causes_method` on `detection_method`

---

## ✅ What's Working Well

### 1. **Excellent Junction Table Design**
The `job_root_causes` table already implements many-to-many relationships correctly:
- ✅ Multiple jobs can link to the same root cause (reuse!)
- ✅ Tracks `detection_method` ('pattern', 'llm', 'semantic_search')
- ✅ Stores confidence scores
- ✅ Captures LLM metadata (model, tokens, duration)
- ✅ Has all the indexes we need

**This is exactly what we discussed!** 👏

### 2. **pgvector Extension Enabled**
- ✅ `CREATE EXTENSION vector` already done
- ✅ IVFFlat index already created
- ✅ Ready for vector similarity search

### 3. **Good Separation of Concerns**
- ✅ `root_causes` stores the knowledge base
- ✅ `job_root_causes` stores the analysis results
- ✅ Clean foreign keys with proper CASCADE behavior

### 4. **Seed Data Ready**
You already have 10 root causes seeded with:
- ✅ Realistic categories
- ✅ Pattern regexes for matching
- ✅ Suggested fixes
- ✅ Confidence thresholds

---

## ⚠️ Issues & Gaps for Semantic Search

### **Issue 1: Embedding Dimension Mismatch** 🔴 CRITICAL

**Current:**
```sql
annotation_embedding VECTOR(1536)  -- OpenAI ada-002 size
```

**Problem:**
- Local models (Xenova/all-MiniLM-L6-v2) generate 384-dimensional embeddings
- We can't store 384-dim vectors in a 1536-dim column
- Options:
  1. **Change to 384** (requires migration, but you said DB can be dropped)
  2. **Pad to 1536** (wastes space, less efficient)
  3. **Use OpenAI** (costs money)

**Recommendation:** Change to 384 dimensions for local embeddings.

---

### **Issue 2: Missing Embedding Metadata** 🟡 IMPORTANT

**Current:** No way to track which model generated an embedding

**Needed:**
```sql
embedding_model VARCHAR(100)           -- Track which model was used
embedding_config JSONB                 -- Store metadata (dimensions, duration, etc.)
embedding_generated BOOLEAN DEFAULT FALSE  -- Flag for async processing
```

**Why?**
- If we switch models, we need to regenerate embeddings
- Batch processing needs to know which root causes need embeddings
- Debugging: know if embedding failed or was never attempted

---

### **Issue 3: Missing Discovery Tracking** 🟡 IMPORTANT

**Current:** No way to distinguish how a root cause was first created

**Needed:**
```sql
discovery_method VARCHAR(50) DEFAULT 'pattern'  -- 'pattern', 'llm', 'manual'
last_seen_at TIMESTAMP                           -- When was this last matched?
```

**Why?**
- **discovery_method**: Track how each root cause entered the system
  - `pattern`: From seed data or pattern matcher
  - `llm`: LLM created a new root cause
  - `manual`: Human-added via admin interface (future)
  
- **last_seen_at**: Track which root causes are still relevant
  - Helps identify stale patterns
  - Shows trending failures

**Note:** Different from `detection_method` in `job_root_causes`:
- `root_causes.discovery_method` = how the root cause was **created**
- `job_root_causes.detection_method` = how a specific job was **matched** to it

---

### **Issue 4: No Unique Constraint on Root Causes** 🟢 NICE-TO-HAVE

**Current:** No constraint preventing duplicate root causes

**Risk:**
- LLM might create "NPM Install Failed" when we already have it
- Results in duplicate knowledge base entries

**Potential Solution:**
```sql
CREATE UNIQUE INDEX idx_root_causes_unique_title 
ON root_causes(category, title);
```

**Caveat:** This might be too strict. LLM-generated titles might vary slightly. Maybe handle in application logic instead.

---

### **Issue 5: IVFFlat Index Configuration** 🟢 OPTIMIZATION

**Current:**
```sql
CREATE INDEX idx_root_causes_embedding 
USING ivfflat (annotation_embedding vector_cosine_ops)
WITH (lists = 100);
```

**Analysis:**
- `lists = 100` is reasonable for 100-10,000 vectors
- IVFFlat performs best with `lists ≈ sqrt(num_rows)`
- With 10 rows currently, the index won't be used (falls back to sequential scan)

**Recommendation:**
- Keep the index as-is
- Once you have 100+ root causes, consider adjusting `lists`
- Monitor query performance: `EXPLAIN ANALYZE SELECT ... ORDER BY embedding <=> ...`

---

## 📋 Schema Change Proposal

### **Option A: Minimal Changes (Recommended)**

Add only what's absolutely necessary for semantic search:

```sql
-- 1. Change embedding dimension
ALTER TABLE root_causes 
ALTER COLUMN annotation_embedding TYPE VECTOR(384);

-- 2. Add embedding metadata
ALTER TABLE root_causes 
ADD COLUMN embedding_model VARCHAR(100),
ADD COLUMN embedding_generated BOOLEAN DEFAULT FALSE;

-- 3. Add discovery tracking
ALTER TABLE root_causes 
ADD COLUMN discovery_method VARCHAR(50) DEFAULT 'pattern',
ADD COLUMN last_seen_at TIMESTAMP;

-- 4. Rebuild index for new dimension
DROP INDEX idx_root_causes_embedding;
CREATE INDEX idx_root_causes_embedding 
ON root_causes USING ivfflat (annotation_embedding vector_cosine_ops)
WITH (lists = 100);

-- 5. Add index for batch processing
CREATE INDEX idx_root_causes_no_embedding 
ON root_causes(embedding_generated) 
WHERE embedding_generated = FALSE;

-- 6. Update existing seed data
UPDATE root_causes 
SET discovery_method = 'pattern',
    embedding_generated = FALSE;
```

---

### **Option B: Full-Featured (Future-Proof)**

Add everything we might need:

```sql
-- Everything from Option A, plus:

ALTER TABLE root_causes 
ADD COLUMN embedding_config JSONB,           -- Store full metadata
ADD COLUMN source_annotations TEXT[],        -- Which annotations led to this
ADD COLUMN related_root_causes INTEGER[],    -- Manual links to similar causes
ADD COLUMN is_active BOOLEAN DEFAULT TRUE;   -- Soft delete for deprecated patterns

-- Add unique constraint (optional)
CREATE UNIQUE INDEX idx_root_causes_unique 
ON root_causes(category, title) 
WHERE is_active = TRUE;
```

---

## 🤔 Discussion Questions

### **Q1: Embedding Dimension - Which Size?**

Your current schema uses `VECTOR(1536)` but you have no embeddings yet. Should we:

- **Option A** (Recommended): Change to `VECTOR(384)` for local models
  - Pros: Efficient, free, faster
  - Cons: If you switch to OpenAI later, need another migration
  
- **Option B**: Keep `VECTOR(1536)` and pad local embeddings
  - Pros: Compatible with OpenAI if you switch
  - Cons: Wastes 75% of space, slower queries
  
- **Option C**: Use OpenAI embeddings from the start
  - Pros: Better quality, no migration needed
  - Cons: Costs money (~$0.0001 per embedding)

**My recommendation:** Option A. You can always migrate later if needed.

---

### **Q2: Discovery Method - Do You Care?**

Should we track how each root cause was created?

- **Use case 1:** "Show me all LLM-discovered root causes that aren't in patterns yet"
- **Use case 2:** "Which pattern-based root causes haven't matched in 30 days?"
- **Use case 3:** "Compare accuracy: pattern vs LLM vs semantic"

If these use cases matter, add `discovery_method`. If not, skip it.

**My recommendation:** Add it. It's one column and very useful for debugging.

---

### **Q3: Embedding Metadata - How Much?**

Should we store just the model name, or full metadata?

**Minimal:**
```sql
embedding_model VARCHAR(100)  -- Just "Xenova/all-MiniLM-L6-v2"
```

**Full:**
```sql
embedding_model VARCHAR(100)
embedding_config JSONB  -- { dimensions: 384, duration_ms: 45, text_length: 120 }
```

**My recommendation:** Start minimal, add JSONB later if you need debugging info.

---

### **Q4: Should We Migrate Now or Reset?**

Since you mentioned the DB can be dropped/recreated:

- **Option A: Reset**: Drop all tables, update `migratePhase3.js`, recreate from scratch
  - Pros: Clean slate, simpler
  - Cons: Lose any test data
  
- **Option B: Migrate**: Write migration script to alter existing tables
  - Pros: Keeps existing data
  - Cons: More complex script

**My recommendation:** Reset if you have no important data. Faster and cleaner.

---

## 🎯 Recommended Action Plan

### **Step 1: Update Schema (30 min)**

Create `migratePhase3_v2.js` that:
1. Drops existing `root_causes` and `job_root_causes`
2. Recreates with `VECTOR(384)` and new columns
3. Re-seeds the 10 root causes

### **Step 2: Merge into Main Schema (15 min)**

Eventually merge `migratePhase3.js` into `schema.js` so `node schema.js create` includes everything.

### **Step 3: Test (15 min)**

Run through full cycle:
1. `node schema.js reset`
2. `node migratePhase3_v2.js up`
3. Verify tables and seed data

---

## 📊 Schema Comparison Matrix

| Feature | Current | Needed for Semantic Search | Priority |
|---------|---------|---------------------------|----------|
| Many-to-many job ↔ root cause | ✅ Yes | ✅ Yes | - |
| Embedding storage (vector type) | ✅ Yes (1536) | ⚠️ Yes (384) | 🔴 High |
| Embedding model tracking | ❌ No | ✅ Yes | 🟡 Medium |
| Embedding generation flag | ❌ No | ✅ Yes | 🟡 Medium |
| Discovery method tracking | ❌ No | ✅ Yes | 🟡 Medium |
| Last seen timestamp | ❌ No | ✅ Yes | 🟢 Low |
| IVFFlat index | ✅ Yes | ✅ Yes | - |
| Detection method tracking | ✅ Yes | ✅ Yes | - |
| Confidence scores | ✅ Yes | ✅ Yes | - |
| LLM metadata | ✅ Yes | ✅ Yes | - |

---

## ✅ Final Assessment

**Overall:** Your current schema is **85% ready** for semantic search! 🎉

**What's Great:**
- ✅ Junction table design is perfect
- ✅ pgvector extension enabled
- ✅ Indexes in place
- ✅ Detection method tracking works

**What Needs Fixing:**
- 🔴 Embedding dimension (1536 → 384)
- 🟡 Add embedding metadata columns
- 🟡 Add discovery tracking columns
- 🟢 Minor optimizations

**Estimated Work:** 1-2 hours to update schema and test.

---

## 🚀 Next Steps

1. **Review this document** - Agree on which columns to add
2. **Decide on migration strategy** - Reset or migrate?
3. **I'll create the updated migration script** - Based on your preferences
4. **Test the new schema** - Verify everything works
5. **Start implementing embedding service** - Phase 2 of semantic search plan

**Ready to proceed?** Let me know your answers to the 4 discussion questions and I'll create the updated migration script!
