# Phase 3.1 Integration Guide

## ✅ Completed Steps

1. ✅ Installed pgvector extension in PostgreSQL
2. ✅ Created migration script (`migratePhase3.js`)
3. ✅ Created `root_causes` and `job_root_causes` tables
4. ✅ Created pattern matcher module (`patternMatcher.js`) with 10 common failure patterns
5. ✅ Created seed script (`seedRootCauses.js`) and seeded database with patterns
6. ✅ Created root cause analyzer module (`rootCauseAnalyzer.js`)

## 📝 Manual Integration Steps Required

### Step 1: Update index.js imports

At the top of `index.js`, add the root cause analyzer import:

```javascript
const rootCauseAnalyzer = require('./rootCauseAnalyzer.js')
```

### Step 2: Add root cause analysis to parseJobs function

In the `parseJobs` function, after storing error annotations, add this code:

```javascript
// Store error annotations
for (const annotation of errorAnnotations) {
    await repository.insertErrorAnnotation({
        job_id: job.id,
        annotation_level: annotation.annotation_level,
        message: annotation.message,
        path: annotation.path,
        start_line: annotation.start_line,
        end_line: annotation.end_line,
        title: annotation.title,
        raw_details: annotation
    });
}

// Phase 3.1: Analyze root cause
await rootCauseAnalyzer.analyzeJob(job.id, errorAnnotations, failedSteps);
```

### Step 3: Add check for existing runs (Optional but Recommended)

In the `loadLogs` function, before processing jobs, add a check:

```javascript
const loadLogs = async (url, runData = null) => {
    const match = url.match(/\/actions\/runs\/(\d+)/);
    const runId = match ? match[1] : null;  
    
    // Check if run already processed
    const exists = await rootCauseAnalyzer.workflowRunExists(runId);
    if (exists) {
        console.log(`⏭️  Run ${runId} already processed, skipping...`);
        return;
    }
    
    console.log(`\n🔍 Processing run ID: ${runId}`)
    // ... rest of the function
}
```

### Step 4: Add root cause statistics to output

At the end of `processAll()`, after displaying database statistics, add:

```javascript
// Display root cause statistics
try {
    console.log(`\n🎯 Root Cause Analysis:`);
    const rcStats = await rootCauseAnalyzer.getRootCauseStats(config.repository);
    console.log(`   Jobs analyzed: ${rcStats.jobs_with_root_cause}`);
    console.log(`   Pattern matched: ${rcStats.pattern_matched}`);
    console.log(`   Avg confidence: ${parseFloat(rcStats.avg_confidence || 0).toFixed(2)}`);
} catch (error) {
    console.error('   ⚠️  Could not fetch root cause stats:', error.message);
}
```

## 🧪 Testing

Run the script to test Phase 3.1:

```bash
node index.js
```

Expected output should include:
- Root cause detection messages for failed jobs
- Confidence scores for detected patterns
- Root cause statistics at the end

## 📊 Verify in Database

Connect to PostgreSQL and run:

```sql
-- See detected root causes
SELECT rc.title, rc.category, rc.occurrence_count 
FROM root_causes rc 
ORDER BY occurrence_count DESC;

-- See job-to-root-cause links
SELECT j.job_name, rc.title, jrc.confidence, jrc.detection_method
FROM job_root_causes jrc
JOIN jobs j ON jrc.job_id = j.job_id
JOIN root_causes rc ON jrc.root_cause_id = rc.id
ORDER BY jrc.created_at DESC
LIMIT 10;
```

## 🎉 Phase 3.1 Complete!

Once integrated, Phase 3.1 provides:
- ✅ Pattern-based root cause detection
- ✅ Automatic categorization of failures
- ✅ Confidence scoring
- ✅ Suggested fixes for common issues
- ✅ Skip already-processed runs option
- ✅ Statistics tracking

## Next Steps: Phase 3.2

When ready, Phase 3.2 will add:
- Semantic similarity search using embeddings
- Vector search for similar past failures
- More sophisticated matching beyond simple patterns

