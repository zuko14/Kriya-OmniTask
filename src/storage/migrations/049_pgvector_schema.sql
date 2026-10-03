-- Kriya Omnitask — Real Embeddings & pgvector Schema (WP-5.8, Blueprint §10, §11, ADR-021)
-- Supports pgvector extension and vector columns on PostgreSQL while maintaining full SQLite in-memory compatibility.

-- PG: CREATE EXTENSION IF NOT EXISTS vector;

-- Add model and dimension metadata columns to knowledge_chunks
ALTER TABLE knowledge_chunks ADD COLUMN embedding_model TEXT DEFAULT 'text-embedding-3-small';
ALTER TABLE knowledge_chunks ADD COLUMN embedding_dimensions INTEGER DEFAULT 1536;

-- PG: ALTER TABLE knowledge_chunks ADD COLUMN IF NOT EXISTS embedding_vector vector(1536);
-- PG: CREATE INDEX IF NOT EXISTS idx_kchunks_vector ON knowledge_chunks USING hnsw (embedding_vector vector_cosine_ops);
