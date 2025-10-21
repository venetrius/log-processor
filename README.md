# log-processor

A Node.js utility to analyze GitHub Actions workflow runs, identify failed jobs and steps, extract failure annotations, and automatically download logs for debugging.

Currently configured for the `camunda/camunda-7-to-8-data-migrator` repository but easily adaptable to any GitHub repository.

## Features

- 🔍 Extracts workflow run ID from GitHub Actions URLs
- ❌ Identifies all failed jobs and their failure reasons
- 📝 Surfaces error annotations with detailed messages
- 📥 Downloads complete job logs for failed jobs
- 🗂️ Organizes logs in a `./files` directory for easy access

## How it works

**Main script (index.js)**
- Extracts the workflow run ID from a GitHub Actions run URL
- Uses GitHub CLI (`gh api`) to fetch all jobs for that run
- For each failed job (not concluded with `success` or `skipped`):
  - Fetches error annotations (filtered by `annotation_level === "failure"`)
  - Prints annotation messages and failed step names to console
  - Downloads the complete job log via `gh run view --job <id> --log`
  - Saves logs as `./files/<jobId>-job.log`

**Supporting modules**
- **ghCommand.js**: Wraps `child_process.exec` with utility functions:
  - `runGhCommand(command, skipParse)` - executes `gh` commands and optionally parses JSON output
  - `runCommandToFile(command, outputPath)` - streams command output directly to a file

## Prerequisites

- **Node.js** (v18 or higher recommended)
- **GitHub CLI** (`gh`) installed and authenticated
  The tool only reads workflow run data and job logs - no write permissions needed.
- **PostgreSQL** (optional)
  - Required for storing failure history and enabling trend analysis 

## Installation

```bash
npm install
```

## Database Setup (Optional)

The tool can persist failure data to PostgreSQL for historical tracking and analysis.

### Quick Start with Docker

```bash
docker run -d \
  --name logDB \
  -p 5432:5432 \
  -e POSTGRES_DB=log-process \
  -e POSTGRES_PASSWORD=demo \
  -e POSTGRES_USER=demo \
  -v logDB_data:/var/lib/postgresql/data \
  postgres:17
```

### Configure Database Connection

1. **Copy the environment template**:
   ```bash
   cp .env.example .env
   ```

2. **Edit `.env`** with your database credentials:
   ```env
   DB_HOST=localhost
   DB_PORT=5432
   DB_NAME=log-process
   DB_USER=demo
   DB_PASSWORD=demo
   ```

### Create Database Schema

```bash
# Create all tables and indexes
node schema.js create

# Test the connection
node test-db.js

# Other schema commands
node schema.js drop    # Drop all tables
node schema.js reset   # Drop and recreate
node migratePhase3.js up # Run Phase 3 migrations
```

### Database Schema

The tool creates 4 tables:

- **`workflow_runs`** - Workflow run metadata (run_id, workflow_name, conclusion, timestamps)
- **`jobs`** - Job details (job_id, job_name, conclusion, log_file_path)
- **`job_steps`** - Individual step failures
- **`error_annotations`** - Error messages and annotations from failed jobs

## Configuration
Create a `config.json` file in the root directory (see `config.example.json` for reference):

### Configuration Options

| Option | Type | Description |
|--------|------|-------------|
| `repository` | string | GitHub repository in `owner/repo` format |
| `downloadLogs` | boolean | Whether to download job logs (default: `true`) |
| `forceDownload` | boolean | Re-download logs even if they exist (default: `false`) |
| `logsDirectory` | string | Directory to store downloaded logs (default: `"./files"`) |
| `workflows` | array | List of workflows to monitor automatically |
| `singleRun.enabled` | boolean | Enable single run mode |
| `singleRun.url` | string | URL of a specific workflow run to analyze |

### Workflow Configuration

Each workflow in the `workflows` array can have:

- **`name`**: Friendly name for the workflow
- **`enabled`**: Whether to process this workflow (default: `false`)
- **`fetchLastRuns`**: Number of recent runs to fetch (default: `5`)
- **`workflowFileName`**: The workflow YAML filename (e.g., `ci.yml`, `nightly.yml`)

