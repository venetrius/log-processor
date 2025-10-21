# Prompt-Based Semantic Search - Design Decisions

**Date:** October 18, 2025  
**Status:** ✅ **IMPLEMENTED**

---

## Key Design Decision

**Search on prompts, not error messages.**

### Why?

Same error message can have different root causes depending on context. By searching on the full prompt (errors + steps + logs + metadata), we capture the complete failure context.

**Example:**
- Error: "Process completed with exit code 1"
- Context A: Node.js dependency conflict → Different root cause
- Context B: Database connection timeout → Different root cause
- Traditional approach: Both look the same (just the error)
- Our approach: Different embeddings capture different contexts

---

## Technical Constraints

### Embedding Model: `Xenova/all-MiniLM-L6-v2`

**Limits:**
- Token limit: ~512 tokens (~2000 characters)
- Practical safe limit: ~1500 characters

**Prompt Size Strategy:**
```
✅ Error annotations (3 errors):     ~300 chars
✅ Failed steps (5 steps):           ~200 chars  
✅ Job/workflow metadata:            ~100 chars
⚠️  Log excerpt (50 lines):          ~3000 chars (TOO LONG!)
────────────────────────────────────────────────
Solution: Truncate logs to last 10 lines or 500 chars
```

**Implementation:** See `truncateLogExcerpt()` in `services/llmPromptService.js`

---

## Search Workflow

```
1. Build prompt context (errors + steps + truncated logs)
2. Generate SHA-256 hash
3. Check for exact hash match → INSTANT HIT
4. If no exact match, generate embedding (50-100ms)
5. Cosine similarity search in pgvector
6. If similarity ≥ threshold AND confidence criteria met → REUSE
7. Otherwise → LLM call
```

---

## Confidence Criteria

Auto-reuse if ANY of:
- `similarity ≥ 0.90` (very high semantic match)
- `reused_count ≥ 3` (proven reliable)
- `discovery_method = 'pattern'` (pattern-based are reliable)

Otherwise: Use as hint for LLM validation

---

## Benefits Achieved

✅ **Speed:** 50-100ms vs 2-5s (40-50x faster)  
✅ **Cost:** $0 vs $$ (local embeddings)  
✅ **Accuracy:** Context-aware matching  
✅ **Learning:** System improves over time as prompt library grows

---

## See Also

- `docs/SemanticSearch_v2.md` - Implementation status
- `src/services/llmPromptService.js` - Implementation
