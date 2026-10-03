-- Migration 046: Durable Job Queue & Scheduling Engine Extensions (docs/kriya WP-5.9)
-- Subsystem: Priority Queues, Dead Letter Queue (DLQ), Concurrency Locks, and Timezone/Quiet Hours Governance

ALTER TABLE async_job_queue ADD COLUMN correlation_id TEXT;
ALTER TABLE async_job_queue ADD COLUMN idempotency_key TEXT;
ALTER TABLE async_job_queue ADD COLUMN timezone TEXT DEFAULT 'UTC';
ALTER TABLE async_job_queue ADD COLUMN quiet_hours_policy TEXT DEFAULT 'none';
ALTER TABLE async_job_queue ADD COLUMN last_heartbeat_at TEXT;
ALTER TABLE async_job_queue ADD COLUMN execution_duration_ms INTEGER DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_async_job_queue_claim ON async_job_queue(queue_name, status, run_at, priority DESC);
CREATE INDEX IF NOT EXISTS idx_async_job_queue_locked ON async_job_queue(status, locked_until);
CREATE INDEX IF NOT EXISTS idx_async_job_queue_idempotency ON async_job_queue(tenant_id, idempotency_key);
CREATE INDEX IF NOT EXISTS idx_async_job_queue_correlation ON async_job_queue(tenant_id, correlation_id);
