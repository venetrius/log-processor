# Prompt-Based Semantic Search - Design Document

**Date:** October 18, 2025  
**Status:** 📋 Planning Phase  
**Approach:** Start naive, iterate to sophisticated

---

## 🎯 Overview

This document outlines the plan to implement **prompt-based semantic search** as an intelligent layer between pattern matching and LLM analysis.

### **Core Insight**

Instead of doing semantic search on error messages (symptoms), we do semantic search on **LLM prompts** (full context: errors + steps + logs + metadata). This solves the "same symptom, different cause" problem.

---

## 📐 Technical Constraints & Limits

### **1. Embedding Model Constraints**

**Model:** `Xenova/all-MiniLM-L6-v2` (local, 384 dimensions)

**Maximum Input Length:**
- **Token limit:** ~512 tokens (~2000-2500 characters)
- **Practical limit:** ~1500 characters for safety
- **What happens if exceeded:** Text gets truncated, losing important context

**Calculation:**
```javascript
// Average: 1 token ≈ 4 characters
// 512 tokens × 4 = ~2048 characters MAX
// Safe zone: 1500 characters
```

**Example Prompt Sizes:**
```
Error annotations (3 errors):     ~300 chars
Failed steps (5 steps):           ~200 chars  
Job/workflow metadata:            ~100 chars
Log excerpt (50 lines):           ~3000 chars ❌ TOO LONG!
────────────────────────────────────────────
Total without logs:               ~600 chars  ✅ SAFE
Total with logs:                  ~3600 chars ❌ EXCEEDS LIMIT
```

**Impact on Design:**
- ✅ Error annotations + steps + metadata = fits easily
- ❌ Full 50-line log excerpts = exceeds token limit
- **Solution:** Truncate/summarize log excerpts intelligently

---

### **2. Weighted Context - Can We Prioritize?**

**Question:** Can we tell the embedding model "error messages are more important than log lines"?

**Answer:** ⚠️ **Not directly** - Sentence transformers treat all text equally.

**Workarounds:**

#### **Option A: Text Repetition (Naive)**
```javascript
// Repeat important parts to increase their weight
const promptText = [
  errorAnnotations.join(' | '),      // Once
  errorAnnotations.join(' | '),      // Twice = more weight
  failedSteps.join(' → '),
  logExcerpt.slice(0, 500)           // Truncated logs
].join(' ### ');
```
**Pros:** Simple  
**Cons:** Hacky, wastes tokens on repetition

#### **Option B: Manual Weighting in Query (Better)**
```javascript
// Build structured context with clear delimiters
const promptText = [
  `ERROR: ${errorAnnotations.join(' | ')}`,        // Semantic emphasis
  `STEPS: ${failedSteps.join(' → ')}`,
  `CONTEXT: ${jobName} in ${workflowName}`,
  `LOGS: ${logExcerpt.slice(0, 300)}`              // Truncated
].join('\n\n');

// The embedding model will naturally weight:
// - "ERROR:" prefix adds semantic importance
// - Position matters (earlier = more important)
// - Clear structure helps model understand relationships
```
**Pros:** Semantically meaningful, works with model's natural behavior  
**Cons:** Still treats all text somewhat equally

#### **Option C: Hybrid Embeddings (Sophisticated)**
```javascript
// Generate separate embeddings for different parts
const errorEmbedding = await generateEmbedding(errorAnnotations);
const contextEmbedding = await generateEmbedding(steps + logs);

// Weighted combination
const combinedEmbedding = errorEmbedding.map((val, i) => 
  val * 0.7 + contextEmbedding[i] * 0.3
);
```
**Pros:** True weighting control  
**Cons:** More complex, 2x API calls, need to test if it actually helps

**Recommendation:** Start with **Option B** (structured context), iterate to **Option C** if needed.

---

## 🏗️ Architecture: Naive → Sophisticated Evolution

### **Phase 1: Naive Implementation (Week 1)**

**Goal:** Get it working, prove the concept

