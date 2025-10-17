# Semantic Search Implementation Plan v2

**Last Updated:** October 17, 2025  
**Status:** Planning Phase  
**Approach:** Pragmatic, incremental implementation with local embeddings

---

## 🎯 Core Strategy

### **Key Design Decisions**

1. ✅ **Local embeddings first** (Xenova/transformers.js) - zero cost, 50-100ms latency
2. ✅ **Async embedding generation** - configurable sync/async via config flag
3. ✅ **Batch clustering** - nightly cron job, not real-time
4. ✅ **Many-to-many job ↔ root cause** - multiple jobs can share root causes
5. ✅ **Simple similarity first** - use basic cosine until we have 100+ embeddings for IVFFlat

### **Progressive Rollout**

```
Phase 1: Core Schema (job_root_causes already exists ✅)
    ↓
Phase 2: Local Embedding Service (Xenova/transformers.js)
    ↓
Phase 3: Semantic Matching (find similar historical failures)
    ↓
Phase 4: Batch Clustering (nightly cron job)
    ↓
Phase 5: (Optional) Upgrade to OpenAI embeddings if needed
```

---

## 📊 Current State

### ✅ Already Done
- `job_root_causes` table with many-to-many relationship
- `annotation_embedding` column in `root_causes` (1536 dims)
- pgvector extension enabled
- Pattern matching + LLM fallback
- Confidence threshold enforcement

### 🔧 Schema Adjustments Needed
- Change `annotation_embedding VECTOR(1536)` → `VECTOR(384)` for local models
- Add `embedding_model VARCHAR(100)` to track which model generated the embedding
- Add `embedding_config JSONB` for model metadata
- Add optional fields to `root_causes`:
  - `discovery_method VARCHAR(50)` - how was this root cause first discovered
  - `last_seen_at TIMESTAMP` - when was this root cause last matched
  - `embedding_generated BOOLEAN DEFAULT FALSE` - flag for async processing

---

## 🏗️ Phase-by-Phase Implementation

### **Phase 1: Schema Enhancements** (2-3 hours)

**File:** `src/db/migratePhase3_v2.js`

```sql
-- Update root_causes table
ALTER TABLE root_causes 
ADD COLUMN IF NOT EXISTS discovery_method VARCHAR(50) DEFAULT 'pattern',
ADD COLUMN IF NOT EXISTS embedding_model VARCHAR(100),
ADD COLUMN IF NOT EXISTS embedding_config JSONB,
ADD COLUMN IF NOT EXISTS embedding_generated BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMP;

-- Change embedding dimension to 384 (local model compatible)
ALTER TABLE root_causes 
ALTER COLUMN annotation_embedding TYPE VECTOR(384);

-- Update index for new dimension
DROP INDEX IF EXISTS idx_root_causes_embedding;
CREATE INDEX idx_root_causes_embedding 
ON root_causes USING ivfflat (annotation_embedding vector_cosine_ops)
WITH (lists = 100);

-- Add index for async batch processing
CREATE INDEX IF NOT EXISTS idx_root_causes_no_embedding 
ON root_causes(embedding_generated) 
WHERE embedding_generated = FALSE;

-- Add composite index for semantic search
CREATE INDEX IF NOT EXISTS idx_root_causes_active 
ON root_causes(discovery_method, embedding_generated);
```

**Action Items:**
- [ ] Create migration script with up/down functions
- [ ] Test migration on local database
- [ ] Document rollback procedure

---

### **Phase 2: Local Embedding Service** (6-8 hours)

#### 2.1 Install Dependencies

```bash
npm install @xenova/transformers
```

**Why Xenova?**
- Pure JavaScript (no Python dependencies)
- Runs in Node.js
- Auto-downloads models (~80MB) on first use
- Supports sentence-transformers models
- MIT licensed

#### 2.2 Create Embedding Adapter

**File:** `src/llm/adapters/localEmbedAdapter.js`

