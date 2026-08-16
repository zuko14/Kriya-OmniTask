-- 024_production_infrastructure_schema.sql
-- Subsystem: Production Infrastructure, Asynchronous Worker Queues, Connection Pool Diagnostics, and Secret Auditing

CREATE TABLE IF NOT EXISTS async_job_queue (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  queue_name TEXT NOT NULL DEFAULT 'default', -- high, default, low, batch
  job_type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 50, -- 1 (lowest) to 100 (highest)
  status TEXT NOT NULL DEFAULT 'pending', -- pending, running, completed, failed, dead_letter
  max_retries INTEGER NOT NULL DEFAULT 3,
  retry_count INTEGER NOT NULL DEFAULT 0,
  run_at TEXT NOT NULL,
  locked_by_worker TEXT,
  locked_until TEXT,
  error_message TEXT,
  result_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);

CREATE TABLE IF NOT EXISTS scheduled_jobs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  cron_expression TEXT NOT NULL, -- e.g., '0 * * * *' (hourly) or '*/15 * * * *'
  job_type TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  last_run_at TEXT,
  next_run_at TEXT,
  last_status TEXT, -- success, failure, skipped
  metadata_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS secret_audit_records (
  id TEXT PRIMARY KEY,
  scan_type TEXT NOT NULL, -- config_env, database_credentials, agent_tokens
  secrets_scanned_count INTEGER NOT NULL,
  vulnerabilities_found_count INTEGER NOT NULL,
  audit_report_json TEXT NOT NULL,
  scanned_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_async_job_queue_status_priority ON async_job_queue(queue_name, status, priority DESC, run_at ASC);
CREATE INDEX IF NOT EXISTS idx_async_job_queue_tenant ON async_job_queue(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_scheduled_jobs_active ON scheduled_jobs(is_active, next_run_at);
