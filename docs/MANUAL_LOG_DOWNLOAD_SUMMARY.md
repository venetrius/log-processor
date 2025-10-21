# Manual Log Download Summary - QoL Feature

## What This Does
At the end of each run, displays a summary of all jobs that need logs downloaded manually.
Groups them by workflow run with direct download links.

---

## Files Created
✅ `src/services/manualLogDownload/downloadSummary.js` - New helper module

---

## Manual Changes Needed to `src/index.js`

### Change 1: Add Import (line ~33, after fetchJobLogs import)

**Add this line:**
```javascript
const { displayManualLogDownloadSummary } = require('./services/manualLogDownload/downloadSummary')
```

**Full context:**
```javascript
const { fetchJobLogs } = require('./services/manualLogDownload/index')
const { displayManualLogDownloadSummary } = require('./services/manualLogDownload/downloadSummary')  // ← ADD THIS

const getErrorAnnotations = async jobId => {
```

---

### Change 2: Add Summary Call (at end of processAll, around line 476)

**Add this code block BEFORE the final closing brace of the `if (dbConnected)` block:**

```javascript
        // Display jobs that need manual log downloads
        try {
            await displayManualLogDownloadSummary(config.repository);
        } catch (error) {
            console.error('   ⚠️  Could not display download summary:', error.message);
        }
    }
}
```

**Full context (end of processAll function):**
```javascript
            console.log(`   Avg confidence: ${parseFloat(rcStats.avg_confidence || 0).toFixed(2)}`);
        } catch (error) {
            console.error('   ⚠️  Could not fetch statistics:', error.message);
        }

        // Display jobs that need manual log downloads         // ← ADD THIS BLOCK
        try {                                                  // ← ADD THIS BLOCK
            await displayManualLogDownloadSummary(config.repository);  // ← ADD THIS BLOCK
        } catch (error) {                                      // ← ADD THIS BLOCK
            console.error('   ⚠️  Could not display download summary:', error.message);  // ← ADD THIS BLOCK
        }                                                      // ← ADD THIS BLOCK
    }
}

// Allow this to be run directly
if (require.main === module) {
```

---

## What You'll See After Running

When jobs need logs, you'll see this at the end:

```
================================================================================
📥 MANUAL LOG DOWNLOADS NEEDED
================================================================================

2 workflow run(s) have jobs that need log files for deeper analysis.
These jobs either have no root cause or low confidence matches.


📦 Workflow: CI Tests (Run #1234)
   Run URL: https://github.com/owner/repo/actions/runs/12345
   Jobs needing logs (3):
     • Integration Tests OpenSearch (confidence: 45.0%)
     • Unit Tests Backend (no root cause)
     • Data Upgrade Test (confidence: 62.3%)

📦 Workflow: E2E Tests (Run #5678)
   Run URL: https://github.com/owner/repo/actions/runs/56789
   Jobs needing logs (1):
     • Browser Tests Chrome (no root cause)

================================================================================
📋 Total: 4 job(s) from 2 run(s) need logs

🔧 How to download:
   1. Click on each Run URL above
   2. Click "Download log archive" in the top-right
   3. Save to ~/Downloads/logs_<suiteId>.zip
   4. Re-run this script to process the logs
================================================================================
```

---

## Benefits

✅ **No more searching** - All needed downloads listed in one place
✅ **Grouped by run** - Download once per workflow run
✅ **Shows why** - Displays confidence scores or "no root cause"
✅ **Clear instructions** - Tells you exactly what to do
✅ **Only shows when needed** - Silent if all jobs have logs or high confidence

---

## Quick Apply

Copy these two code blocks into `src/index.js` at the locations shown above.

Test with:
```bash
node src/index.js
```

