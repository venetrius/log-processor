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

const crypto = require('crypto');
const db = require('../db/db');

let cacheInitialized = false;
let cacheEnabled = false;

/**
 * Generate a hash key from a command string
 */
function generateCacheKey(command) {
  return crypto.createHash('sha256').update(command).digest('hex');
}

/**
 * Initialize the GitHub CLI cache schema
 * This runs automatically on first cache operation, independent of main schema
 */
async function initializeCacheSchema() {
  if (cacheInitialized) {
    return;
  }

  // Only initialize if cache is enabled
  if (!cacheEnabled) {
    return;
  }

  try {
    // Create gh_cli_cache table if it doesn't exist
    await db.query(`
      CREATE TABLE IF NOT EXISTS gh_cli_cache (
        id SERIAL PRIMARY KEY,
        command_hash VARCHAR(64) UNIQUE NOT NULL,
        command TEXT NOT NULL,
        response TEXT NOT NULL,
        is_json BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_accessed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        access_count INTEGER DEFAULT 1
      );
    `);

    // Create index for faster lookups
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_gh_cli_cache_hash 
      ON gh_cli_cache(command_hash);
    `);

    // Create index for cleanup queries (find old entries)
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_gh_cli_cache_last_accessed 
      ON gh_cli_cache(last_accessed_at);
    `);

    cacheInitialized = true;
    console.log('✅ GitHub CLI cache schema initialized (independent of main schema)');
  } catch (error) {
    console.error('❌ Failed to initialize cache schema:', error.message);
    // Don't throw - cache is optional, allow app to continue
    cacheEnabled = false;
  }
}

/**
 * Enable or disable caching based on config
 */
function setCacheEnabled(enabled) {
  cacheEnabled = enabled;
  if (enabled) {
    console.log('🔧 GitHub CLI cache: ENABLED');
  } else {
    console.log('⚠️  GitHub CLI cache: DISABLED');
  }
}

/**
 * Check if caching is enabled
 */
function isCacheEnabled() {
  return cacheEnabled;
}

/**
 * Get cached response for a command
 */
async function getCachedResponse(command) {
  if (!cacheEnabled) {
    return null;
  }

  await initializeCacheSchema();

  const commandHash = generateCacheKey(command);

  try {
    const result = await db.query(
      `SELECT response, is_json 
       FROM gh_cli_cache 
       WHERE command_hash = $1`,
      [commandHash]
    );

    if (result.rows.length > 0) {
      // Update access tracking
      await db.query(
        `UPDATE gh_cli_cache 
         SET last_accessed_at = NOW(), 
             access_count = access_count + 1 
         WHERE command_hash = $1`,
        [commandHash]
      );

      console.log(`💾 Cache HIT for command: ${command.substring(0, 60)}...`);
      return result.rows[0];
    }

    console.log(`🔍 Cache MISS for command: ${command.substring(0, 60)}...`);
    return null;
  } catch (error) {
    console.error('❌ Cache lookup failed:', error.message);
    return null; // Fail gracefully, proceed without cache
  }
}

/**
 * Store response in cache
 */
async function setCachedResponse(command, response, isJson = true) {
  if (!cacheEnabled) {
    return;
  }

  await initializeCacheSchema();

  const commandHash = generateCacheKey(command);

  try {
    await db.query(
      `INSERT INTO gh_cli_cache (command_hash, command, response, is_json)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (command_hash) 
       DO UPDATE SET 
         response = EXCLUDED.response,
         last_accessed_at = NOW(),
         access_count = gh_cli_cache.access_count + 1`,
      [commandHash, command, response, isJson]
    );

    console.log(`💾 Cached response for command: ${command.substring(0, 60)}...`);
  } catch (error) {
    console.error('❌ Failed to cache response:', error.message);
    // Don't throw, caching is optional
  }
}

/**
 * Get cache statistics
 */
async function getCacheStats() {
  if (!cacheEnabled) {
    return { enabled: false };
  }

  await initializeCacheSchema();

  try {
    const result = await db.query(`
      SELECT 
        COUNT(*) as total_entries,
        SUM(access_count) as total_accesses,
        AVG(access_count) as avg_accesses_per_entry,
        COUNT(*) FILTER (WHERE access_count > 1) as reused_entries,
        MAX(last_accessed_at) as last_access,
        MIN(created_at) as oldest_entry
      FROM gh_cli_cache
    `);

    return {
      enabled: true,
      ...result.rows[0]
    };
  } catch (error) {
    console.error('❌ Failed to get cache stats:', error.message);
    return { enabled: true, error: error.message };
  }
}

/**
 * Clear all cache entries
 */
async function clearCache() {
  if (!cacheEnabled) {
    console.log('⚠️  Cache is disabled, nothing to clear');
    return { deleted: 0 };
  }

  await initializeCacheSchema();

  try {
    const result = await db.query('DELETE FROM gh_cli_cache');
    const deleted = result.rowCount;
    console.log(`✅ Cleared ${deleted} cache entries`);
    return { deleted };
  } catch (error) {
    console.error('❌ Failed to clear cache:', error.message);
    throw error;
  }
}

/**
 * Clear old cache entries (older than specified days)
 */
async function clearOldCache(daysOld = 30) {
  if (!cacheEnabled) {
    return { deleted: 0 };
  }

  await initializeCacheSchema();

  try {
    const result = await db.query(
      `DELETE FROM gh_cli_cache 
       WHERE last_accessed_at < NOW() - INTERVAL '${daysOld} days'`
    );
    const deleted = result.rowCount;
    console.log(`✅ Cleared ${deleted} cache entries older than ${daysOld} days`);
    return { deleted };
  } catch (error) {
    console.error('❌ Failed to clear old cache:', error.message);
    throw error;
  }
}

/**
 * Export cache to JSON (for backup or sharing)
 */
async function exportCache() {
  if (!cacheEnabled) {
    return [];
  }

  await initializeCacheSchema();

  try {
    const result = await db.query(
      'SELECT command, response, is_json, created_at FROM gh_cli_cache ORDER BY created_at'
    );
    return result.rows;
  } catch (error) {
    console.error('❌ Failed to export cache:', error.message);
    throw error;
  }
}

module.exports = {
  initializeCacheSchema,
  setCacheEnabled,
  isCacheEnabled,
  getCachedResponse,
  setCachedResponse,
  getCacheStats,
  clearCache,
  clearOldCache,
  exportCache
};
