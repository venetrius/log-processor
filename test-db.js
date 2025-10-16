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
 * Test database connectivity and display connection info
 */
async function testDatabase() {
  console.log('🧪 Testing database connection...\n');

  console.log('📋 Connection Details:');
  console.log(`   Host: ${process.env.DB_HOST}`);
  console.log(`   Port: ${process.env.DB_PORT}`);
  console.log(`   Database: ${process.env.DB_NAME}`);
  console.log(`   User: ${process.env.DB_USER}`);
  console.log('');

  try {
    // Test basic connectivity
    const connected = await db.testConnection();

    if (!connected) {
      console.error('❌ Connection test failed');
      process.exit(1);
    }

    // Test a simple query
    console.log('\n🔍 Testing query execution...');
    const result = await db.query('SELECT version()');
    console.log('✅ PostgreSQL version:', result.rows[0].version);

    // List existing tables
    console.log('\n📊 Checking existing tables...');
    const tables = await db.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
      ORDER BY table_name;
    `);

    if (tables.rows.length === 0) {
      console.log('   No tables found. Run "node schema.js create" to create the schema.');
    } else {
      console.log('   Found tables:');
      tables.rows.forEach(row => {
        console.log(`   - ${row.table_name}`);
      });
    }

    console.log('\n✨ Database connection test completed successfully!');

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    process.exit(1);
  } finally {
    await db.end();
  }
}

// Run the test
testDatabase();

