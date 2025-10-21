# GitHub CLI Cache Implementation

**Status:** ✅ Complete  
**Date:** October 17, 2025

---

## Overview

Caches GitHub CLI (`gh`) command responses in PostgreSQL to:
- **Speed up development** - Instant responses from cache
- **Avoid rate limits** - GitHub API has strict limits (5000 requests/hour)
- **Enable offline work** - Develop without network connectivity
- **Preserve data** - Keep historical workflow data
- **Reproducible testing** - Same cache = same results

---

## How It Works

**Flow:**
1. Check cache for command (SHA-256 hash)
2. If found → return cached response (CACHE HIT 💾)
3. If not found → execute command (CACHE MISS 🔍)
4. Store response in cache for next time

**Files:**
- `src/services/cacheGHCLI.js` - Cache service
- `src/ghCommand.js` - Updated with cache integration
- `src/cacheManager.js` - Cache management CLI

---

## Configuration

Add to `config.json`:
```json
{
  "cacheGHRequests": true
}
```

---

## Cache Management

**Commands:**
```bash
npm run cache:stats      # Show statistics
npm run cache:clear      # Clear all entries
npm run cache:clear-old  # Remove old entries
npm run cache:export     # Export to JSON
```

**Programmatic usage:**
```javascript
const cache = require('./services/cacheGHCLI');
await cache.setCacheEnabled(true);
const stats = await cache.getCacheStats();
```

---

## Database Schema

**Table: `gh_cli_cache`**
- `command_hash` - SHA-256 hash for lookups
- `command` - Original command text
- `response` - Cached response
- `is_json` - Response type flag
- `access_count` - Usage tracking
- `last_accessed_at` - Last access timestamp

**Auto-created** on first use - no manual setup needed.

---

## Benefits

✅ **Development speed** - Instant responses during iteration  
✅ **API conservation** - Avoid hitting rate limits  
✅ **Offline capability** - Work without network  
✅ **Data preservation** - Keep old workflow runs  
✅ **Reproducibility** - Consistent test results

---

## See Also

- `src/services/cacheGHCLI.js` - Implementation
- `src/cacheManager.js` - CLI tool
