-- 023_billing_and_usage_schema.sql
-- Subsystem: Billing, Usage Metering, Channel Pricing, and Invoicing

CREATE TABLE IF NOT EXISTS billing_plans (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  plan_tier TEXT NOT NULL, -- starter, growth, enterprise, custom
  channel_plan TEXT NOT NULL, -- digital_only, voice_only, combined
  base_price_cents INTEGER NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'USD',
  billing_interval TEXT NOT NULL DEFAULT 'month', -- month, year
  included_tokens INTEGER NOT NULL DEFAULT 0,
  included_voice_minutes INTEGER NOT NULL DEFAULT 0,
  included_workflow_executions INTEGER NOT NULL DEFAULT 0,
  included_agents INTEGER NOT NULL DEFAULT 1,
  token_overage_rate_cents_per_k REAL NOT NULL DEFAULT 0.0,
  voice_minute_overage_rate_cents REAL NOT NULL DEFAULT 0.0,
  workflow_overage_rate_cents REAL NOT NULL DEFAULT 0.0,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tenant_subscriptions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  plan_id TEXT NOT NULL,
  status TEXT NOT NULL, -- active, past_due, canceled, trialing
  current_period_start TEXT NOT NULL,
  current_period_end TEXT NOT NULL,
  cancel_at_period_end INTEGER NOT NULL DEFAULT 0,
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  FOREIGN KEY (plan_id) REFERENCES billing_plans(id)
);

CREATE TABLE IF NOT EXISTS usage_meter_records (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  metric_type TEXT NOT NULL, -- tokens, voice_minutes, workflow_executions, agent_seat_hours, api_calls, vector_storage_mb
  quantity REAL NOT NULL,
  idempotency_key TEXT UNIQUE,
  recorded_at TEXT NOT NULL,
  metadata TEXT,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);

CREATE TABLE IF NOT EXISTS invoices (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  subscription_id TEXT,
  billing_period_start TEXT NOT NULL,
  billing_period_end TEXT NOT NULL,
  subtotal_amount_cents INTEGER NOT NULL,
  tax_rate_pct REAL NOT NULL DEFAULT 0.0,
  tax_amount_cents INTEGER NOT NULL DEFAULT 0,
  discount_amount_cents INTEGER NOT NULL DEFAULT 0,
  total_amount_cents INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  status TEXT NOT NULL, -- draft, open, paid, void, uncollectible
  stripe_payment_intent_id TEXT,
  paid_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);

CREATE TABLE IF NOT EXISTS invoice_line_items (
  id TEXT PRIMARY KEY,
  invoice_id TEXT NOT NULL,
  item_type TEXT NOT NULL, -- base_subscription, token_overage, voice_overage, workflow_overage, discount, tax
  description TEXT NOT NULL,
  quantity REAL NOT NULL DEFAULT 1.0,
  unit_price_cents INTEGER NOT NULL,
  amount_cents INTEGER NOT NULL,
  FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_usage_meter_tenant_date ON usage_meter_records(tenant_id, recorded_at);
CREATE INDEX IF NOT EXISTS idx_usage_meter_metric ON usage_meter_records(tenant_id, metric_type, recorded_at);
CREATE INDEX IF NOT EXISTS idx_invoices_tenant_period ON invoices(tenant_id, billing_period_start, billing_period_end);
CREATE INDEX IF NOT EXISTS idx_tenant_subscriptions_tenant ON tenant_subscriptions(tenant_id);
