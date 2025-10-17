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

let embeddingPipeline = null;
let pipelineFactory = null;
const MODEL_NAME = 'Xenova/all-MiniLM-L6-v2';
const EMBEDDING_DIM = 384;

/**
 * Initialize the embedding pipeline (lazy loading)
 * Uses dynamic import() to load the ES module
 */
async function initialize() {
  if (!embeddingPipeline) {
    console.log('🔧 Loading local embedding model...');
    console.log(`   Model: ${MODEL_NAME}`);
    console.log(`   Dimensions: ${EMBEDDING_DIM}`);
    console.log('   (First run will download ~80MB model)');

    const startTime = Date.now();

    // Dynamic import for ES module
    if (!pipelineFactory) {
      const transformers = await import('@xenova/transformers');
      pipelineFactory = transformers.pipeline;
    }

    embeddingPipeline = await pipelineFactory('feature-extraction', MODEL_NAME);
    const duration = Date.now() - startTime;

    console.log(`✅ Local embedding model ready (${duration}ms)`);
  }
}

/**
 * Generate embedding for a single text
 * @param {string} text - Input text to embed
 * @param {object} options - Optional parameters
 * @returns {Promise<object>} - Embedding result with metadata
 */
async function generateEmbedding(text, options = {}) {
  await initialize();

  if (!text || text.trim().length === 0) {
    throw new Error('Cannot generate embedding for empty text');
  }

  const startTime = Date.now();

  // Generate embedding
  const output = await embeddingPipeline(text, {
    pooling: 'mean',
    normalize: true
  });

  // Convert to array
  const embedding = Array.from(output.data);

  const duration = Date.now() - startTime;

  return {
    embedding,
    model: MODEL_NAME,
    dimensions: EMBEDDING_DIM,
    tokens: text.split(/\s+/).length, // Approximate token count
    duration_ms: duration,
    text_length: text.length
  };
}

/**
 * Generate embeddings for multiple texts in batch
 * @param {string[]} texts - Array of texts to embed
 * @param {object} options - Optional parameters
 * @returns {Promise<object[]>} - Array of embedding results
 */
async function generateBatch(texts, options = {}) {
  await initialize();

  console.log(`📦 Generating ${texts.length} embeddings in batch...`);
  const startTime = Date.now();

  const embeddings = await Promise.all(
    texts.map(text => generateEmbedding(text, options))
  );

  const duration = Date.now() - startTime;
  console.log(`✅ Batch complete: ${texts.length} embeddings in ${duration}ms (avg: ${Math.round(duration / texts.length)}ms each)`);

  return embeddings;
}

/**
 * Get model information
 */
function getModelInfo() {
  return {
    name: MODEL_NAME,
    dimensions: EMBEDDING_DIM,
    type: 'sentence-transformer',
    provider: 'local',
    cost_per_embedding: 0
  };
}

module.exports = {
  generateEmbedding,
  generateBatch,
  getModelInfo,
  MODEL_NAME,
  EMBEDDING_DIM
};