## Usage

### Quick Start

1. **Copy the example config**:
   ```bash
   cp config.example.json config.json
   ```

2. **Edit `config.json`** with your repository and preferences

3. **Run the script**:
   ```bash
   node index.js
   ```

### Output

The script will:
- ✅ Display failed jobs with error annotations and failed steps
- 💾 Download logs to the configured directory (if enabled)
- ⏭️  Skip downloading logs that already exist (unless `forceDownload: true`)
- 📊 Show summary of each run's status

Example output:
```
🚀 Log Processor Started
📦 Repository: camunda/camunda-optimize
💾 Download logs: Yes
🔄 Force download: No

━━━ Single Run Mode ━━━
🔍 Processing run ID: 18519851191

❌ FAILED - Migration (opensearch)
   --- Process completed with exit code 1.
   --------- Install failed
   💾 Saved log to ./files/52777300032-job.log

✨ Processing complete!
```

## Adapting to another repository

Simply update the `repository` field in `config.json`:

```json
{
  "repository": "your-org/your-repo"
}
```

No code changes needed!

## Error handling & limits

- GitHub CLI errors are logged to stderr; the script continues processing other jobs
- Max buffer increased to 50 MB for large JSON responses
- No retry/backoff logic implemented
- Large workflow runs with many jobs may still exceed buffer limits

## Potential improvements

- [ ] Accept run URL/ID and repo as CLI arguments
- [ ] Parallelize log downloads for multiple failed jobs
- [ ] Add filtering options (include successful jobs, specific job names)
- [ ] Implement pagination for runs with many jobs
- [ ] Add unit tests and CI pipeline
- [ ] Support for downloading and analyzing workflow artifacts

## Project structure

```
log-processor/
├── index.js           # Main entry point
├── ghCommand.js       # GitHub CLI wrapper utilities
├── package.json       # Dependencies
├── files/            # Downloaded job logs (generated)
└── README.md         # This file
```

## License
Licensed under Apache License Version 2.0

---

## Current Features & Architecture

### ✅ Implemented Intelligence Features

**Three-Tier Detection System:**
1. **Pattern Matching** - Instant regex-based detection for known failures
2. **Prompt Semantic Search** - Find similar historical failures using embeddings (50-100ms, free)
3. **LLM Analysis** - AI-powered fallback for unknown failures (2-5s, costs money)

**Optimizations:**
- **Lazy Loading** - Pattern analysis runs before downloading logs
- **Prompt Caching** - Reuses results from similar past failures
- **GitHub CLI Caching** - Stores API responses locally
- **Local Embeddings** - Uses Xenova/transformers.js (no API costs)

**See `docs/ARCHITECTURE.md` for detailed implementation details.**

---

## Roadmap & Planned Improvements

### ✅ Phase 1: Resource Optimization & Configuration - COMPLETE
- Skip existing log downloads
- Configuration file support
- Job definitions from config
- Clean dependencies

### ✅ Phase 2: Data Persistence - COMPLETE
- PostgreSQL integration
- Historical tracking
- Query interface
- Export functionality

### ✅ Phase 3: Intelligent Analysis - COMPLETE
- Pattern-based root cause detection
- LLM integration with discriminated union responses
- Prompt-based semantic search
- Local embedding generation
- Confidence threshold enforcement

### 🚧 Phase 4: Advanced Features - In Progress
- [ ] Branch filtering for workflow runs
- [ ] Improved log download experience
- [ ] Token/cost metrics persistence and reporting
- [ ] Enhanced response schema validation
- [ ] Retry/backoff for LLM adapters
- [ ] Iterative `need_more_info` follow-up flow
- [ ] Batch embedding generation (nightly cron)
- [ ] Failure clustering for GitHub issue creation

### 🌟 Nice-to-Have Features
- [ ] Historical comparison - LLM requests previous run logs with root causes
- [ ] Dynamic log exploration - LLM provides regex patterns for targeted log segment extraction
- [ ] Interactive analysis - Multi-turn conversation for iterative context gathering
- [ ] Repository file inspection - LLM can request specific files from the repository
- [ ] Diff analysis - Compare failing vs passing runs
