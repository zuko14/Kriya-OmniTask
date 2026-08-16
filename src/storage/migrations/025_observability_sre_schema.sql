-- 025_observability_sre_schema.sql
-- Subsystem: Site Reliability Engineering (SRE), Service Level Objectives (SLO), Error Budget Burn Rates & Alert Dispatchers

CREATE TABLE IF NOT EXISTS slo_definitions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  service_name TEXT NOT NULL,
  target_metric TEXT NOT NULL, -- availability, p95_latency_ms, p99_latency_ms, error_rate, workflow_success_rate
  target_threshold REAL NOT NULL, -- e.g. 99.9 for availability, 500 for p95_latency_ms
  window_days INTEGER NOT NULL DEFAULT 30,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS slo_evaluations (
  id TEXT PRIMARY KEY,
  slo_id TEXT NOT NULL,
  evaluation_timestamp TEXT NOT NULL,
  actual_metric_value REAL NOT NULL,
  is_compliant INTEGER NOT NULL,
  error_budget_total_pct REAL NOT NULL,
  error_budget_remaining_pct REAL NOT NULL,
  burn_rate_1h REAL NOT NULL DEFAULT 1.0,
  burn_rate_24h REAL NOT NULL DEFAULT 1.0,
  alert_status TEXT NOT NULL DEFAULT 'normal', -- normal, warning, critical
  FOREIGN KEY (slo_id) REFERENCES slo_definitions(id)
);

CREATE TABLE IF NOT EXISTS sre_alerts (
  id TEXT PRIMARY KEY,
  slo_id TEXT,
  severity TEXT NOT NULL, -- P1_CRITICAL, P2_HIGH, P3_MEDIUM, P4_LOW
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  channels_json TEXT NOT NULL, -- ["slack", "pagerduty", "webhook"]
  status TEXT NOT NULL DEFAULT 'firing', -- firing, acknowledged, resolved
  dispatched_at TEXT NOT NULL,
  acknowledged_at TEXT,
  resolved_at TEXT,
  metadata_json TEXT,
  FOREIGN KEY (slo_id) REFERENCES slo_definitions(id)
);

CREATE INDEX IF NOT EXISTS idx_slo_evaluations_slo_ts ON slo_evaluations(slo_id, evaluation_timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_sre_alerts_status ON sre_alerts(status, severity);
