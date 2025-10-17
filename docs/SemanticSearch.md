# Semantic Search Implementation Plan

## 🎯 Vision Summary

1. **Error Annotations Analysis** → Pattern matching with regex
2. **LLM Fallback** → If no pattern match, use LLM to analyze
3. **Embedding Generation** → Calculate embeddings for all root causes
4. **Semantic Search** → Find similar failures using vector similarity
5. **Clustering** → Group similar failures for GitHub issue creation

---

## 📊 Current State Assessment

### ✅ Already Implemented
- Pattern-based root cause detection (Level 1)
- LLM fallback with discriminated union responses (Level 2)
- Database schema for root causes and job associations
- Mock and real LLM adapters
- Confidence threshold enforcement

### ❌ Missing Components
- Embedding generation module
- Vector storage for embeddings (pgvector tables)
- Semantic similarity search
- Clustering algorithm
- New root cause source type: `error_annotations`
- LLM metadata for embedding construction

---

## 🏗️ Architecture Changes

```
┌─────────────────────────────────────────────────────────────┐
│                    index.js (Entry Point)                    │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│         services/rootCauseService.js (Orchestrator)          │
│  1. Pattern matching → source: 'pattern'                     │
│  2. LLM analysis → source: 'llm'                            │
│  3. NEW: Embedding generation                               │
│  4. NEW: Semantic search for similar failures               │
│  5. Persist with embeddings                                 │
└─────────────────────────────────────────────────────────────┘
            ↓                    ↓                    ↓
┌───────────────────┐  ┌──────────────────┐  ┌──────────────────┐
│ patternMatcher.js │  │   llmClient.js   │  │ embeddingService │
└───────────────────┘  └──────────────────┘  │ - generateEmbed  │
                                             │ - searchSimilar  │
                                             │ - clusterErrors  │
                                             └──────────────────┘
                                                     ↓
                                         ┌──────────────────────┐
                                         │ adapters/            │
                                         │ - openaiEmbed.js     │
                                         │ - copilotEmbed.js    │
                                         └──────────────────────┘
```

---

## 📋 Implementation Steps

### **Phase 1: Database Schema Extensions** (2-3 hours)

#### 1.1 Add `source` field to root causes
```sql
ALTER TABLE root_causes 
ADD COLUMN source VARCHAR(50) DEFAULT 'pattern' 
CHECK (source IN ('pattern', 'llm', 'error_annotations', 'semantic_search'));
```

#### 1.2 Create embeddings table
```sql
CREATE TABLE root_cause_embeddings (
    id SERIAL PRIMARY KEY,
    root_cause_id INTEGER REFERENCES root_causes(id) ON DELETE CASCADE,
    embedding vector(1536),  -- OpenAI ada-002 dimension
    embedding_model VARCHAR(100) DEFAULT 'text-embedding-ada-002',
    embedding_text TEXT,  -- Text used to generate embedding
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_embedding_cosine ON root_cause_embeddings 
USING ivfflat (embedding vector_cosine_ops);
```

#### 1.3 Add metadata fields for LLM-sourced root causes
```sql
ALTER TABLE root_causes
ADD COLUMN llm_metadata JSONB,  -- Store LLM-specific data
ADD COLUMN embedding_context TEXT;  -- Combined text for embedding
```

#### 1.4 Create clusters table
```sql
CREATE TABLE failure_clusters (
    id SERIAL PRIMARY KEY,
    cluster_name VARCHAR(200),
    description TEXT,
    centroid_embedding vector(1536),
    member_count INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE cluster_members (
    cluster_id INTEGER REFERENCES failure_clusters(id) ON DELETE CASCADE,
    root_cause_id INTEGER REFERENCES root_causes(id) ON DELETE CASCADE,
    similarity_score FLOAT,
    PRIMARY KEY (cluster_id, root_cause_id)
);
```

#### 1.5 Migration script
```bash
node migratePhase3_SemanticSearch.js up
```

---

### **Phase 2: Embedding Service** (4-5 hours)

#### 2.1 Create embedding adapters

**`llm/adapters/openaiEmbedAdapter.js`**
```javascript
async function generateEmbedding(text, options = {}) {
    // POST to OpenAI embeddings endpoint
    // Returns: { embedding: [1536 floats], model: 'text-embedding-ada-002', tokens: 123 }
}
```

**`llm/adapters/copilotEmbedAdapter.js`** (future)
```javascript
// Similar interface but uses GitHub Copilot
```

#### 2.2 Create embedding service

**`services/embeddingService.js`**
```javascript
module.exports = {
    // Generate embedding for a root cause
    async generateRootCauseEmbedding(rootCause, adapter) {
        const text = buildEmbeddingContext(rootCause);
        const { embedding, model, tokens } = await adapter.generateEmbedding(text);
        await storeEmbedding(rootCause.id, embedding, model, text);
        return embedding;
    },
    
    // Search for similar failures
    async findSimilarFailures(embedding, threshold = 0.85, limit = 10) {
        // Cosine similarity search using pgvector
    },
    
    // Helper: Build context text for embedding
    buildEmbeddingContext(rootCause) {
        return `${rootCause.category} | ${rootCause.title} | ${rootCause.description} | ${rootCause.suggested_fix || ''}`;
    }
};
```

