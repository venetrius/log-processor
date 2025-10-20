#!/usr/bin/env node

/*
 * Copyright Camunda Services GmbH and/or licensed to Camunda Services GmbH
 * under one or more contributor license agreements. See the NOTICE file
 * distributed with this work for additional information regarding copyright
 * ownership. Camunda licenses this file to you under the Apache License,
 * Version 2.0; you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * CLI script for generating reports
 *
 * Usage:
 *   node generateReport.js
 *   node generateReport.js --days=30
 *   node generateReport.js --workflow=optimize-ci.yml --branch=maintenance/3.15
 *   node generateReport.js --start=2025-01-01 --end=2025-01-20
 */

require('dotenv').config();
const reportGenerator = require('./src/services/reporting/reportGenerator');
const db = require('./src/db/db');

/**
 * Parse command line arguments
 */
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    workflows: [],
    branches: [],
  };

  args.forEach(arg => {
    if (arg.startsWith('--')) {
      const [key, value] = arg.substring(2).split('=');

      switch (key) {
        case 'days':
          const days = parseInt(value);
          const endDate = new Date();
          const startDate = new Date();
          startDate.setDate(startDate.getDate() - days);
          options.startDate = startDate.toISOString().split('T')[0];
          options.endDate = endDate.toISOString().split('T')[0];
          break;

        case 'start':
        case 'startDate':
          options.startDate = value;
          break;

        case 'end':
        case 'endDate':
          options.endDate = value;
          break;

        case 'workflow':
          options.workflows.push(value);
          break;

        case 'branch':
          options.branches.push(value);
          break;

        case 'repository':
        case 'repo':
          options.repository = value;
          break;

        case 'output':
        case 'outputPath':
          options.outputPath = value;
          break;

        case 'filename':
          options.filename = value;
          break;

        case 'includeSuccess':
        case 'includeSuccessful':
          options.includeSuccessfulRuns = value === 'true';
          break;

        case 'help':
        case 'h':
          showHelp();
          process.exit(0);
          break;

        default:
          console.warn(`⚠️  Unknown option: --${key}`);
      }
    }
  });

  return options;
}

/**
 * Show help message
 */
function showHelp() {
  console.log(`
📊 Workflow Report Generator

Usage:
  node generateReport.js [options]

Options:
  --days=<number>              Generate report for last N days
  --start=<YYYY-MM-DD>         Start date for report
  --end=<YYYY-MM-DD>           End date for report
  --workflow=<name>            Filter by workflow file name
  --branch=<name>              Filter by branch name
  --repository=<owner/repo>    Filter by repository
  --output=<path>              Output directory (default: ./reports)
  --filename=<name>            Output filename (auto-generated if not provided)
  --includeSuccess=<true|false> Include successful runs (default: false)
  --help, -h                   Show this help message

Examples:
  # Generate report for last 30 days
  node generateReport.js --days=30

  # Generate report for specific workflow and branch
  node generateReport.js --workflow=optimize-ci.yml --branch=maintenance/3.15

  # Generate report for date range
  node generateReport.js --start=2025-01-01 --end=2025-01-20

  # Generate report with custom output
  node generateReport.js --days=7 --output=./my-reports --filename=weekly-report.html
  `);
}

/**
 * Main execution
 */
async function main() {
  console.log('📊 Workflow Report Generator\n');

  // Check if help was requested
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    showHelp();
    return;
  }

  try {
    // Test database connection
    console.log('🔌 Testing database connection...');
    const connected = await db.testConnection();
    if (!connected) {
      console.error('❌ Failed to connect to database. Please check your configuration.');
      process.exit(1);
    }

    // Parse arguments
    const options = parseArgs();

    // Show configuration
    console.log('⚙️  Configuration:');
    if (options.startDate) console.log(`   Start Date: ${options.startDate}`);
    if (options.endDate) console.log(`   End Date: ${options.endDate}`);
    if (options.workflows.length > 0) console.log(`   Workflows: ${options.workflows.join(', ')}`);
    if (options.branches.length > 0) console.log(`   Branches: ${options.branches.join(', ')}`);
    if (options.repository) console.log(`   Repository: ${options.repository}`);
    console.log(`   Output Path: ${options.outputPath || './reports'}`);
    console.log('');

    // Generate report
    const result = await reportGenerator.generate(options);

    // Show summary
    console.log('\n📈 Report Summary:');
    console.log(`   Total Runs: ${result.stats.totalRuns}`);
    console.log(`   Failed Runs: ${result.stats.failedRuns}`);
    console.log(`   Successful Runs: ${result.stats.successfulRuns}`);
    console.log(`   Top Root Causes: ${result.stats.topRootCauses}`);
    console.log(`   Workflows Analyzed: ${result.stats.workflowsAnalyzed}`);
    console.log('');
    console.log(`✨ Report saved to: ${result.filePath}`);
    console.log('');

  } catch (error) {
    console.error('❌ Error generating report:', error.message);
    if (process.env.DEBUG) {
      console.error(error);
    }
    process.exit(1);
  } finally {
    // Close database connection
    await db.end();
  }
}

// Run if executed directly
if (require.main === module) {
  main();
}

module.exports = { main, parseArgs };

