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
const embeddingService = require('./services/embeddingService');

async function main() {
  console.log('🚀 Starting batch embedding generation...\n');

  try {
    const connected = await db.testConnection();
    if (!connected) {
      console.error('❌ Database connection failed');
      process.exit(1);
    }

    // Get current statistics
    const statsBefore = await embeddingService.getStats();
    console.log('📊 Current Statistics:');
    console.log(`   Total root causes: ${statsBefore.total_root_causes}`);
    console.log(`   With embeddings: ${statsBefore.with_embeddings}`);
    console.log(`   Without embeddings: ${statsBefore.without_embeddings}\n`);

    if (statsBefore.without_embeddings === 0) {
      console.log('✅ All root causes already have embeddings!');
      return;
    }

    console.log(`🔧 Processing ${statsBefore.without_embeddings} root causes...\n`);
    const result = await embeddingService.generateMissingEmbeddings();

    console.log('\n✨ Batch processing complete!');
    console.log(`   Processed: ${result.processed}/${result.total}`);
    console.log(`   Failed: ${result.failed}`);
    console.log(`   Duration: ${Math.round(result.duration_ms / 1000)}s`);
    console.log(`   Avg per embedding: ${Math.round(result.duration_ms / result.processed)}ms`);

    // Get updated statistics
    const statsAfter = await embeddingService.getStats();
    console.log('\n📊 Final Statistics:');
    console.log(`   Total root causes: ${statsAfter.total_root_causes}`);
    console.log(`   With embeddings: ${statsAfter.with_embeddings}`);
    console.log(`   Without embeddings: ${statsAfter.without_embeddings}`);
    if (statsAfter.avg_generation_time_ms) {
      console.log(`   Avg generation time: ${Math.round(statsAfter.avg_generation_time_ms)}ms`);
    }

  } catch (error) {
    console.error('❌ Batch processing failed:', error);
    process.exit(1);
  } finally {
    await db.end();
  }
}

if (require.main === module) {
  main();
}

module.exports = { main };