---

### **Phase 3: Update Root Cause Service** (3-4 hours)

#### 3.1 Modify detection flow

**`services/rootCauseService.js`** - Updated `analyzeJob()` function:

```javascript
async function analyzeJob(jobId, errorAnnotations, failedSteps, context) {
    const startTime = Date.now();
    
    // LEVEL 1: Pattern matching (existing)
    let result = patternMatcher.matchPattern(errorAnnotations, failedSteps);
    if (result) {
        result.source = 'pattern';
        await persistResult(jobId, result, 'pattern', startTime);
        await generateAndStoreEmbedding(result);
        await findAndLinkSimilarFailures(result);
        return result;
    }
    
    // LEVEL 2: LLM analysis (existing, with new metadata)
    if (llmClient) {
        const llmResult = await invokeLLM(jobId, errorAnnotations, failedSteps, context);
        if (llmResult && llmResult.discriminator === 'root_cause') {
            llmResult.source = 'llm';
            llmResult.llm_metadata = {
                model: llmResult.model,
                tokens: llmResult.tokens,
                timestamp: new Date().toISOString()
            };
            await persistResult(jobId, llmResult, 'llm', startTime);
            await generateAndStoreEmbedding(llmResult);
            await findAndLinkSimilarFailures(llmResult);
            return llmResult;
        }
    }
    
    // LEVEL 3: Semantic search (NEW)
    const semanticResult = await searchSimilarViaSemantic(errorAnnotations, failedSteps);
    if (semanticResult) {
        semanticResult.source = 'semantic_search';
        await persistResult(jobId, semanticResult, 'semantic_search', startTime);
        return semanticResult;
    }
    
    return null;
}
```

#### 3.2 Add semantic search function

```javascript
async function searchSimilarViaSemantic(errorAnnotations, failedSteps) {
    // Build query text from error annotations
    const queryText = errorAnnotations.map(a => a.message).join(' | ');
    
    // Generate embedding for query
    const embedAdapter = createEmbeddingAdapter(config.embedding);
    const { embedding } = await embedAdapter.generateEmbedding(queryText);
    
    // Search for similar failures
    const similar = await embeddingService.findSimilarFailures(embedding, 0.85, 5);
    
    if (similar.length > 0) {
        const topMatch = similar[0];
        return {
            ...topMatch.root_cause,
            confidence: topMatch.similarity_score,
            method: 'semantic_search',
            matched_via_embedding: true
        };
    }
    
    return null;
}
```

---

### **Phase 4: Clustering Implementation** (5-6 hours)

#### 4.1 Create clustering service

**`services/clusteringService.js`**
```javascript
module.exports = {
    // Cluster all root causes using DBSCAN or K-means
    async clusterRootCauses(minSimilarity = 0.85, minClusterSize = 3) {
        // 1. Get all root_cause_embeddings
        // 2. Run clustering algorithm (DBSCAN via cosine distance)
        // 3. Create failure_clusters entries
        // 4. Link cluster_members
        // 5. Return cluster summary
    },
    
    // Find or create cluster for a new root cause
    async assignToCluster(rootCauseId, embedding) {
        // 1. Search for existing cluster centroid within threshold
        // 2. If found: add to cluster, update centroid
        // 3. If not: create new cluster
    },
    
    // Get cluster summary for reporting
    async getClusterSummary() {
        // Return: cluster_name, member_count, top_failures
    }
};
```

#### 4.2 Add clustering to workflow

**In `services/rootCauseService.js`:**
```javascript
async function findAndLinkSimilarFailures(result) {
    const embedding = await embeddingService.generateRootCauseEmbedding(result, embedAdapter);
    await clusteringService.assignToCluster(result.id, embedding);
}
```

---

### **Phase 5: Configuration & Integration** (2-3 hours)

#### 5.1 Add embedding config

**`config.json`** (new section):
```json
{
  "embedding": {
    "enabled": true,
    "provider": "openai",  // or "copilot"
    "model": "text-embedding-ada-002",
    "apiKey": "${OPENAI_API_KEY}",
    "similarityThreshold": 0.85,
    "clustering": {
      "enabled": true,
      "minSimilarity": 0.85,
      "minClusterSize": 3,
      "updateInterval": "daily"  // or "on-demand"
    }
  }
}
```

#### 5.2 Update `.env.example`
```bash
# Embedding configuration
OPENAI_API_KEY=sk-...
ENABLE_SEMANTIC_SEARCH=true
SIMILARITY_THRESHOLD=0.85
```

---

### **Phase 6: Reporting & Visualization** (3-4 hours)

#### 6.1 Create cluster report script