```javascript
const { pipeline } = require('@xenova/transformers');

let embeddingPipeline = null;
const MODEL_NAME = 'Xenova/all-MiniLM-L6-v2';
const EMBEDDING_DIM = 384;

async function initialize() {
  if (!embeddingPipeline) {
    console.log('🔧 Loading local embedding model...');
    embeddingPipeline = await pipeline('feature-extraction', MODEL_NAME);
    console.log('✅ Local embedding model ready');
  }
}

async function generateEmbedding(text, options = {}) {
  await initialize();
  
  const startTime = Date.now();
  
  // Generate embedding
  const output = await embeddingPipeline(text, {
    pooling: 'mean',
    normalize: true
  });
  
  // Convert to array
  const embedding = Array.from(output.data);
  
  const duration = Date.now() - startTime;
  
  return {
    embedding,
    model: MODEL_NAME,
    dimensions: EMBEDDING_DIM,
    tokens: text.split(/\s+/).length, // Approximate
    duration_ms: duration
  };
}

async function generateBatch(texts, options = {}) {
  await initialize();
  
  const embeddings = await Promise.all(
    texts.map(text => generateEmbedding(text, options))
  );
  
  return embeddings;
}

module.exports = {
  generateEmbedding,
  generateBatch,
  MODEL_NAME,
  EMBEDDING_DIM
};
```

#### 2.3 Create Embedding Service

**File:** `src/services/embeddingService.js`

```javascript
const db = require('../db/db');
const localEmbedAdapter = require('../llm/adapters/localEmbedAdapter');

/**
 * Build context text for embedding from root cause
 */
function buildEmbeddingContext(rootCause) {
  const parts = [
    rootCause.category,
    rootCause.title,
    rootCause.description || '',
    rootCause.suggested_fix || ''
  ];
  
  return parts.filter(p => p).join(' | ');
}

/**
 * Generate and store embedding for a root cause
 */
async function generateRootCauseEmbedding(rootCauseId, adapter = localEmbedAdapter) {
  // Fetch root cause
  const result = await db.query(
    'SELECT * FROM root_causes WHERE id = $1',
    [rootCauseId]
  );
  
  if (result.rows.length === 0) {
    throw new Error(`Root cause ${rootCauseId} not found`);
  }
  
  const rootCause = result.rows[0];
  
  // Build embedding text
  const text = buildEmbeddingContext(rootCause);
  
  // Generate embedding
  const { embedding, model, dimensions, duration_ms } = await adapter.generateEmbedding(text);
  
  // Store embedding
  await db.query(
    `UPDATE root_causes 
     SET annotation_embedding = $1::vector,
         embedding_model = $2,
         embedding_config = $3,
         embedding_generated = TRUE,
         updated_at = NOW()
     WHERE id = $4`,
    [
      JSON.stringify(embedding),
      model,
      JSON.stringify({ dimensions, text_length: text.length, duration_ms }),
      rootCauseId
    ]
  );
  
  return { embedding, model, dimensions };
}

/**
 * Find similar root causes using cosine similarity
 */
async function findSimilarRootCauses(queryEmbedding, threshold = 0.75, limit = 5) {
  const result = await db.query(
    `SELECT 
       rc.id,
       rc.category,
       rc.title,
       rc.description,
       rc.suggested_fix,
       rc.occurrence_count,
       rc.discovery_method,
       1 - (rc.annotation_embedding <=> $1::vector) as similarity
     FROM root_causes rc
     WHERE rc.embedding_generated = TRUE
       AND 1 - (rc.annotation_embedding <=> $1::vector) >= $2
     ORDER BY rc.annotation_embedding <=> $1::vector
     LIMIT $3`,
    [JSON.stringify(queryEmbedding), threshold, limit]
  );
  
  return result.rows;
}

/**
 * Generate embeddings for query text (error annotations)
 */
async function generateQueryEmbedding(errorAnnotations, adapter = localEmbedAdapter) {
  const text = errorAnnotations
    .map(a => `${a.title || ''} ${a.message}`.trim())
    .join(' | ');
  
  const { embedding } = await adapter.generateEmbedding(text);
  return embedding;
}

/**
 * Batch process: generate embeddings for all root causes without embeddings
 */
async function generateMissingEmbeddings(adapter = localEmbedAdapter) {
  const result = await db.query(
    `SELECT id FROM root_causes 
     WHERE embedding_generated = FALSE 
     ORDER BY created_at DESC`
  );
  
  const rootCauseIds = result.rows.map(r => r.id);
  console.log(`📊 Found ${rootCauseIds.length} root causes without embeddings`);
  
  let processed = 0;
  for (const id of rootCauseIds) {
    try {
      await generateRootCauseEmbedding(id, adapter);
      processed++;
      console.log(`✅ Generated embedding for root cause ${id} (${processed}/${rootCauseIds.length})`);
    } catch (error) {
      console.error(`❌ Failed to generate embedding for root cause ${id}:`, error.message);
    }
  }
  
  return { total: rootCauseIds.length, processed };
}

/**
 * Get embedding statistics
 */
async function getStats() {
  const result = await db.query(`
    SELECT 
      COUNT(*) as total_root_causes,
      COUNT(*) FILTER (WHERE embedding_generated = TRUE) as with_embeddings,
      COUNT(*) FILTER (WHERE embedding_generated = FALSE) as without_embeddings,
      COUNT(DISTINCT embedding_model) as models_used
    FROM root_causes
  `);
  
  return result.rows[0];
}

module.exports = {
  generateRootCauseEmbedding,
  findSimilarRootCauses,
  generateQueryEmbedding,
  generateMissingEmbeddings,
  buildEmbeddingContext,
  getStats
};
```