```javascript
// Simple flow
1. Build prompt text (errors + steps + truncated logs)
2. Generate embedding
3. Save to llm_prompts table
4. Search for similar prompts
5. If similarity > 0.85 → reuse result
6. Else → call LLM
```

**Code complexity:** Low  
**Features:**
- ✅ Basic prompt hashing (detect exact duplicates)
- ✅ Simple embedding generation
- ✅ Similarity search with fixed threshold
- ❌ No weighted context
- ❌ No smart truncation
- ❌ No confidence scoring

**Trade-offs:**
- **Pros:** Fast to implement, easy to test, proves ROI
- **Cons:** May have false positives, not optimal accuracy

---

### **Phase 2: Smart Truncation (Week 2)**

**Goal:** Handle long contexts intelligently

```javascript
// Smart log truncation
function truncateLogs(logLines, maxChars = 500) {
  // Strategy 1: Get last N lines (most recent errors)
  const lastLines = logLines.slice(-10).join('\n');
  
  if (lastLines.length <= maxChars) return lastLines;
  
  // Strategy 2: Find error-adjacent lines
  const errorLineIndices = findLinesWithKeywords(logLines, ['error', 'fail', 'exception']);
  const relevantLines = extractContext(logLines, errorLineIndices, 5); // 5 lines around errors
  
  return relevantLines.join('\n').slice(0, maxChars);
}
```

**Code complexity:** Medium  
**Features:**
- ✅ Smart log excerpt extraction
- ✅ Keyword-based relevance filtering
- ✅ Context window around errors
- ✅ Token budget management

---

### **Phase 3: Confidence Scoring (Week 3)**

**Goal:** Decide when to trust semantic match vs. escalate to LLM

```javascript
// Multi-factor confidence scoring
function calculateConfidence(semanticMatch) {
  const similarity = semanticMatch.similarity;              // 0.82
  const occurrenceWeight = Math.min(reusedCount / 10, 1);  // 0.50 (reused 5 times)
  const freshnessWeight = isRecent(lastReusedAt) ? 1 : 0.7; // 1.0 (recent)
  const modelWeight = llmModel === 'gpt-4' ? 1 : 0.8;      // 1.0 (good model)
  
  // Weighted average
  return similarity * 0.5 + 
         occurrenceWeight * 0.2 + 
         freshnessWeight * 0.2 + 
         modelWeight * 0.1;
  // = 0.82*0.5 + 0.5*0.2 + 1.0*0.2 + 1.0*0.1 = 0.81
}

// Decision logic
if (confidence > 0.85) {
  return semanticMatch;  // High confidence
} else if (confidence > 0.75) {
  llmPrompt += `\n\nSuggested root cause: ${semanticMatch.title} (confidence: ${confidence})`;
  // Pass hint to LLM for validation
} else {
  // Low confidence, no hint
}
```

**Code complexity:** Medium  
**Features:**
- ✅ Multi-factor confidence scoring
- ✅ Smart escalation logic
- ✅ LLM hint system (hybrid approach)
- ✅ Tracks effectiveness over time

---

### **Phase 4: Hybrid Embeddings (Week 4+) - Optional**

**Goal:** True weighted context control

**Code complexity:** High  
**Features:**
- ✅ Separate embeddings for errors vs. context
- ✅ Configurable weight tuning
- ✅ A/B testing framework
- ✅ Metrics dashboard

**Trade-off:** Only implement if Phase 3 shows clear accuracy gaps.

---

## 🤔 Architecture Concerns: Mixed Responsibilities?

### **Current Design - Is It Too Complex?**

```
rootCauseService.js
├── Pattern matching
├── Semantic search (error annotations)     ← Current
├── LLM prompt building
├── LLM calling
├── Prompt-based semantic search            ← New
├── Result caching
└── Embedding generation
```

**Answer:** ⚠️ **Yes, this is getting complex!**

---

### **Better Architecture: Separation of Concerns**

