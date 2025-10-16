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

const db = require('./db');

/**
 * Phase 3.1 Schema Migration: Add root cause analysis tables
 */
async function migratePhase3() {
  console.log('🔨 Running Phase 3.1 migration...');

  try {
    // Enable pgvector extension
    console.log('📦 Enabling pgvector extension...');
    await db.query('CREATE EXTENSION IF NOT EXISTS vector;');
    console.log('✅ pgvector extension enabled');

    // Create root_causes table
    console.log('📋 Creating root_causes table...');
    await db.query(`
      CREATE TABLE IF NOT EXISTS root_causes (
        id SERIAL PRIMARY KEY,
        category VARCHAR(100) NOT NULL,
        title VARCHAR(255) NOT NULL,
        description TEXT,
        pattern TEXT,
        annotation_embedding VECTOR(1536),
        suggested_fix TEXT,
        confidence_threshold FLOAT DEFAULT 0.85,
        occurrence_count INTEGER DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('✅ Created table: root_causes');

    // Create indexes for root_causes
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_root_causes_category 
      ON root_causes(category);
    `);
    console.log('✅ Created index: idx_root_causes_category');

    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_root_causes_embedding 
      ON root_causes USING ivfflat (annotation_embedding vector_cosine_ops)
      WITH (lists = 100);
    `);
    console.log('✅ Created index: idx_root_causes_embedding');

    // Create job_root_causes table
    console.log('📋 Creating job_root_causes table...');
    await db.query(`
      CREATE TABLE IF NOT EXISTS job_root_causes (
        id SERIAL PRIMARY KEY,
        job_id BIGINT NOT NULL REFERENCES jobs(job_id) ON DELETE CASCADE,
        root_cause_id INTEGER REFERENCES root_causes(id) ON DELETE SET NULL,
        confidence FLOAT NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
        detection_method VARCHAR(50) NOT NULL,
        llm_model VARCHAR(100),
        llm_tokens_used INTEGER,
        analysis_duration_ms INTEGER,
        raw_analysis TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('✅ Created table: job_root_causes');

    // Create indexes for job_root_causes
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_job_root_causes_job_id 
      ON job_root_causes(job_id);
    `);
    console.log('✅ Created index: idx_job_root_causes_job_id');

    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_job_root_causes_root_cause_id 
      ON job_root_causes(root_cause_id);
    `);
    console.log('✅ Created index: idx_job_root_causes_root_cause_id');

    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_job_root_causes_method 
      ON job_root_causes(detection_method);
    `);
    console.log('✅ Created index: idx_job_root_causes_method');

    console.log('✨ Phase 3.1 migration completed successfully!');
  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    throw error;
  }
}

/**
 * Rollback Phase 3.1 migration
 */
async function rollbackPhase3() {
  console.log('⚠️  Rolling back Phase 3.1 migration...');

  try {
    await db.query('DROP TABLE IF EXISTS job_root_causes CASCADE;');
    console.log('✅ Dropped table: job_root_causes');

    await db.query('DROP TABLE IF EXISTS root_causes CASCADE;');
    console.log('✅ Dropped table: root_causes');

    console.log('✨ Rollback completed');
  } catch (error) {
    console.error('❌ Rollback failed:', error.message);
    throw error;
  }
}

// CLI interface
if (require.main === module) {
  const command = process.argv[2];

  (async () => {
    try {
      const connected = await db.testConnection();
      if (!connected) {
        console.error('❌ Cannot proceed without database connection');
        process.exit(1);
      }

      switch (command) {
        case 'up':
          await migratePhase3();
          break;
        case 'down':
          await rollbackPhase3();
          break;
        default:
          console.log('Usage: node migratePhase3.js [up|down]');
          console.log('  up   - Run Phase 3.1 migration');
          console.log('  down - Rollback Phase 3.1 migration');
      }
    } catch (error) {
      console.error('❌ Command failed:', error);
      process.exit(1);
    } finally {
      await db.end();
    }
  })();
}

module.exports = {
  migratePhase3,
  rollbackPhase3
};

