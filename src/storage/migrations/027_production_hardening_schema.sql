-- ============================================================================
-- Migration 027: Production Hardening, Chaos & Red-Team Audit Schema
-- Phase 30 of Xylarc AI Autonomous Business Workforce
-- ============================================================================

-- 1. Hardening Stress Test Runs Table
CREATE TABLE IF NOT EXISTS hardening_stress_runs (
    id VARCHAR(36) PRIMARY KEY,
    run_name VARCHAR(100) NOT NULL,
    concurrency_level INTEGER NOT NULL,
    total_requests INTEGER NOT NULL,
    successful_requests INTEGER NOT NULL,
    failed_requests INTEGER NOT NULL,
    throughput_rps REAL NOT NULL,
    p50_latency_ms REAL NOT NULL,
    p95_latency_ms REAL NOT NULL,
    p99_latency_ms REAL NOT NULL,
    cross_tenant_leakage_detected BOOLEAN NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_stress_runs_created ON hardening_stress_runs(created_at);

-- 2. Chaos Injection Experiments Table
CREATE TABLE IF NOT EXISTS chaos_experiments (
    id VARCHAR(36) PRIMARY KEY,
    experiment_name VARCHAR(100) NOT NULL,
    fault_type VARCHAR(50) NOT NULL, -- 'latency', 'network_error', 'db_pool_exhaustion', 'rate_limit'
    injected_count INTEGER NOT NULL,
    survived_count INTEGER NOT NULL,
    recovery_time_ms INTEGER NOT NULL,
    status VARCHAR(30) NOT NULL, -- 'passed', 'failed'
    details_json TEXT NOT NULL DEFAULT '{}',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_chaos_fault ON chaos_experiments(fault_type);
CREATE INDEX IF NOT EXISTS idx_chaos_status ON chaos_experiments(status);

-- 3. Red-Team Adversarial Audits Table
CREATE TABLE IF NOT EXISTS red_team_audits (
    id VARCHAR(36) PRIMARY KEY,
    audit_name VARCHAR(100) NOT NULL,
    total_probes INTEGER NOT NULL,
    attacks_blocked INTEGER NOT NULL,
    vulnerabilities_found INTEGER NOT NULL,
    threat_score REAL NOT NULL, -- 0.0 to 10.0
    status VARCHAR(30) NOT NULL, -- 'passed', 'failed'
    findings_json TEXT NOT NULL DEFAULT '[]',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_red_team_status ON red_team_audits(status);

-- 4. Production Readiness Verification Table
CREATE TABLE IF NOT EXISTS production_readiness_checks (
    id VARCHAR(36) PRIMARY KEY,
    check_category VARCHAR(50) NOT NULL,
    check_name VARCHAR(100) NOT NULL,
    status VARCHAR(30) NOT NULL, -- 'passed', 'warning', 'failed'
    evidence TEXT NOT NULL,
    evaluated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_readiness_category ON production_readiness_checks(check_category);
CREATE INDEX IF NOT EXISTS idx_readiness_status ON production_readiness_checks(status);
