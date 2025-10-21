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
 * Creates the complete database schema including semantic search support
 * Consolidated from schema.js + migratePhase3_v2.js
 */
async function createSchema() {
  console.log('🔨 Creating consolidated database schema...');

  try {
    // Enable pgvector extension for semantic search
    console.log('📦 Enabling pgvector extension...');
    await db.query('CREATE EXTENSION IF NOT EXISTS vector;');
    console.log('✅ pgvector extension enabled');

    // ============================================================
    // CORE TABLES (Workflow tracking)
    // ============================================================

    // Create workflow_runs table
    console.log('📋 Creating workflow_runs table...');
    await db.query(`
      CREATE TABLE IF NOT EXISTS workflow_runs (
        run_id BIGINT PRIMARY KEY,
        run_number INTEGER,
        workflow_name VARCHAR(255),
        workflow_file_name VARCHAR(255),
        repository VARCHAR(255) NOT NULL,
        head_branch VARCHAR(255),
        status VARCHAR(50),
        conclusion VARCHAR(50),
        html_url TEXT,
        created_at TIMESTAMP,
        updated_at TIMESTAMP,
        fetched_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('✅ Created table: workflow_runs');

    // Create jobs table
    console.log('📋 Creating jobs table...');
    await db.query(`
      CREATE TABLE IF NOT EXISTS jobs (
        job_id BIGINT PRIMARY KEY,
        run_id BIGINT NOT NULL REFERENCES workflow_runs(run_id) ON DELETE CASCADE,
        job_name VARCHAR(255) NOT NULL,
        status VARCHAR(50),
        conclusion VARCHAR(50),
        started_at TIMESTAMP,
        completed_at TIMESTAMP,
        html_url TEXT,
        log_file_path TEXT,
        logs_accessible BOOLEAN DEFAULT false,
        fetched_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('✅ Created table: jobs');

    // Create job_steps table
    console.log('📋 Creating job_steps table...');
    await db.query(`
      CREATE TABLE IF NOT EXISTS job_steps (
        id SERIAL PRIMARY KEY,
        job_id BIGINT NOT NULL REFERENCES jobs(job_id) ON DELETE CASCADE,
        step_name VARCHAR(255) NOT NULL,
        step_number INTEGER,
        status VARCHAR(50),
        conclusion VARCHAR(50),
        started_at TIMESTAMP,
        completed_at TIMESTAMP
      );
    `);
    console.log('✅ Created table: job_steps');

    // Create error_annotations table
    console.log('📋 Creating error_annotations table...');
    await db.query(`
      CREATE TABLE IF NOT EXISTS error_annotations (
        id SERIAL PRIMARY KEY,
        job_id BIGINT NOT NULL REFERENCES jobs(job_id) ON DELETE CASCADE,
        annotation_level VARCHAR(50),
        message TEXT NOT NULL,
        path VARCHAR(500),
        start_line INTEGER,
        end_line INTEGER,
        title VARCHAR(500),
        raw_details TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('✅ Created table: error_annotations');

    // ============================================================
    // ROOT CAUSE ANALYSIS TABLES (Phase 3.2 - Semantic Search)
    // ============================================================

    // Create root_causes table with semantic search support
    console.log('📋 Creating root_causes table (with semantic search support)...');
    await db.query(`
      CREATE TABLE IF NOT EXISTS root_causes (
        id SERIAL PRIMARY KEY,
        category VARCHAR(100) NOT NULL,
        title VARCHAR(255) NOT NULL,
        description TEXT,
        pattern TEXT,
        annotation_embedding VECTOR(384),
        suggested_fix TEXT,
        confidence_threshold FLOAT DEFAULT 0.85,
        occurrence_count INTEGER DEFAULT 1,
        discovery_method VARCHAR(50) DEFAULT 'pattern',
        embedding_model VARCHAR(100),
        embedding_config JSONB,
        embedding_generated BOOLEAN DEFAULT FALSE,
        last_seen_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('✅ Created table: root_causes');

    // Create job_root_causes junction table
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

    // ============================================================
    // INDEXES
    // ============================================================

    console.log('📇 Creating indexes...');

    // Workflow tracking indexes
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_jobs_run_id
      ON jobs(run_id);
    `);
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_jobs_conclusion
      ON jobs(conclusion);
    `);
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_jobs_logs_accessible
      ON jobs(logs_accessible);
    `);
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_workflow_runs_repository
      ON workflow_runs(repository);
    `);
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_workflow_runs_conclusion
      ON workflow_runs(conclusion);
    `);
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_workflow_runs_branch
      ON workflow_runs(head_branch);
    `);
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_error_annotations_job_id
      ON error_annotations(job_id);
    `);
    console.log('✅ Created workflow tracking indexes');

    // Root cause indexes
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_root_causes_category
      ON root_causes(category);
    `);
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_root_causes_embedding
      ON root_causes USING ivfflat (annotation_embedding vector_cosine_ops)
      WITH (lists = 100);
    `);
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_root_causes_no_embedding
      ON root_causes(embedding_generated)
      WHERE embedding_generated = FALSE;
    `);
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_root_causes_discovery
      ON root_causes(discovery_method);
    `);
    await db.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_root_causes_unique_title
      ON root_causes(category, title);
    `);
    console.log('✅ Created root cause indexes');

    // Job-root cause relationship indexes
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_job_root_causes_job_id
      ON job_root_causes(job_id);
    `);
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_job_root_causes_root_cause_id
      ON job_root_causes(root_cause_id);
    `);
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_job_root_causes_method
      ON job_root_causes(detection_method);
    `);
    console.log('✅ Created job-root cause relationship indexes');

    console.log('');
    console.log('✨ Database schema created successfully!');
    console.log('');
    console.log('📊 Tables created:');
    console.log('   • workflow_runs - GitHub workflow run metadata');
    console.log('   • jobs - Job execution details (with logs_accessible for lazy loading)');
    console.log('   • job_steps - Individual step execution');
    console.log('   • error_annotations - Error messages and failures');
    console.log('   • root_causes - Knowledge base of failure patterns');
    console.log('   • job_root_causes - Job-to-root-cause associations');
    console.log('');
    console.log('🔍 Semantic search features:');
    console.log('   ✓ pgvector extension enabled');
    console.log('   ✓ Embedding dimension: 384 (local model compatible)');
    console.log('   ✓ Embedding metadata tracking (model + JSONB config)');
    console.log('   ✓ Discovery method tracking');
    console.log('   ✓ Last seen timestamp');
    console.log('   ✓ Unique constraint on root causes');
    console.log('   ✓ Batch processing support');
    console.log('');
    console.log('🚀 Ready for semantic search implementation!');
  } catch (error) {
    console.error('❌ Error creating schema:', error.message);
    throw error;
  }
}

/**
 * Drops all tables (use with caution!)
 */
async function dropSchema() {
  console.log('⚠️  Dropping database schema...');

  try {
    // Drop in reverse order of dependencies
    await db.query('DROP TABLE IF EXISTS job_root_causes CASCADE;');
    await db.query('DROP TABLE IF EXISTS root_causes CASCADE;');
    await db.query('DROP TABLE IF EXISTS error_annotations CASCADE;');
    await db.query('DROP TABLE IF EXISTS job_steps CASCADE;');
    await db.query('DROP TABLE IF EXISTS jobs CASCADE;');
    await db.query('DROP TABLE IF EXISTS workflow_runs CASCADE;');

    console.log('✅ All tables dropped');
  } catch (error) {
    console.error('❌ Error dropping schema:', error.message);
    throw error;
  }
}

/**
 * Reset the database (drop and recreate)
 */
async function resetSchema() {
  await dropSchema();
  await createSchema();
}

// CLI interface
if (require.main === module) {
  const command = process.argv[2];

  (async () => {
    try {
      // Test connection first
      const connected = await db.testConnection();
      if (!connected) {
        console.error('❌ Cannot proceed without database connection');
        process.exit(1);
      }

      switch (command) {
        case 'create':
          await createSchema();
          break;
        case 'drop':
          await dropSchema();
          break;
        case 'reset':
          await resetSchema();
          break;
        default:
          console.log('Usage: node schema_consolidated.js [create|drop|reset]');
          console.log('  create - Create all tables and indexes');
          console.log('  drop   - Drop all tables');
          console.log('  reset  - Drop and recreate all tables');
          console.log('');
          console.log('This consolidated schema includes:');
          console.log('  • Core workflow tracking tables');
          console.log('  • Root cause analysis (Phase 3.2)');
          console.log('  • Semantic search support (384-dim embeddings)');
          console.log('  • Lazy loading optimization (logs_accessible)');
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
  createSchema,
  dropSchema,
  resetSchema
};