---

### **Phase 3: Update Root Cause Service** (4-5 hours)

**File:** `src/services/rootCauseService.js`

Add new functions:

```javascript
const embeddingService = require('./embeddingService');

/**
 * Search for similar historical failures using embeddings
 */
async function findSimilarHistoricalFailure(errorAnnotations, config = {}) {
  const threshold = config.similarityThreshold || 0.75;
  const limit = config.similarityLimit || 5;
  
  try {
    // Generate embedding for error annotations
    const queryEmbedding = await embeddingService.generateQueryEmbedding(errorAnnotations);
    
    // Search for similar root causes
    const similar = await embeddingService.findSimilarRootCauses(queryEmbedding, threshold, limit);
    
    if (similar.length > 0) {
      const topMatch = similar[0];
      console.log(`🔍 Found similar failure: "${topMatch.title}" (similarity: ${topMatch.similarity.toFixed(3)})`);
      
      return {
        root_cause: topMatch,
        confidence: topMatch.similarity,
        method: 'semantic_search',
        alternatives: similar.slice(1)
      };
    }
  } catch (error) {
    console.warn('⚠️ Semantic search failed:', error.message);
  }
  
  return null;
}

/**
 * Link job to an existing root cause
 */
async function linkJobToRootCause(jobId, rootCauseId, method, confidence, metadata = {}) {
  await db.query(
    `INSERT INTO job_root_causes 
     (job_id, root_cause_id, confidence, detection_method, llm_model, llm_tokens_used, analysis_duration_ms, raw_analysis)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      jobId,
      rootCauseId,
      confidence,
      method,
      metadata.llm_model || null,
      metadata.llm_tokens || null,
      metadata.duration_ms || null,
      metadata.raw_analysis || null
    ]
  );
  
  // Update occurrence count and last_seen_at
  await db.query(
    `UPDATE root_causes 
     SET occurrence_count = occurrence_count + 1,
         last_seen_at = NOW(),
         updated_at = NOW()
     WHERE id = $1`,
    [rootCauseId]
  );
}

/**
 * Generate embedding for newly created root cause (async if configured)
 */
async function handleEmbeddingGeneration(rootCauseId, config = {}) {
  if (!config.embeddings?.enabled) {
    return;
  }
  
  if (config.embeddings?.generateSync) {
    // Synchronous: generate immediately
    try {
      await embeddingService.generateRootCauseEmbedding(rootCauseId);
      console.log(`✅ Generated embedding for root cause ${rootCauseId}`);
    } catch (error) {
      console.error(`❌ Failed to generate embedding:`, error.message);
    }
  } else {
    // Asynchronous: flag for batch processing
    console.log(`📝 Root cause ${rootCauseId} queued for embedding generation`);
  }
}

/**
 * Updated analyzeJob function with semantic search
 */