**`clusterReport.js`**
```javascript
async function generateClusterReport() {
    const clusters = await clusteringService.getClusterSummary();
    
    console.log('\n🔍 Failure Cluster Analysis');
    for (const cluster of clusters) {
        console.log(`\n📦 Cluster: ${cluster.cluster_name}`);
        console.log(`   Members: ${cluster.member_count}`);
        console.log(`   Top failures:`);
        for (const member of cluster.top_failures) {
            console.log(`   - ${member.title} (${member.occurrence_count}x)`);
        }
        console.log(`   Suggested GitHub issue: ${cluster.suggested_issue_title}`);
    }
}
```

#### 6.2 Add semantic search stats to output

**In `index.js`:**
```javascript
// Display semantic search statistics
const semanticStats = await embeddingService.getStats();
console.log(`\n🔍 Semantic Search:`);
console.log(`   Embeddings generated: ${semanticStats.total_embeddings}`);
console.log(`   Similar failures found: ${semanticStats.similar_matches}`);
console.log(`   Clusters: ${semanticStats.cluster_count}`);
```

---

## 🧪 Testing Strategy

### Phase 1: Database Tests
- [ ] Verify embedding table schema
- [ ] Test pgvector cosine similarity queries
- [ ] Verify foreign key constraints

### Phase 2: Embedding Service Tests
- [ ] Mock adapter returns valid embeddings
- [ ] Embedding storage and retrieval
- [ ] Similarity search with known vectors
- [ ] Edge cases: empty text, very long text

### Phase 3: Integration Tests
- [ ] Pattern match → embedding → semantic search
- [ ] LLM fallback → embedding → semantic search
- [ ] Similar failure detection
- [ ] End-to-end workflow

### Phase 4: Clustering Tests
- [ ] Cluster creation with 3+ similar failures
- [ ] Cluster assignment for new failures
- [ ] Centroid calculation
- [ ] Cluster summary generation

### Phase 5: Performance Tests
- [ ] Embedding generation latency
- [ ] Vector search performance (1k, 10k, 100k vectors)
- [ ] Clustering algorithm runtime

---

## 📊 Success Metrics

- ✅ **Semantic search accuracy**: >85% of similar failures correctly matched
- ✅ **Cluster quality**: >80% of cluster members truly related
- ✅ **Performance**: Semantic search completes in <500ms
- ✅ **Coverage**: >90% of failures assigned to clusters
- ✅ **Cost**: Embedding generation <$0.01 per failure analysis

---

## 🚧 Known Challenges & Mitigations

| Challenge | Mitigation |
|-----------|-----------|
| OpenAI API rate limits | Implement exponential backoff, queue embeddings |
| Large embedding storage | Use pgvector compression, prune old embeddings |
| Clustering accuracy | Tune threshold, use DBSCAN with noise detection |
| Cold start (no embeddings yet) | Pre-generate embeddings for patterns, use pattern-only mode |
| Cost control | Set daily/monthly embedding budget, use caching |

---

## 📅 Estimated Timeline

| Phase | Duration | Priority |
|-------|----------|----------|
| Phase 1: Database Schema | 2-3 hours | 🔴 Critical |
| Phase 2: Embedding Service | 4-5 hours | 🔴 Critical |
| Phase 3: Update Root Cause Service | 3-4 hours | 🔴 Critical |
| Phase 4: Clustering | 5-6 hours | 🟡 Important |
| Phase 5: Configuration | 2-3 hours | 🟡 Important |
| Phase 6: Reporting | 3-4 hours | 🟢 Nice-to-have |

**Total estimated effort:** 19-25 hours

---

## 🎯 End Goal: GitHub Issue Creation

Once clustering is complete, implement:

```javascript
// services/issueCreationService.js
async function suggestGitHubIssues(clusterThreshold = 5) {
    const clusters = await clusteringService.getClusters({ minMembers: clusterThreshold });
    
    const suggestions = clusters.map(cluster => ({
        title: generateIssueTitle(cluster),
        body: generateIssueBody(cluster),
        labels: ['ci-flakiness', 'automated'],
        assignees: [],
        cluster_id: cluster.id
    }));
    
    // Option 1: Print suggestions
    console.log('\n📝 Suggested GitHub Issues:');
    suggestions.forEach(s => console.log(`\n${s.title}\n${s.body}\n`));
    
    // Option 2: Auto-create via GitHub API (future)
    // await octokit.rest.issues.create({ owner, repo, ...suggestion });
}
```

---

## ✅ Acceptance Criteria

- [ ] Embeddings generated for all new root causes
- [ ] Semantic search finds similar failures with >85% accuracy
- [ ] Clusters created automatically with configurable thresholds
- [ ] Cluster report shows actionable GitHub issue suggestions
- [ ] Documentation updated with semantic search usage
- [ ] Tests cover all major paths
- [ ] Performance meets targets (<500ms semantic search)
- [ ] Cost stays within budget (<$0.01 per analysis)

---

**Document Version:** 1.0  
**Status:** 📋 Ready for Implementation  
**Next Action:** Start Phase 1 (Database Schema Extensions)