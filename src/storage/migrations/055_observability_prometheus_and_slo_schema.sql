-- Migration 055: Observability Prometheus & Multi-Window SLO Alert Schema (WP-8.3)
-- Subsystem: Prometheus Metrics Registry, Multi-Window SLO Burn Rate Alerts, Distributed Spans

CREATE TABLE IF NOT EXISTS prometheus_metric_snapshots (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  snapshot_timestamp TEXT NOT NULL,
  metric_name TEXT NOT NULL,
  metric_type TEXT NOT NULL,
  labels_json TEXT NOT NULL DEFAULT '{}',
  value REAL NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_prometheus_metric_snapshots_tenant ON prometheus_metric_snapshots(tenant_id, metric_name, snapshot_timestamp);

CREATE TABLE IF NOT EXISTS slo_alert_incidents (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  slo_id TEXT NOT NULL,
  alert_id TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('P1_CRITICAL', 'P2_HIGH', 'P3_MEDIUM', 'P4_LOW')),
  burn_rate_1h REAL NOT NULL,
  burn_rate_6h REAL NOT NULL DEFAULT 1.0,
  burn_rate_24h REAL NOT NULL,
  remaining_budget_percent REAL NOT NULL,
  escalated_attention_item_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('firing', 'acknowledged', 'resolved')),
  channels_json TEXT NOT NULL DEFAULT '["slack", "pagerduty", "webhook"]',
  incident_summary TEXT NOT NULL,
  dispatched_at TEXT NOT NULL,
  acknowledged_at TEXT,
  resolved_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  FOREIGN KEY (slo_id) REFERENCES slo_definitions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_slo_alert_incidents_tenant ON slo_alert_incidents(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_slo_alert_incidents_slo ON slo_alert_incidents(slo_id, status);