async function analyzeJob(jobId, errorAnnotations, failedSteps, context = {}) {
  const startTime = Date.now();
  
  // LEVEL 1: Pattern matching
  let result = matchPattern(errorAnnotations, failedSteps);
  if (result) {
    const rootCauseId = await persistRootCause(result, 'pattern');
    await linkJobToRootCause(jobId, rootCauseId, 'pattern', result.confidence, {
      duration_ms: Date.now() - startTime
    });
    await handleEmbeddingGeneration(rootCauseId, serviceOptions);
    return result;
  }
  
  // LEVEL 2: Semantic search (before expensive LLM call!)
  if (serviceOptions.embeddings?.enabled && serviceOptions.embeddings?.useForMatching) {
    const semanticMatch = await findSimilarHistoricalFailure(errorAnnotations, serviceOptions.embeddings);
    if (semanticMatch) {
      await linkJobToRootCause(
        jobId, 
        semanticMatch.root_cause.id, 
        'semantic_search', 
        semanticMatch.confidence,
        { duration_ms: Date.now() - startTime }
      );
      return semanticMatch.root_cause;
    }
  }
  
  // LEVEL 3: LLM analysis (most expensive, last resort)
  if (llmClient && serviceOptions.enableLLM) {
    const llmResult = await invokeLLM(jobId, errorAnnotations, failedSteps, context);
    if (llmResult?.discriminator === 'root_cause') {
      const rootCauseId = await persistRootCause(llmResult, 'llm');
      await linkJobToRootCause(jobId, rootCauseId, 'llm', llmResult.confidence, {
        llm_model: llmResult.model,
        llm_tokens: llmResult.tokens,
        duration_ms: Date.now() - startTime
      });
      await handleEmbeddingGeneration(rootCauseId, serviceOptions);
      return llmResult;
    }
  }
  
  return null;
}
```

---

### **Phase 4: Configuration** (1-2 hours)

**Update:** `config.example.json`

```json
{
  "llm": {
    "enabled": true,
    "provider": "openai",
    "model": "gpt-4o",
    "maxTokens": 1000,
    "temperature": 0.1,
    "confidenceThreshold": 0.8,
    "fallbackToPattern": true
  },
  "embeddings": {
    "enabled": true,
    "provider": "local",
    "model": "Xenova/all-MiniLM-L6-v2",
    "generateSync": false,
    "useForMatching": true,
    "similarityThreshold": 0.75,
    "similarityLimit": 5,
    "batchProcessing": {
      "enabled": true,
      "schedule": "0 2 * * *"
    }
  }
}
```

**Add:** `.env.example`

```bash
# Embedding Configuration
EMBEDDING_PROVIDER=local
EMBEDDING_GENERATE_SYNC=false
EMBEDDING_SIMILARITY_THRESHOLD=0.75

# Optional: OpenAI for embeddings (if switching from local)
# OPENAI_EMBEDDING_MODEL=text-embedding-3-small
```

---

### **Phase 5: Batch Processing Script** (2-3 hours)

**File:** `src/batchEmbeddings.js`

```javascript
#!/usr/bin/env node
const db = require('./db/db');
const embeddingService = require('./services/embeddingService');

async function main() {
  console.log('🚀 Starting batch embedding generation...');
  
  try {
    const connected = await db.testConnection();
    if (!connected) {
      console.error('❌ Database connection failed');
      process.exit(1);
    }
    
    const stats = await embeddingService.getStats();
    console.log('\n📊 Current Statistics:');
    console.log(`   Total root causes: ${stats.total_root_causes}`);
    console.log(`   With embeddings: ${stats.with_embeddings}`);
    console.log(`   Without embeddings: ${stats.without_embeddings}`);
    
    if (stats.without_embeddings === 0) {
      console.log('\n✅ All root causes already have embeddings!');
      return;
    }
    
    console.log(`\n🔧 Processing ${stats.without_embeddings} root causes...`);
    const result = await embeddingService.generateMissingEmbeddings();
    
    console.log('\n✨ Batch processing complete!');
    console.log(`   Processed: ${result.processed}/${result.total}`);
    
  } catch (error) {
    console.error('❌ Batch processing failed:', error);
    process.exit(1);
  } finally {
    await db.end();
  }
}

if (require.main === module) {
  main();
}

module.exports = { main };
```

**Add to package.json:**

```json
{
  "scripts": {
    "batch:embeddings": "node src/batchEmbeddings.js"
  }
}
```

**Cron setup (optional):**

```bash
# Add to crontab for nightly processing at 2 AM
0 2 * * * cd /path/to/log-processor && npm run batch:embeddings >> logs/batch.log 2>&1
```

---

### **Phase 6: Clustering** (8-10 hours) - **DEFERRED**

Clustering will be implemented in a follow-up phase once we have:
- 100+ root causes with embeddings
- Confidence in embedding quality
- Clear clustering requirements

---

## 🧪 Testing Strategy

### Phase 2: Embedding Service
```bash
# Test local embedding generation
node -e "
const adapter = require('./src/llm/adapters/localEmbedAdapter');
adapter.generateEmbedding('Test error message').then(result => {
  console.log('Model:', result.model);
  console.log('Dimensions:', result.dimensions);
  console.log('Duration:', result.duration_ms + 'ms');
});
"
```

### Phase 3: Semantic Search
```bash
# Run analysis with embeddings enabled
node src/index.js