```
┌─────────────────────────────────────────────────────────┐
│  rootCauseService.js (Orchestrator)                     │
│  - Coordinates detection flow                           │
│  - Makes decisions (which method to use)                │
│  - Tracks statistics                                    │
└─────────────────────────────────────────────────────────┘
            ↓ delegates to ↓
┌──────────────────────┐  ┌──────────────────────┐  ┌──────────────────────┐
│ patternMatcher.js    │  │ semanticMatcher.js   │  │ llmAnalyzer.js       │
│ - Regex matching     │  │ - Prompt building    │  │ - LLM calling        │
│ - Pattern library    │  │ - Embedding gen      │  │ - Response parsing   │
│                      │  │ - Similarity search  │  │ - Error handling     │
└──────────────────────┘  └──────────────────────┘  └──────────────────────┘
                                  ↓                           ↓
                          ┌──────────────────────┐  ┌──────────────────────┐
                          │ llmPromptService.js  │  │ ghCLICache.js        │
                          │ - Store prompts      │  │ - Cache GH API       │
                          │ - Find similar       │  │ - Independent        │
                          │ - Track reuse        │  │                      │
                          └──────────────────────┘  └──────────────────────┘
```

**Proposed Refactoring:**

1. **Extract `semanticMatcher.js`**
   - Prompt building for semantic search
   - Embedding generation
   - Similarity search
   - Confidence scoring

2. **Extract `llmAnalyzer.js`**
   - Prompt building for LLM
   - LLM API calls
   - Response parsing
   - Result validation

3. **Keep `rootCauseService.js` thin**
   - Just orchestration logic
   - Decision making (which detector to use)
   - Result aggregation

---

## 📋 Implementation Strategy

### **Recommendation: Incremental Build-Up**

**Week 1: Naive Implementation**
```bash
# Get it working
- ✅ llmPromptService.js (basic save/search)
- ✅ Update rootCauseService.js (add prompt-based search)
- ✅ Add llm_prompts table to schema
- ✅ Test with real workflow data
```

**Week 2: Validation & Metrics**
```bash
# Prove it's helping
- ✅ Track hit rate (how often semantic matches work)
- ✅ Measure cost savings (LLM calls avoided)
- ✅ Identify false positives
```

**Week 3: Smart Truncation & Confidence**
```bash
# Improve accuracy
- ✅ Implement smart log truncation
- ✅ Add confidence scoring
- ✅ Add LLM hint system
```

**Week 4: Refactor Architecture**
```bash
# Clean up code
- ✅ Extract semanticMatcher.js
- ✅ Extract llmAnalyzer.js
- ✅ Update tests
- ✅ Documentation
```

**Why This Order?**
1. ✅ **Prove value first** - Get naive version working, measure impact
2. ✅ **Iterate based on data** - See where false positives happen
3. ✅ **Refactor when complexity hurts** - Don't over-engineer early
4. ✅ **Ship incrementally** - Each week delivers value

---

## 🎯 Success Metrics

### **Phase 1 Success Criteria**
- ✅ Prompt-based semantic search detects 20%+ of failures
- ✅ False positive rate < 10%
- ✅ Cost savings > 30% on LLM API calls
- ✅ No performance degradation

### **Phase 2 Success Criteria**
- ✅ False positive rate < 5%
- ✅ Cost savings > 50% on LLM API calls
- ✅ Average analysis time < 500ms

### **Phase 3 Success Criteria**
- ✅ Confidence scoring accurately predicts true positives (>90% accuracy)
- ✅ LLM hint system improves LLM accuracy by 15%

---

## ⚠️ Key Trade-offs

### **1. Prompt Length vs. Context Completeness**

| Option | Pros | Cons |
|--------|------|------|
| **Short prompts** (< 500 chars) | Fast embedding, no truncation issues | May miss important context |
| **Long prompts** (1500+ chars) | Full context, better matches | Risk of truncation, slower |

**Decision:** Start with **medium prompts** (800-1200 chars) - include errors + steps + key log lines

---

### **2. Exact Matching (Hash) vs. Semantic Matching**

