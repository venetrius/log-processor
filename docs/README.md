# Documentation Index

**Last Updated:** October 21, 2025

---

## Quick Reference

| Document | Purpose | Status |
|----------|---------|--------|
| [ARCHITECTURE.md](ARCHITECTURE.md) | Complete system architecture and implementation details | ✅ Current |
| [SchemaReview.md](SchemaReview.md) | Database schema overview and commands | ✅ Current |
| [GitHubCLICache.md](GitHubCLICache.md) | GitHub CLI caching for development | ✅ Complete |
| [SemanticSearch_v2.md](SemanticSearch_v2.md) | Semantic search implementation status | ✅ Complete |
| [PromptSemanticSearch_Plan.md](PromptSemanticSearch_Plan.md) | Design decisions for prompt-based search | ✅ Implemented |
| [add_llm_prompts_table.sql](add_llm_prompts_table.sql) | LLM prompt cache table (persistent migration) | ✅ Current |

---

## Getting Started

1. **New to the project?** Start with the main [README.md](../README.md)
2. **Understanding the system?** Read [ARCHITECTURE.md](ARCHITECTURE.md)
3. **Database setup?** See [SchemaReview.md](SchemaReview.md)

---

## Implementation Status

### ✅ Completed Features
- Pattern-based root cause detection
- LLM integration with prompt-based semantic search
- Local embedding generation (Xenova/transformers.js)
- Prompt caching and deduplication
- GitHub CLI response caching
- Lazy loading optimization
- PostgreSQL persistence with pgvector

### 🚧 In Progress / Planned
- Branch filtering for workflow runs
- Token/cost metrics persistence
- Batch clustering for failure patterns
- Enhanced log download experience

