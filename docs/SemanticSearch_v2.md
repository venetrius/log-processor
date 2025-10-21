# Semantic Search Implementation

**Last Updated:** October 21, 2025  
**Status:** ✅ **COMPLETE** - Prompt-based semantic search implemented

---

## ✅ What's Implemented

### Prompt-Based Semantic Search
Instead of searching on error messages (symptoms), the system searches on **LLM prompts** (full context).

**Key Features:**
- Local embedding generation using `Xenova/all-MiniLM-L6-v2` (384 dimensions)
- SHA-256 hash for exact deduplication (instant cache hits)
- Cosine similarity search using pgvector
- 50-100ms average search time (vs 2-5s for LLM calls)
- Zero API costs (local model)

**Files:**
- `services/llmPromptService.js` - Prompt caching and semantic search
- `llm/adapters/localEmbedAdapter.js` - Local embedding generation
- Database table: `llm_prompts` with 384-dim embeddings

---

## How It Works

1. **Prompt Construction** - Build failure context from annotations + steps + logs
2. **Hash Check** - Check for exact match via SHA-256 hash (instant)
3. **Embedding Generation** - Generate 384-dim vector if new (50-100ms)
4. **Similarity Search** - Find similar historical prompts using cosine similarity
5. **Confidence Decision** - Reuse if similarity ≥ 0.85 or validated by usage history

**Search Tiers:**
- Similarity ≥ 0.90 → Auto-reuse (high confidence)
- Reused ≥ 3 times → Auto-reuse (proven reliable)
- Pattern-based root cause → Auto-reuse (reliable source)
- Otherwise → Use as hint for LLM validation

---

## Schema

**Table: `llm_prompts`**
```sql
- prompt_hash (SHA-256 for deduplication)
- prompt_embedding (vector(384) for similarity search)
- prompt_text (failure context for embedding)
- root_cause_id (linked result)
- confidence (0-1 score)
- reused_count (usage tracking)
```

**Indexes:**
- Hash index for exact lookups (instant)
- Vector index for semantic search (pgvector ivfflat)

---

## Performance

| Operation | Time | Cost |
|-----------|------|------|
| Exact hash match | <1ms | Free |
| Embedding generation | 50-100ms | Free |
| Similarity search | 5-10ms | Free |
| **vs LLM call** | 2-5s | $$ |

---

## Future Enhancements

### Not Yet Implemented
- [ ] Batch clustering (nightly cron job to group similar failures)
- [ ] Failure pattern trending and reporting
- [ ] Auto-generation of GitHub issues for clusters
- [ ] Upgrade to larger embedding models if needed

### Nice-to-Have
- [ ] Multi-turn iterative log expansion for `need_more_info` responses
- [ ] Token/cost metrics dashboard
- [ ] A/B testing different similarity thresholds

---

## See Also

- `docs/ARCHITECTURE.md` - Full system architecture
- `docs/PromptSemanticSearch_Plan.md` - Original design decisions
- `src/services/llmPromptService.js` - Implementation
