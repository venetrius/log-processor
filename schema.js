
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
 * Creates the database schema
 */
async function createSchema() {
  console.log('🔨 Creating database schema...');

  try {
    // Create workflow_runs table
    await db.query(`
      CREATE TABLE IF NOT EXISTS workflow_runs (
        run_id BIGINT PRIMARY KEY,
        run_number INTEGER,
        workflow_name VARCHAR(255),
        workflow_file_name VARCHAR(255),
        repository VARCHAR(255) NOT NULL,
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
        fetched_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('✅ Created table: jobs');

    // Create job_steps table
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

    // Create indexes for common queries
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_jobs_run_id ON jobs(run_id);
    `);
    console.log('✅ Created index: idx_jobs_run_id');

    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_jobs_conclusion ON jobs(conclusion);
    `);
    console.log('✅ Created index: idx_jobs_conclusion');

    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_workflow_runs_repository ON workflow_runs(repository);
    `);
    console.log('✅ Created index: idx_workflow_runs_repository');

    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_workflow_runs_conclusion ON workflow_runs(conclusion);
    `);
    console.log('✅ Created index: idx_workflow_runs_conclusion');

    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_error_annotations_job_id ON error_annotations(job_id);
    `);
    console.log('✅ Created index: idx_error_annotations_job_id');

    console.log('✨ Database schema created successfully!');
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
          console.log('Usage: node schema.js [create|drop|reset]');
          console.log('  create - Create all tables and indexes');
          console.log('  drop   - Drop all tables');
          console.log('  reset  - Drop and recreate all tables');
      }
    } catch (error) {
      console.error('❌ Migration failed:', error);
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

