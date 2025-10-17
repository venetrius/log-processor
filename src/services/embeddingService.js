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

const db = require('../db/db');
const localEmbedAdapter = require('../llm/adapters/localEmbedAdapter');

/**
 * Build context text for embedding from root cause
 * Combines all relevant fields into a single string
 */
function buildEmbeddingContext(rootCause) {
  const parts = [
    rootCause.category,
    rootCause.title,
    rootCause.description || '',
    rootCause.suggested_fix || ''
  ];

  return parts.filter(p => p).join(' | ');
}

/**
 * Generate and store embedding for a root cause
 * @param {number} rootCauseId - Root cause ID
 * @param {object} adapter - Embedding adapter (defaults to local)
 * @returns {Promise<object>} - Generated embedding metadata
 */
async function generateRootCauseEmbedding(rootCauseId, adapter = localEmbedAdapter) {
  // Fetch root cause
  const result = await db.query(
    'SELECT * FROM root_causes WHERE id = $1',
    [rootCauseId]
  );

  if (result.rows.length === 0) {
    throw new Error(`Root cause ${rootCauseId} not found`);
  }

  const rootCause = result.rows[0];

  // Build embedding text
  const text = buildEmbeddingContext(rootCause);

  // Generate embedding
  const { embedding, model, dimensions, duration_ms, text_length, tokens } = await adapter.generateEmbedding(text);

  // Store embedding with metadata
  await db.query(
    `UPDATE root_causes 
     SET annotation_embedding = $1::vector,
         embedding_model = $2,
         embedding_config = $3,
         embedding_generated = TRUE,
         updated_at = NOW()
     WHERE id = $4`,
    [
      JSON.stringify(embedding),
      model,
      JSON.stringify({
        dimensions,
        text_length,
        tokens,
        duration_ms,
        generated_at: new Date().toISOString()
      }),
      rootCauseId
    ]
  );

  return { embedding, model, dimensions, duration_ms };
}

/**
 * Find similar root causes using cosine similarity
 * @param {number[]} queryEmbedding - Query embedding vector
 * @param {number} threshold - Similarity threshold (0-1)
 * @param {number} limit - Maximum results to return
 * @returns {Promise<object[]>} - Array of similar root causes with similarity scores
 */
async function findSimilarRootCauses(queryEmbedding, threshold = 0.75, limit = 5) {
  const result = await db.query(
    `SELECT 
       rc.id,
       rc.category,
       rc.title,
       rc.description,
       rc.suggested_fix,
       rc.occurrence_count,
       rc.discovery_method,
       rc.last_seen_at,
       1 - (rc.annotation_embedding <=> $1::vector) as similarity
     FROM root_causes rc
     WHERE rc.embedding_generated = TRUE
       AND rc.annotation_embedding IS NOT NULL
       AND 1 - (rc.annotation_embedding <=> $1::vector) >= $2
     ORDER BY rc.annotation_embedding <=> $1::vector
     LIMIT $3`,
    [JSON.stringify(queryEmbedding), threshold, limit]
  );

  return result.rows;
}

/**
 * Generate embedding for query text (error annotations)
 * @param {object[]} errorAnnotations - Array of error annotations
 * @param {object} adapter - Embedding adapter
 * @returns {Promise<number[]>} - Query embedding vector
 */
async function generateQueryEmbedding(errorAnnotations, adapter = localEmbedAdapter) {
  // Combine error annotations into a single text
  const text = errorAnnotations
    .map(a => `${a.title || ''} ${a.message}`.trim())
    .filter(t => t.length > 0)
    .join(' | ');

  if (!text) {
    throw new Error('Cannot generate query embedding from empty error annotations');
  }

  const { embedding } = await adapter.generateEmbedding(text);
  return embedding;
}

/**
 * Batch process: generate embeddings for all root causes without embeddings
 * @param {object} adapter - Embedding adapter
 * @returns {Promise<object>} - Processing statistics
 */
async function generateMissingEmbeddings(adapter = localEmbedAdapter) {
  const result = await db.query(
    `SELECT id, title FROM root_causes 
     WHERE embedding_generated = FALSE 
     ORDER BY created_at DESC`
  );

  const rootCauseIds = result.rows;
  const total = rootCauseIds.length;

  console.log(`📊 Found ${total} root causes without embeddings`);

  if (total === 0) {
    return { total: 0, processed: 0, failed: 0, duration_ms: 0 };
  }

  const startTime = Date.now();
  let processed = 0;
  let failed = 0;

  for (const { id, title } of rootCauseIds) {
    try {
      await generateRootCauseEmbedding(id, adapter);
      processed++;
      console.log(`✅ [${processed}/${total}] Generated embedding for: ${title}`);
    } catch (error) {
      failed++;
      console.error(`❌ [${processed + failed}/${total}] Failed for "${title}":`, error.message);
    }
  }

  const duration_ms = Date.now() - startTime;

  return { total, processed, failed, duration_ms };
}

/**
 * Get embedding statistics
 * @returns {Promise<object>} - Statistics about embeddings
 */
async function getStats() {
  const result = await db.query(`
    SELECT 
      COUNT(*) as total_root_causes,
      COUNT(*) FILTER (WHERE embedding_generated = TRUE) as with_embeddings,
      COUNT(*) FILTER (WHERE embedding_generated = FALSE) as without_embeddings,
      COUNT(DISTINCT embedding_model) as models_used,
      AVG((embedding_config->>'duration_ms')::int) FILTER (WHERE embedding_config IS NOT NULL) as avg_generation_time_ms
    FROM root_causes
  `);

  return result.rows[0];
}

/**
 * Test embedding generation and similarity search
 * @returns {Promise<void>}
 */
async function testEmbeddings() {
  console.log('🧪 Testing embedding service...\n');

  // Test 1: Generate embedding for sample text
  console.log('Test 1: Generate embedding');
  const adapter = localEmbedAdapter;
  const testText = "NPM install failed with ECONNREFUSED error";
  const { embedding, model, dimensions, duration_ms } = await adapter.generateEmbedding(testText);
  console.log(`✅ Generated ${dimensions}-dim embedding in ${duration_ms}ms`);
  console.log(`   Model: ${model}`);
  console.log(`   First 5 values: [${embedding.slice(0, 5).map(v => v.toFixed(4)).join(', ')}...]`);

  // Test 2: Find similar root causes
  console.log('\nTest 2: Find similar root causes');
  const similar = await findSimilarRootCauses(embedding, 0.5, 3);
  console.log(`✅ Found ${similar.length} similar root causes`);
  similar.forEach((rc, i) => {
    console.log(`   ${i + 1}. [${rc.similarity.toFixed(3)}] ${rc.title}`);
  });

  // Test 3: Get statistics
  console.log('\nTest 3: Get statistics');
  const stats = await getStats();
  console.log(`✅ Statistics:`);
  console.log(`   Total root causes: ${stats.total_root_causes}`);
  console.log(`   With embeddings: ${stats.with_embeddings}`);
  console.log(`   Without embeddings: ${stats.without_embeddings}`);
  console.log(`   Models used: ${stats.models_used || 0}`);
  if (stats.avg_generation_time_ms) {
    console.log(`   Avg generation time: ${Math.round(stats.avg_generation_time_ms)}ms`);
  }

  console.log('\n✨ All tests passed!');
}

module.exports = {
  generateRootCauseEmbedding,
  findSimilarRootCauses,
  generateQueryEmbedding,
  generateMissingEmbeddings,
  buildEmbeddingContext,
  getStats,
  testEmbeddings
};