| Method | Pros | Cons |
|--------|------|------|
| **Hash matching** | Instant, 100% accurate | Only finds identical prompts (rare) |
| **Semantic matching** | Finds similar contexts | May have false positives, slower |

**Decision:** Use **both** - hash first (instant cache), then semantic (intelligent reuse)

---

### **3. Naive Now vs. Perfect Later**

| Approach | Pros | Cons |
|----------|------|------|
| **Naive first** | Ship fast, learn from real data | May need refactoring |
| **Architect first** | Clean code from start | Risk of over-engineering unused features |

**Decision:** **Naive first**, refactor in Week 4 when we understand real-world patterns

---

## 🔄 Migration Path: Backward Compatibility

### **For Existing Deployments**

```sql
-- Add llm_prompts table without breaking existing schema
CREATE TABLE IF NOT EXISTS llm_prompts (...);

-- Existing root_causes table continues to work
-- New prompt-based search is opt-in via config flag
```

**Config:**
```json
{
  "enableSemanticSearch": true,        // Legacy: error-based search
  "enablePromptSemanticSearch": true   // New: prompt-based search
}
```

**Graceful degradation:**
- If `llm_prompts` table doesn't exist → skip prompt-based search
- If embedding generation fails → continue to LLM
- No breaking changes to existing code

---

## 📊 Expected Impact

### **Before Prompt-Based Semantic Search:**
```
100 job failures:
- 40 matched by pattern (40%)
- 60 analyzed by LLM ($0.60, 180s)
- Total: $0.60, ~180s
```

### **After Prompt-Based Semantic Search (Naive):**
```
100 job failures:
- 40 matched by pattern (40%)
- 20 matched by prompt semantic search (20%, free, 2s)
- 40 analyzed by LLM ($0.40, 120s)
- Total: $0.40, ~122s
- Savings: 33% cost, 32% time
```

### **After Optimization (Phase 3):**
```
100 job failures:
- 40 matched by pattern (40%)
- 35 matched by prompt semantic search (35%, free, 3.5s)
- 25 analyzed by LLM ($0.25, 75s)
- Total: $0.25, ~78s
- Savings: 58% cost, 57% time
```

---

## 🚀 Getting Started

### **Step 1: Review This Document**
- ✅ Agree on naive → sophisticated approach
- ✅ Confirm technical constraints
- ✅ Approve architecture refactoring timeline

### **Step 2: Implement Naive Version**
- ✅ Create `llmPromptService.js`
- ✅ Add `llm_prompts` table to schema
- ✅ Update `rootCauseService.js` with prompt-based search
- ✅ Test with 10-20 real failures

### **Step 3: Measure & Iterate**
- ✅ Track metrics for 1 week
- ✅ Identify false positives
- ✅ Tune similarity threshold
- ✅ Decide on Phase 2 priorities

---

## 🤔 Open Questions

1. **Similarity threshold:** Start with 0.85 or 0.80?
   - **Recommendation:** 0.85 (high confidence), tune down if too few matches

2. **Log excerpt size:** 300 chars or 500 chars?
   - **Recommendation:** 500 chars (gives more context without exceeding limits)

3. **Weighted embeddings:** Implement in Phase 1 or Phase 4?
   - **Recommendation:** Phase 4 (only if naive approach shows accuracy gaps)

4. **Caching strategy:** Should prompt embeddings be cached separately?
   - **Recommendation:** Yes - cache in `gh_cli_cache` if same prompt seen multiple times

---

## ✅ Decision Summary

1. ✅ **Start naive** - Simple implementation first, measure impact
2. ✅ **Iterate based on data** - Optimize where real problems appear
3. ✅ **Refactor in Week 4** - Extract services when complexity hurts
4. ✅ **Structured context** (Option B) - Semantic weighting without complexity
5. ✅ **Backward compatible** - No breaking changes to existing code
6. ✅ **Incremental value** - Each phase ships improvements

---

**Ready to proceed with Phase 1 implementation?** 🚀