# Check job_root_causes for semantic matches
psql -d log-process -c "SELECT detection_method, COUNT(*) FROM job_root_causes GROUP BY detection_method;"
```

### Phase 5: Batch Processing
```bash
# Run batch embedding generation
npm run batch:embeddings

# Verify embeddings were generated
psql -d log-process -c "SELECT embedding_generated, COUNT(*) FROM root_causes GROUP BY embedding_generated;"
```

---

## 📊 Success Metrics

- ✅ **Cold start**: Works on empty database (no embeddings initially)
- ✅ **Performance**: Embedding generation <100ms on CPU
- ✅ **Cost**: $0 (local embeddings)
- ✅ **Accuracy**: >70% of similar failures correctly matched (will tune threshold)
- ✅ **Coverage**: >90% of root causes have embeddings within 24 hours

---

## 🚧 Known Limitations & Future Work

### Limitations
1. Local embeddings are ~85-90% quality of OpenAI
2. No clustering initially (will add when we have 100+ root causes)
3. Cosine similarity only (no hybrid search with keywords yet)

### Future Enhancements
1. **Hybrid search**: Combine semantic + keyword matching
2. **Clustering**: DBSCAN-based clustering for issue grouping
3. **Reranking**: Use cross-encoder for better similarity ranking
4. **Feedback loop**: Track which semantic matches were helpful

---

## 📋 Implementation Checklist

### Phase 1: Schema (Week 1)
- [ ] Create `migratePhase3_v2.js` migration script
- [ ] Run migration on local database
- [ ] Update `discovery_method` enum values
- [ ] Test rollback procedure

### Phase 2: Embedding Service (Week 1-2)
- [ ] Install `@xenova/transformers`
- [ ] Create `localEmbedAdapter.js`
- [ ] Create `embeddingService.js`
- [ ] Test embedding generation (verify 384 dimensions)
- [ ] Benchmark performance (target <100ms)

### Phase 3: Root Cause Service Updates (Week 2)
- [ ] Add `findSimilarHistoricalFailure()` function
- [ ] Update `analyzeJob()` with semantic search
- [ ] Add `handleEmbeddingGeneration()` (sync/async logic)
- [ ] Test end-to-end flow

### Phase 4: Configuration (Week 2)
- [ ] Update `config.example.json` with embedding settings
- [ ] Add environment variables
- [ ] Document configuration options

### Phase 5: Batch Processing (Week 2-3)
- [ ] Create `batchEmbeddings.js` script
- [ ] Add npm script
- [ ] Test batch processing on 10+ root causes
- [ ] (Optional) Set up cron job

### Phase 6: Documentation (Week 3)
- [ ] Update README.md with embedding features
- [ ] Add troubleshooting guide
- [ ] Document similarity threshold tuning
- [ ] Add example outputs

---

## 💡 Quick Start Guide (After Implementation)

### Enable Embeddings

1. **Update config.json:**
   ```json
   {
     "embeddings": {
       "enabled": true,
       "generateSync": false
     }
   }
   ```

2. **Generate embeddings for existing root causes:**
   ```bash
   npm run batch:embeddings
   ```

3. **Run analysis with semantic search:**
   ```bash
   node src/index.js
   ```

4. **Check results:**
   ```bash
   psql -d log-process -c "
     SELECT detection_method, COUNT(*), AVG(confidence) 
     FROM job_root_causes 
     GROUP BY detection_method;
   "
   ```

---

## 🔄 Migration from Phase 3.0 to 3.1

If you already ran `migratePhase3.js`:

```bash
# Run incremental migration
node src/db/migratePhase3_v2.js up

# This will:
# 1. Add new columns (discovery_method, embedding_model, etc.)
# 2. Change embedding dimension 1536 → 384
# 3. Rebuild index for new dimension
# 4. Preserve existing data
```

---

**Next Steps:** Ready to implement Phase 1 (schema changes)?

