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

## Roadmap & Planned Improvements

### Phase 1: Resource Optimization & Configuration ✅ COMPLETE
**Status:** ✅ Complete | **Effort:** ~1 hour

- [x] **Skip existing log downloads** - Check if log file exists before downloading to save bandwidth and time
- [x] **Configuration file** - Add `config.json` for settings:
  - Enable/disable log downloads completely
  - Force re-download even if file exists
  - Configure default repository
  - Set number of recent runs to fetch
- [x] **Job definitions from config** - Support running against periodic workflows without manual run IDs:
  - Define workflow names/IDs in config
  - Automatically fetch last X runs for configured workflows
  - Example: Monitor nightly builds without copying URLs each time
- [x] **Clean up dependencies** - Removed unused packages
- [x] **Extract download function** - Refactored for better readability with early returns

**Benefits:** ✅ Immediate usability improvements, faster iteration, less manual work

### Phase 2: Data Persistence (Foundation) ✅ COMPLETE
**Status:** ✅ Complete | **Effort:** ~3 hours

- [x] **PSQL database integration** - Store failure data locally:
  - Track failed jobs over time
  - Store error annotations and messages
  - Record job metadata (run ID, job ID, timestamp, conclusion)
- [x] **Query interface** - Basic querying for historical data:
  - Find all failures for a specific job name
  - Track failure trends over time
  - Identify recurring issues
- [x] **Export functionality** - Generate reports from stored data

**Benefits:** Historical tracking, trend analysis, better debugging context

### Phase 3: Intelligent Analysis (Advanced)
**Status:** Planned | **Effort:** Ongoing

- [ ] **LLM integration for log parsing** - Use AI to analyze failures:
  - Extract root causes from log files
  - Identify patterns across similar failures
  - Suggest fixes based on historical data
- [ ] **Pattern-based root cause detection** - Regex patterns for common failures
- [ ] **Semantic search** - Find similar past failures using embeddings (pgvector)

#### Phase 3 - Nice to Have Features 🌟
- [ ] **Historical comparison** - LLM can request previous run logs with their root causes for pattern comparison
- [ ] **Dynamic log exploration** - LLM can provide regex patterns that the client executes and returns matching log segments
- [ ] **Interactive analysis** - Multi-turn conversation where LLM requests specific context iteratively:
  - Specific file contents from repository
  - Diff between failing and passing runs
  - Related workflow step outputs
  - List of recent changes/commits

**Benefits:** Faster debugging, pattern recognition, proactive issue detection

## Intelligent Analysis (Current State)
Pattern-based detection + optional LLM fallback (mock / prototype). The earlier `rootCauseAnalyzer.js` facade was removed to avoid circular dependencies; logic resides in `services/rootCauseService.js`.

### Current Capabilities
- Pattern-first matching using regex catalogue
- LLM fallback with discriminated union response (`root_cause` | `need_more_info`)
- Confidence threshold enforcement
- Audit persistence of all LLM outcomes (success, malformed, need_more_info, below_threshold)

### Not Implemented Yet (Planned / Nice-to-Have)
- Semantic similarity (embeddings + pgvector search) prior to LLM invocation
- Token/cost usage persistence in a dedicated table (currently only in-memory per response)
- Structured JSON schema validation beyond discriminator + parse
- Retry / exponential backoff for OpenAI & Copilot adapters (raw HTTPS only right now)
- Iterative follow-up handling when LLM returns `need_more_info` (log slice expansion)
- Decoupled persistence layer (DB helpers currently inside service)

### Near-Term Roadmap
1. Add semantic search module (embeddings generation + vector indexing).
2. Persist token metrics & add cost reports.
3. Introduce response schema validation (lightweight JSON Schema or manual field checks).
4. Implement adapter-level retry with jitter and clearer error taxonomy.
5. Support iterative log expansion flow for `need_more_info` responses.
6. Extract DB helper functions to dedicated persistence utility to reduce coupling.
7. Add unit tests for `rootCauseService` paths.

## Important features - resolving limitations
- [ ] being able to define list of branches to filter workflow runs based on
- [ ] download is working with a work around - link to download link is printed, improve this
  - [ ] The also contains the jobId -> 1 less click
  - [ ] The link are collected and printed out after the run, they are also saved into the db
- [ ] Persist token/cost metrics (new table) and expose stats
- [ ] Add response schema validation for LLM outputs
- [ ] Add retry/backoff for LLM adapters
- [ ] Implement iterative `need_more_info` follow-up flow
- [ ] Extract persistence layer from `rootCauseService`

### Future Improvements (Nice-to-Have)
- [ ] **Create detailed HTML reports** - Summarize failures with root causes and links to logs
- [ ] **YAML configuration** - Move from JSON to YAML to support comments in config files
- [ ] **Pagination support** - Handle repositories with many workflow runs efficiently
- [ ] **Filtering options** - Filter jobs by name, status, or time range when querying
- [ ] Accept run URL/ID and repo as CLI arguments
- [ ] Parallelize log downloads for multiple failed jobs
- [ ] Add filtering options (include successful jobs, specific job names)
- [ ] Add unit tests and CI pipeline
- [ ] Support for downloading and analyzing workflow artifacts
- [ ] Summary statistics (total logs downloaded, total failures, etc.)
- [ ] Progress indicators for processing multiple runs
- [ ] **Configuration Loading**: `loadConfig()` is called multiple times throughout the codebase. Should be refactored to load once at startup and pass config as parameter
- [ ] Error handling could be more robust for network failures and API rate limits

---

**Quick reference:** Edit URL → `node index.js` → Review output → Check `./files/*.log`
