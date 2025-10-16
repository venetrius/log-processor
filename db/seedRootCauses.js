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
const { PATTERNS } = require('../patternMatcher');

/**
 * Seeds the root_causes table with predefined patterns
 */
async function seedRootCauses() {
  console.log('🌱 Seeding root_causes table...');

  try {
    let insertedCount = 0;
    let skippedCount = 0;

    for (const pattern of PATTERNS) {
      // Check if this pattern already exists
      const existing = await db.query(
        'SELECT id FROM root_causes WHERE category = $1 AND title = $2',
        [pattern.category, pattern.title]
      );

      if (existing.rows.length > 0) {
        console.log(`   ⏭️  Skipping existing pattern: ${pattern.title}`);
        skippedCount++;
        continue;
      }

      // Insert the pattern as a root cause
      await db.query(`
        INSERT INTO root_causes (
          category, title, description, pattern, 
          suggested_fix, confidence_threshold
        ) VALUES ($1, $2, $3, $4, $5, $6)
      `, [
        pattern.category,
        pattern.title,
        pattern.description,
        pattern.pattern.source, // Store regex as string
        pattern.suggestedFix,
        pattern.confidence
      ]);

      console.log(`   ✅ Inserted: ${pattern.title}`);
      insertedCount++;
    }

    console.log(`\n✨ Seeding complete!`);
    console.log(`   Inserted: ${insertedCount}`);
    console.log(`   Skipped: ${skippedCount}`);
    console.log(`   Total patterns: ${PATTERNS.length}`);

  } catch (error) {
    console.error('❌ Seeding failed:', error.message);
    throw error;
  }
}

// CLI interface
if (require.main === module) {
  (async () => {
    try {
      const connected = await db.testConnection();
      if (!connected) {
        console.error('❌ Cannot proceed without database connection');
        process.exit(1);
      }

      await seedRootCauses();
    } catch (error) {
      console.error('❌ Seeding failed:', error);
      process.exit(1);
    } finally {
      await db.end();
    }
  })();
}

module.exports = { seedRootCauses };

