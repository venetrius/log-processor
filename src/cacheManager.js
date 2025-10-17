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

const db = require('./db/db');
const cacheService = require('./services/cacheGHCLI');

async function main() {
  const command = process.argv[2];

  try {
    const connected = await db.testConnection();
    if (!connected) {
      console.error('❌ Database connection failed');
      process.exit(1);
    }

    // Initialize cache schema
    await cacheService.initializeCacheSchema();

    switch (command) {
      case 'stats':
        await showStats();
        break;
      case 'clear':
        await clearCache();
        break;
      case 'clear-old':
        const days = parseInt(process.argv[3]) || 30;
        await clearOldCache(days);
        break;
      case 'export':
        await exportCache();
        break;
      default:
        showHelp();
    }
  } catch (error) {
    console.error('❌ Command failed:', error);
    process.exit(1);
  } finally {
    await db.end();
  }
}

async function showStats() {
  console.log('📊 GitHub CLI Cache Statistics\n');
  console.log('='.repeat(60));

  cacheService.setCacheEnabled(true);
  const stats = await cacheService.getCacheStats();

  if (!stats.enabled) {
    console.log('⚠️  Cache is currently disabled');
    return;
  }

  console.log(`Total entries:           ${stats.total_entries || 0}`);
  console.log(`Total accesses:          ${stats.total_accesses || 0}`);
  console.log(`Avg accesses per entry:  ${stats.avg_accesses_per_entry ? parseFloat(stats.avg_accesses_per_entry).toFixed(2) : '0.00'}`);
  console.log(`Reused entries:          ${stats.reused_entries || 0} (${stats.total_entries > 0 ? ((stats.reused_entries / stats.total_entries) * 100).toFixed(1) : 0}%)`);

  if (stats.last_access) {
    console.log(`Last access:             ${new Date(stats.last_access).toLocaleString()}`);
  }

  if (stats.oldest_entry) {
    console.log(`Oldest entry:            ${new Date(stats.oldest_entry).toLocaleString()}`);
  }

  console.log('='.repeat(60));

  if (stats.total_entries > 0) {
    const hitRate = stats.reused_entries > 0 ? ((stats.reused_entries / stats.total_entries) * 100).toFixed(1) : 0;
    console.log(`\n✨ Cache effectiveness: ${hitRate}% of entries reused`);
    const savedCalls = (stats.total_accesses || 0) - (stats.total_entries || 0);
    if (savedCalls > 0) {
      console.log(`💰 API calls saved: ${savedCalls}`);
    }
  }
}

async function clearCache() {
  console.log('🗑️  Clearing GitHub CLI cache...\n');

  cacheService.setCacheEnabled(true);
  const result = await cacheService.clearCache();

  console.log(`\n✅ Cleared ${result.deleted} cache entries`);
}

async function clearOldCache(days) {
  console.log(`🗑️  Clearing cache entries older than ${days} days...\n`);

  cacheService.setCacheEnabled(true);
  const result = await cacheService.clearOldCache(days);

  console.log(`\n✅ Cleared ${result.deleted} old cache entries`);
}

async function exportCache() {
  console.log('📤 Exporting cache to JSON...\n');

  cacheService.setCacheEnabled(true);
  const entries = await cacheService.exportCache();

  const outputFile = 'gh-cli-cache-export.json';
  const fs = require('fs');
  fs.writeFileSync(outputFile, JSON.stringify(entries, null, 2));

  console.log(`✅ Exported ${entries.length} cache entries to ${outputFile}`);
}

function showHelp() {
  console.log('Usage: node src/cacheManager.js [command] [options]\n');
  console.log('Commands:');
  console.log('  stats              Show cache statistics');
  console.log('  clear              Clear all cache entries');
  console.log('  clear-old [days]   Clear cache entries older than N days (default: 30)');
  console.log('  export             Export cache to JSON file');
  console.log('\nExamples:');
  console.log('  node src/cacheManager.js stats');
  console.log('  node src/cacheManager.js clear');
  console.log('  node src/cacheManager.js clear-old 7');
  console.log('  node src/cacheManager.js export');
}

if (require.main === module) {
  main();
}

module.exports = { main };

