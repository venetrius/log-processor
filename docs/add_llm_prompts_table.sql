/*
 * Migration: Add llm_prompts table for prompt-based semantic search
 *
 * NOTE: This table is intentionally kept as a separate migration (not in schema.js)
 * because it stores cache data that should persist across database resets during development.
 * When you run `npm run db:reset`, this table preserves your LLM prompt cache.
 *
 * Usage: psql -d log-process -f docs/add_llm_prompts_table.sql
 */

-- Create llm_prompts table
CREATE TABLE IF NOT EXISTS llm_prompts (
  id SERIAL PRIMARY KEY,
  prompt_hash VARCHAR(64) UNIQUE NOT NULL,
  prompt_text TEXT NOT NULL,
  prompt_embedding VECTOR(384),
  job_id BIGINT REFERENCES jobs(job_id) ON DELETE CASCADE,
  error_annotation_ids INTEGER[],
  failed_step_names TEXT[],
  log_excerpt_length INTEGER,
  llm_model VARCHAR(100),
  llm_response TEXT,
  llm_tokens_used INTEGER,
  llm_duration_ms INTEGER,
  root_cause_id INTEGER REFERENCES root_causes(id) ON DELETE SET NULL,
  confidence FLOAT CHECK (confidence >= 0 AND confidence <= 1),
  was_helpful BOOLEAN,
  reused_count INTEGER DEFAULT 0,
  last_reused_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for llm_prompts
CREATE INDEX IF NOT EXISTS idx_llm_prompts_hash ON llm_prompts(prompt_hash);
CREATE INDEX IF NOT EXISTS idx_llm_prompts_job_id ON llm_prompts(job_id);
CREATE INDEX IF NOT EXISTS idx_llm_prompts_root_cause_id ON llm_prompts(root_cause_id);
CREATE INDEX IF NOT EXISTS idx_llm_prompts_embedding
  ON llm_prompts USING ivfflat (prompt_embedding vector_cosine_ops) WITH (lists = 100);
CREATE INDEX IF NOT EXISTS idx_llm_prompts_no_embedding ON llm_prompts(id) WHERE prompt_embedding IS NULL;

-- Verify table was created
SELECT 'llm_prompts table created successfully!' as status;
