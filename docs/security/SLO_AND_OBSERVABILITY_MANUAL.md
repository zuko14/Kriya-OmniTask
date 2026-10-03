# Kriya AI — Service Level Objectives (SLO) & Observability Operations Manual

## 1. Overview & Architecture
Kriya AI incorporates enterprise-grade Site Reliability Engineering (SRE) primitives conforming to Google SRE Workbook standards and Prometheus exposition guidelines (§WP-8.3, Milestone M8):
- **Metrics Exposition:** Prometheus text-based format at `/metrics` (unauthenticated for scrapers) and `/api/v1/observability/metrics/prometheus` (authenticated).
- **Distributed Tracing:** W3C Trace Context recommendation (`traceparent`, `tracestate`) across HTTP endpoints, agent loops, model gateways, and async tool executions.
- **SLO Multi-Window Burn Rate Alerting:** Real-time calculation of 1-hour ($14.4\times$), 6-hour ($6.0\times$), and 24-hour ($3.0\times$) error budget burn rates with automated dispatch to PagerDuty/Slack and escalation into the Human Attention Center (`reasonCategory: 'slo_burn'`).

---

## 2. Prometheus Scrape Configuration
To scrape metrics from a running Kriya AI cluster, add the following target to `prometheus.yml`:

```yaml
scrape_configs:
  - job_name: 'kriya-engine'
    scrape_interval: 15s
    scrape_timeout: 10s
    metrics_path: '/metrics'
    static_configs:
      - targets: ['api.kriya.ai:4000']
    metric_relabel_configs:
      - source_labels: [__name__]
        regex: '(http_.*|agent_.*|model_.*|tool_.*|slo_.*|queue_.*)'
        action: keep
```

---

## 3. Platform Metric Catalog

| Metric Name | Type | Labels | Description |
|---|---|---|---|
| `http_requests_total` | Counter | `method`, `route`, `status_code`, `tenant_id` | Total handled HTTP requests |
| `http_request_duration_seconds` | Histogram | `method`, `route`, `status_code` | HTTP request latency distribution in seconds |
| `agent_executions_total` | Counter | `agent_slug`, `tenant_id`, `status` | Total autonomous agent workflow invocations |
| `agent_execution_duration_seconds` | Histogram | `agent_slug`, `tenant_id` | End-to-end agent step and workflow duration |
| `model_tokens_total` | Counter | `model_id`, `token_type`, `tenant_id` | LLM token consumption (input vs output) |
| `model_call_duration_seconds` | Histogram | `model_id`, `tenant_id` | Model provider inference latency |
| `tool_executions_total` | Counter | `tool_name`, `status`, `tenant_id` | External connectors and tool calls |
| `tool_execution_duration_seconds` | Histogram | `tool_name`, `tenant_id` | Tool and connector invocation latency |
| `slo_burn_rate_ratio` | Gauge | `slo_id`, `service_name`, `window` | Error budget burn rate ratio (1h, 6h, 24h) |
| `slo_error_budget_remaining_percent` | Gauge | `slo_id`, `service_name` | Remaining error budget percentage |
| `queue_active_jobs` | Gauge | `queue_name`, `tenant_id` | Number of active jobs in durable queue |
| `db_query_duration_seconds` | Histogram | `operation`, `table` | Database read/write statement latency |

---

## 4. Multi-Window Multi-Burn-Rate Alerting Rules

Following Google SRE engineering guidelines:
- **1-Hour Window ($\ge 14.4\times$):** Consumes 2% of 30-day budget in 1 hour.
  - **Severity:** `P1_CRITICAL`
  - **Action:** Triggers PagerDuty page, broadcasts to incident Slack channel, and auto-escalates to Human Attention Center with `reasonCategory: 'slo_burn'`.
- **6-Hour Window ($\ge 6.0\times$):** Consumes 5% of 30-day budget in 6 hours.
  - **Severity:** `P2_HIGH`
  - **Action:** Notifies on-call engineer, marks ticket in SRE queue.
- **24-Hour Window ($\ge 3.0\times$):** Consumes 10% of 30-day budget in 24 hours.
  - **Severity:** `P3_MEDIUM`
  - **Action:** Automated warning alert sent to SRE operations channel.

### Recommended PromQL Alert Rules

```promql
# 1. Critical 1-Hour Burn Rate Page
alert: SloCriticalBurnRate1h
expr: slo_burn_rate_ratio{window="1h"} >= 14.4
for: 2m
labels:
  severity: critical
  page: true
annotations:
  summary: "SLO critical error budget burn on {{ $labels.service_name }}"
  description: "1-hour burn rate is {{ $value }}x (>14.4x threshold). Immediate mitigation needed."

# 2. Warning 6-Hour Burn Rate
alert: SloElevatedBurnRate6h
expr: slo_burn_rate_ratio{window="6h"} >= 6.0
for: 10m
labels:
  severity: warning
annotations:
  summary: "SLO elevated burn rate on {{ $labels.service_name }}"
  description: "6-hour burn rate is {{ $value }}x (>6.0x threshold)."

# 3. Budget Exhaustion Imminent
alert: SloBudgetExhaustion
expr: slo_error_budget_remaining_percent <= 10.0
for: 5m
labels:
  severity: critical
annotations:
  summary: "Error budget depleted on {{ $labels.service_name }}"
  description: "Remaining error budget is {{ $value }}% (<=10% threshold)."
```

---

## 5. Distributed Tracing & W3C Headers

### Inbound Requests
Incoming HTTP traffic can supply standard W3C headers:
```http
traceparent: 00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01
tracestate: kriya=t:tenant123,org:default
x-correlation-id: req_981a2f4
```

### Outbound Response Headers
Kriya AI always echoes back correlation ID and child traceparent:
```http
x-correlation-id: req_981a2f4
traceparent: 00-4bf92f3577b34da6a3ce929d0e0e4736-b7ad6b7169203331-01
```

### Querying Distributed Spans
SRE operators can query distributed spans by trace ID or step type:
```bash
curl -H "Authorization: Bearer <TOKEN>" \
  "https://api.kriya.ai/api/v1/observability/spans?traceId=4bf92f3577b34da6a3ce929d0e0e4736&stepType=tool_execution"
```

---

## 6. On-Call Incident Playbook: SLO Burn Alert

When paged for `[SLO CRITICAL BURN]`:
1. **Locate Attention Item:** Open Human Attention Center at `/app/attention` or query `GET /api/v1/observability/alerts?status=firing`.
2. **Review Metrics:** Check `/metrics` or Grafana dashboard for `model_call_duration_seconds` or `tool_executions_total{status="error"}`.
3. **Inspect Trace Waterfall:** Fetch the decision trace waterfall using `GET /api/v1/observability/traces/:traceId` to identify the failing microservice, tool, or model gateway.
4. **Trigger Fallback or Throttle:** If an upstream LLM provider is degraded, activate dynamic model fallback via `/api/v1/resilience/models/switch`.
5. **Acknowledge and Resolve:**
   ```bash
   curl -X POST -H "Authorization: Bearer <ADMIN_TOKEN>" \
     "https://api.kriya.ai/api/v1/observability/alerts/:incidentId/resolve"
   ```
