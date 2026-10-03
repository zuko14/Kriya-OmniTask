/**
 * Kriya AI — Standard Platform Prometheus Metrics
 * Core observability indicators for HTTP traffic, agent workflows, LLM usage, tool executions, and SLOs.
 */

import { globalPrometheusRegistry, Counter, Gauge, Histogram } from './prometheusRegistry.js';

export class PlatformMetrics {
  // HTTP Metrics
  public static readonly httpRequestsTotal: Counter = globalPrometheusRegistry.registerCounter(
    'http_requests_total',
    'Total count of handled HTTP requests',
    ['method', 'route', 'status_code', 'tenant_id']
  );

  public static readonly httpRequestDurationSeconds: Histogram = globalPrometheusRegistry.registerHistogram(
    'http_request_duration_seconds',
    'Duration of HTTP requests in seconds',
    ['method', 'route', 'status_code'],
    [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10]
  );

  // Agent Execution Metrics
  public static readonly agentExecutionsTotal: Counter = globalPrometheusRegistry.registerCounter(
    'agent_executions_total',
    'Total executions of autonomous agents and workflows',
    ['agent_slug', 'tenant_id', 'status']
  );

  public static readonly agentExecutionDurationSeconds: Histogram = globalPrometheusRegistry.registerHistogram(
    'agent_execution_duration_seconds',
    'Latency of agent workflow and step execution in seconds',
    ['agent_slug', 'tenant_id'],
    [0.1, 0.5, 1, 2, 5, 10, 30, 60, 120]
  );

  // LLM Gateway Metrics
  public static readonly modelTokensTotal: Counter = globalPrometheusRegistry.registerCounter(
    'model_tokens_total',
    'Total token consumption across model providers',
    ['model_id', 'token_type', 'tenant_id']
  );

  public static readonly modelCallDurationSeconds: Histogram = globalPrometheusRegistry.registerHistogram(
    'model_call_duration_seconds',
    'Latency of LLM inference calls in seconds',
    ['model_id', 'tenant_id'],
    [0.1, 0.25, 0.5, 1, 2, 5, 10, 20, 45]
  );

  // Tool & Gateway Execution Metrics
  public static readonly toolExecutionsTotal: Counter = globalPrometheusRegistry.registerCounter(
    'tool_executions_total',
    'Total invocations of registered tools and connectors',
    ['tool_name', 'status', 'tenant_id']
  );

  public static readonly toolExecutionDurationSeconds: Histogram = globalPrometheusRegistry.registerHistogram(
    'tool_execution_duration_seconds',
    'Duration of tool execution in seconds',
    ['tool_name', 'tenant_id'],
    [0.01, 0.05, 0.1, 0.5, 1, 3, 10, 30]
  );

  // SRE & SLO Indicators
  public static readonly sloBurnRateRatio: Gauge = globalPrometheusRegistry.registerGauge(
    'slo_burn_rate_ratio',
    'Current error budget burn rate ratio over defined time windows (1h, 6h, 24h)',
    ['slo_id', 'service_name', 'window']
  );

  public static readonly sloErrorBudgetRemainingPercent: Gauge = globalPrometheusRegistry.registerGauge(
    'slo_error_budget_remaining_percent',
    'Remaining error budget percentage for a Service Level Objective',
    ['slo_id', 'service_name']
  );

  // Job Queue & Infrastructure Metrics
  public static readonly queueActiveJobs: Gauge = globalPrometheusRegistry.registerGauge(
    'queue_active_jobs',
    'Number of active or pending jobs in durable queues',
    ['queue_name', 'tenant_id']
  );

  public static readonly dbQueryDurationSeconds: Histogram = globalPrometheusRegistry.registerHistogram(
    'db_query_duration_seconds',
    'Database statement and query execution latency in seconds',
    ['operation', 'table'],
    [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.5, 1, 5]
  );

  /**
   * Resets all registered platform metrics (useful for isolated tests).
   */
  public static resetAll(): void {
    globalPrometheusRegistry.resetAll();
  }
}
