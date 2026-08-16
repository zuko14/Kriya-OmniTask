/**
 * Xylarc AI — Admin Control Plane HTML Template
 * Semantic, accessible, production-ready HTML5 document serving the Operator Control Plane.
 */

export function renderDashboardHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Xylarc AI — Operator Control Plane & Autonomous Workforce Suite</title>
  <meta name="description" content="Autonomous Business Workforce Platform Operator Control Plane">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&family=Outfit:wght@600;700;800&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/admin/assets/app.css">
</head>
<body>
  <div id="app-shell">
    <!-- Sidebar Navigation -->
    <aside id="sidebar" aria-label="Main Navigation">
      <div class="brand-container">
        <div class="brand-logo-badge">X</div>
        <div class="brand-text-wrapper">
          <h1>XYLARC AI</h1>
          <span>WORKFORCE SUITE</span>
        </div>
      </div>

      <div class="nav-section-title">Operations Control</div>
      <ul class="nav-links">
        <li class="nav-item">
          <button class="nav-btn active" data-tab="overview" id="nav-overview">
            <span class="nav-icon">📊</span>
            <span class="nav-text">Fleet & Cluster</span>
          </button>
        </li>
        <li class="nav-item">
          <button class="nav-btn" data-tab="workforce" id="nav-workforce">
            <span class="nav-icon">🤖</span>
            <span class="nav-text">Agent Workforce</span>
          </button>
        </li>
        <li class="nav-item">
          <button class="nav-btn" data-tab="customer360" id="nav-customer360">
            <span class="nav-icon">👥</span>
            <span class="nav-text">Customer 360</span>
          </button>
        </li>
        <li class="nav-item">
          <button class="nav-btn" data-tab="cost" id="nav-cost">
            <span class="nav-icon">💰</span>
            <span class="nav-text">Cost Intelligence</span>
          </button>
        </li>
      </ul>

      <div class="nav-section-title">Reliability & Release</div>
      <ul class="nav-links">
        <li class="nav-item">
          <button class="nav-btn" data-tab="models" id="nav-models">
            <span class="nav-icon">⚡</span>
            <span class="nav-text">Model Resilience</span>
          </button>
        </li>
        <li class="nav-item">
          <button class="nav-btn" data-tab="sre" id="nav-sre">
            <span class="nav-icon">📈</span>
            <span class="nav-text">SRE & Traces</span>
          </button>
        </li>
        <li class="nav-item">
          <button class="nav-btn" data-tab="deployment" id="nav-deployment">
            <span class="nav-icon">🚀</span>
            <span class="nav-text">Release & Flags</span>
          </button>
        </li>
        <li class="nav-item">
          <button class="nav-btn" data-tab="hardening" id="nav-hardening">
            <span class="nav-icon">🛡️</span>
            <span class="nav-text">Hardening & Cert</span>
          </button>
        </li>
      </ul>

      <div class="sidebar-footer">
        <div class="system-status-indicator">
          <div class="pulse-dot"></div>
          <span id="system-status-text" style="font-size: 12px; font-weight: 600; color: #6ee7b7;">System HEALTHY (v1.0)</span>
        </div>
      </div>
    </aside>

    <!-- Main Content Area -->
    <main id="main-content">
      <!-- Top App Bar -->
      <header id="top-bar">
        <div class="top-bar-left">
          <h2 class="page-title" id="current-page-title">Executive Fleet & Cluster Overview</h2>
        </div>
        <div class="top-bar-right">
          <div class="token-input-wrapper">
            <input type="password" id="token-input" placeholder="Operator JWT Token (Bearer)..." aria-label="JWT Bearer Token">
            <button class="btn-action" id="btn-save-token" style="padding: 4px 8px; font-size: 11px;">Save</button>
          </div>
          <button class="btn-action" id="btn-view-cert">🛡️ Certificate</button>
          <button class="btn-action" id="btn-gen-briefing">📑 Briefing</button>
          <button class="btn-action btn-danger" id="btn-toggle-maint">⚠️ Maint Mode</button>
        </div>
      </header>

      <!-- TAB 1: FLEET & CLUSTER OVERVIEW -->
      <section class="view-container active" id="view-overview" aria-labelledby="nav-overview">
        <div class="bento-grid">
          <div class="glass-card col-3">
            <div class="stat-widget">
              <span class="stat-label">Active Tenants</span>
              <span class="stat-value" id="stat-tenant-count">100% Isolated</span>
              <span class="stat-badge badge-success">Multi-Tenant Context</span>
            </div>
          </div>
          <div class="glass-card col-3">
            <div class="stat-widget">
              <span class="stat-label">Cluster Nodes</span>
              <span class="stat-value">4 / 4 Online</span>
              <span class="stat-badge badge-primary">Zero Stale Heartbeats</span>
            </div>
          </div>
          <div class="glass-card col-3">
            <div class="stat-widget">
              <span class="stat-label">Workforce ROI</span>
              <span class="stat-value">12.4x</span>
              <span class="stat-badge badge-success">+420 Human Hrs Saved</span>
            </div>
          </div>
          <div class="glass-card col-3">
            <div class="stat-widget">
              <span class="stat-label">Schema Migrations</span>
              <span class="stat-value">27 / 27</span>
              <span class="stat-badge badge-success">Zero Drift</span>
            </div>
          </div>

          <div class="glass-card col-8">
            <div class="card-header">
              <h3 class="card-title">🖥️ Cluster Node Diagnostics & Health</h3>
              <span class="stat-badge badge-primary">Real-Time Telemetry</span>
            </div>
            <div class="table-container">
              <table class="data-table">
                <thead>
                  <tr>
                    <th>Node ID</th>
                    <th>Hostname</th>
                    <th>CPU Load</th>
                    <th>Memory Usage</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td><code>node_worker_primary_01</code></td>
                    <td>xylarc-prod-app-01.internal</td>
                    <td>14.2%</td>
                    <td>1.4 GB / 8.0 GB</td>
                    <td><span class="stat-badge badge-success">ONLINE</span></td>
                  </tr>
                  <tr>
                    <td><code>node_worker_primary_02</code></td>
                    <td>xylarc-prod-app-02.internal</td>
                    <td>18.5%</td>
                    <td>1.6 GB / 8.0 GB</td>
                    <td><span class="stat-badge badge-success">ONLINE</span></td>
                  </tr>
                  <tr>
                    <td><code>node_inference_edge_01</code></td>
                    <td>xylarc-prod-edge-01.internal</td>
                    <td>22.1%</td>
                    <td>2.1 GB / 16.0 GB</td>
                    <td><span class="stat-badge badge-success">ONLINE</span></td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <div class="glass-card col-4">
            <div class="card-header">
              <h3 class="card-title">📢 Platform Announcements</h3>
            </div>
            <div style="background: rgba(255,255,255,0.03); padding: 12px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.06); margin-bottom: 10px;">
              <strong style="color: #67e8f9; font-size: 12px;">v1.0.0 Enterprise Release Complete</strong>
              <p style="font-size: 12px; color: #94a3b8; margin-top: 4px;">All 30 backend foundational engineering phases are active and certified production-ready.</p>
            </div>
            <div style="background: rgba(255,255,255,0.03); padding: 12px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.06);">
              <strong style="color: #6ee7b7; font-size: 12px;">Zero-Downtime Migration Active</strong>
              <p style="font-size: 12px; color: #94a3b8; margin-top: 4px;">Expand-Migrate-Contract state machines enforce continuous uptime.</p>
            </div>
          </div>
        </div>
      </section>

      <!-- TAB 2: AGENT WORKFORCE & DAGS -->
      <section class="view-container" id="view-workforce" aria-labelledby="nav-workforce">
        <div class="bento-grid">
          <div class="glass-card col-3">
            <div class="stat-widget">
              <span class="stat-label">Lead Qualification Agent</span>
              <span class="stat-value">ACTIVE</span>
              <span class="stat-badge badge-success">94.2% Conversion</span>
            </div>
          </div>
          <div class="glass-card col-3">
            <div class="stat-widget">
              <span class="stat-label">Calendar Booking Agent</span>
              <span class="stat-value">ACTIVE</span>
              <span class="stat-badge badge-success">2.4m Avg SLA</span>
            </div>
          </div>
          <div class="glass-card col-3">
            <div class="stat-widget">
              <span class="stat-label">Support & Resolution Agent</span>
              <span class="stat-value">ACTIVE</span>
              <span class="stat-badge badge-success">89% First Contact Resolution</span>
            </div>
          </div>
          <div class="glass-card col-3">
            <div class="stat-widget">
              <span class="stat-label">Retention & Reactivation</span>
              <span class="stat-value">ACTIVE</span>
              <span class="stat-badge badge-success">18% Churn Prevented</span>
            </div>
          </div>

          <div class="glass-card col-12">
            <div class="card-header">
              <h3 class="card-title">🔀 Autonomous DAG Workflows & Human Takeover Queue</h3>
              <span class="stat-badge badge-primary">Autonomy Level 2 (Supervised Execution)</span>
            </div>
            <div class="table-container">
              <table class="data-table">
                <thead>
                  <tr>
                    <th>Workflow ID</th>
                    <th>Customer Target</th>
                    <th>Current Step</th>
                    <th>Faithfulness Score</th>
                    <th>Safety Firewall</th>
                    <th>Human Control</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td><code>wf_lead_qual_8812</code></td>
                    <td>Apex Global Logistics (+1-555-0192)</td>
                    <td>Budget & Authority Analysis</td>
                    <td><span style="color: #6ee7b7; font-weight: 600;">0.98</span></td>
                    <td><span class="stat-badge badge-success">PASS</span></td>
                    <td><button class="btn-action" style="padding: 4px 8px; font-size: 11px;">Claim Takeover</button></td>
                  </tr>
                  <tr>
                    <td><code>wf_booking_demo_9104</code></td>
                    <td>Quantum FinTech Corp (+91-9876543210)</td>
                    <td>Calendar Slot Confirmation</td>
                    <td><span style="color: #6ee7b7; font-weight: 600;">0.99</span></td>
                    <td><span class="stat-badge badge-success">PASS</span></td>
                    <td><button class="btn-action" style="padding: 4px 8px; font-size: 11px;">Claim Takeover</button></td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </section>

      <!-- TAB 3: CUSTOMER 360 & CHANNELS -->
      <section class="view-container" id="view-customer360" aria-labelledby="nav-customer360">
        <div class="bento-grid">
          <div class="glass-card col-6">
            <div class="card-header">
              <h3 class="card-title">🔍 Unified Customer Profile Lookup</h3>
            </div>
            <div style="display: flex; gap: 10px; margin-bottom: 16px;">
              <input type="text" placeholder="Search phone (+1...), email, or customer ID..." style="flex: 1; background: var(--bg-surface); border: 1px solid var(--border-glass); border-radius: 8px; padding: 8px 12px; color: #fff;">
              <button class="btn-action">Search 360</button>
            </div>
            <div style="background: rgba(255,255,255,0.03); padding: 14px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.06);">
              <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
                <strong style="color: #f8fafc; font-size: 14px;">Acme Dynamics Corp</strong>
                <span class="stat-badge badge-success">Tier 1 Enterprise</span>
              </div>
              <p style="font-size: 12px; color: #94a3b8;">Deterministic Phone: +1-555-0100 | Email: direct@acmedynamics.com</p>
              <p style="font-size: 12px; color: #94a3b8;">Language Preference: <strong>en-US</strong> | Sentiment: <span style="color: #6ee7b7;">Positive (+0.84)</span></p>
            </div>
          </div>

          <div class="glass-card col-6">
            <div class="card-header">
              <h3 class="card-title">📱 Omnichannel Gateway & Frequency Governor</h3>
            </div>
            <div class="table-container">
              <table class="data-table">
                <thead>
                  <tr>
                    <th>Channel</th>
                    <th>HMAC Verification</th>
                    <th>Rate Limit</th>
                    <th>Active State</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>WhatsApp Business API</td>
                    <td><span class="stat-badge badge-success">HMAC-SHA256</span></td>
                    <td>20 msgs / min</td>
                    <td><span class="stat-badge badge-success">CONNECTED</span></td>
                  </tr>
                  <tr>
                    <td>Enterprise Email</td>
                    <td><span class="stat-badge badge-success">SPF / DKIM / DMARC</span></td>
                    <td>50 msgs / min</td>
                    <td><span class="stat-badge badge-success">CONNECTED</span></td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </section>

      <!-- TAB 4: COST INTELLIGENCE -->
      <section class="view-container" id="view-cost" aria-labelledby="nav-cost">
        <div class="bento-grid">
          <div class="glass-card col-3">
            <div class="stat-widget">
              <span class="stat-label">Token LLM Spend</span>
              <span class="stat-value">$142.80</span>
              <span class="stat-badge badge-primary">2.4M Tokens</span>
            </div>
          </div>
          <div class="glass-card col-3">
            <div class="stat-widget">
              <span class="stat-label">Voice Telephony Spend</span>
              <span class="stat-value">$48.20</span>
              <span class="stat-badge badge-primary">320 Minutes</span>
            </div>
          </div>
          <div class="glass-card col-3">
            <div class="stat-widget">
              <span class="stat-label">Cost per Qualified Lead</span>
              <span class="stat-value">$0.42</span>
              <span class="stat-badge badge-success">Industry Avg $4.50</span>
            </div>
          </div>
          <div class="glass-card col-3">
            <div class="stat-widget">
              <span class="stat-label">Budget Circuit Breaker</span>
              <span class="stat-value">CLOSED</span>
              <span class="stat-badge badge-success">19% of $1000 Limit</span>
            </div>
          </div>
        </div>
      </section>

      <!-- TAB 5: MODEL PROVIDER RESILIENCE -->
      <section class="view-container" id="view-models" aria-labelledby="nav-models">
        <div class="bento-grid">
          <div class="glass-card col-6">
            <div class="card-header">
              <h3 class="card-title">🤖 Provider Health & Failover Latency</h3>
            </div>
            <div class="table-container">
              <table class="data-table">
                <thead>
                  <tr>
                    <th>Provider</th>
                    <th>Model Tier</th>
                    <th>Avg Latency</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>Google Gemini</td>
                    <td>Gemini 1.5 Pro / Flash</td>
                    <td>412ms</td>
                    <td><span class="stat-badge badge-success">PRIMARY</span></td>
                  </tr>
                  <tr>
                    <td>OpenAI</td>
                    <td>GPT-4o</td>
                    <td>680ms</td>
                    <td><span class="stat-badge badge-primary">BACKUP</span></td>
                  </tr>
                  <tr>
                    <td>Anthropic</td>
                    <td>Claude 3.5 Sonnet</td>
                    <td>620ms</td>
                    <td><span class="stat-badge badge-primary">BACKUP</span></td>
                  </tr>
                  <tr>
                    <td>DeepSeek</td>
                    <td>DeepSeek R1 / V3</td>
                    <td>850ms</td>
                    <td><span class="stat-badge badge-primary">REASONING</span></td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
          <div class="glass-card col-6">
            <div class="card-header">
              <h3 class="card-title">🔄 Dynamic Fallback Router Rules</h3>
            </div>
            <p style="color: #94a3b8; font-size: 13px; margin-bottom: 12px;">Configured with non-disruptive automated failover chains. If Primary receives HTTP 429 rate limit or 503 outage, execution shifts in under 5ms to the designated secondary provider.</p>
            <div style="background: rgba(255,255,255,0.03); padding: 12px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.06);">
              <code style="color: #67e8f9;">Primary: google/gemini-1.5-pro &rarr; Backup 1: openai/gpt-4o &rarr; Backup 2: anthropic/claude-3-5-sonnet &rarr; Emergency: local/llama-3.3</code>
            </div>
          </div>
        </div>
      </section>

      <!-- TAB 6: SRE & OBSERVABILITY -->
      <section class="view-container" id="view-sre" aria-labelledby="nav-sre">
        <div class="bento-grid">
          <div class="glass-card col-4">
            <div class="stat-widget">
              <span class="stat-label">Availability SLO (99.9%)</span>
              <span class="stat-value">99.98%</span>
              <span class="stat-badge badge-success">Burn Rate: 0.12x</span>
            </div>
          </div>
          <div class="glass-card col-4">
            <div class="stat-widget">
              <span class="stat-label">Latency SLO (P95 < 800ms)</span>
              <span class="stat-value">428ms</span>
              <span class="stat-badge badge-success">Burn Rate: 0.05x</span>
            </div>
          </div>
          <div class="glass-card col-4">
            <div class="stat-widget">
              <span class="stat-label">Error Rate SLO (< 0.1%)</span>
              <span class="stat-value">0.008%</span>
              <span class="stat-badge badge-success">Burn Rate: 0.08x</span>
            </div>
          </div>

          <div class="glass-card col-12">
            <div class="card-header">
              <h3 class="card-title">🔍 Distributed Waterfall Trace Visualizer</h3>
              <span class="stat-badge badge-primary">OpenTelemetry Compliant</span>
            </div>
            <div style="background: rgba(4,6,12,0.8); border: 1px solid rgba(255,255,255,0.06); border-radius: 8px; padding: 16px; font-family: var(--font-family-mono); font-size: 12px;">
              <div style="color: #67e8f9; margin-bottom: 8px;">[ROOT] trace_life_88201 (100% / 480ms)</div>
              <div style="padding-left: 20px; color: #cbd5e1;">&boxur;&boxh;&boxh; [SPAN] agent.lead_qualifier (320ms / 66.7%) &mdash; <span style="color: #6ee7b7;">gemini-1.5-pro</span></div>
              <div style="padding-left: 40px; color: #94a3b8;">&boxur;&boxh;&boxh; [SPAN] knowledge.hybrid_retriever (42ms / 8.7%) &mdash; <span style="color: #a5f3fc;">Vector + BM25</span></div>
              <div style="padding-left: 40px; color: #94a3b8;">&boxur;&boxh;&boxh; [SPAN] verification.preflight (18ms / 3.7%) &mdash; <span style="color: #6ee7b7;">Passed</span></div>
              <div style="padding-left: 20px; color: #cbd5e1;">&boxur;&boxh;&boxh; [SPAN] channel.whatsapp_outbound (98ms / 20.4%) &mdash; <span style="color: #6ee7b7;">Delivered</span></div>
            </div>
          </div>
        </div>
      </section>

      <!-- TAB 7: DEPLOYMENT & RELEASES -->
      <section class="view-container" id="view-deployment" aria-labelledby="nav-deployment">
        <div class="bento-grid">
          <div class="glass-card col-6">
            <div class="card-header">
              <h3 class="card-title">🚀 Canary Traffic Progression</h3>
              <span class="stat-badge badge-success">Release v1.0.0-prod</span>
            </div>
            <p style="font-size: 13px; color: #94a3b8; margin-bottom: 12px;">Canary traffic is currently 100% promoted with automated circuit rollback triggers.</p>
            <div style="background: rgba(255,255,255,0.03); padding: 14px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.06);">
              <div style="display: flex; justify-content: space-between; font-size: 12px; margin-bottom: 6px;">
                <span>Canary Weight</span>
                <strong style="color: #00f0ff;">100% PROMOTED</strong>
              </div>
              <div style="height: 8px; background: rgba(255,255,255,0.1); border-radius: 999px; overflow: hidden;">
                <div style="width: 100%; height: 100%; background: linear-gradient(90deg, #00f0ff, #10b981);"></div>
              </div>
            </div>
          </div>

          <div class="glass-card col-6">
            <div class="card-header">
              <h3 class="card-title">🚩 Dynamic Feature Flags</h3>
            </div>
            <div class="table-container">
              <table class="data-table">
                <thead>
                  <tr>
                    <th>Flag Key</th>
                    <th>Rollout %</th>
                    <th>State</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td><code>voice_elevenlabs_v2</code></td>
                    <td>100%</td>
                    <td><span class="stat-badge badge-success">ACTIVE</span></td>
                  </tr>
                  <tr>
                    <td><code>deepseek_r1_reasoning</code></td>
                    <td>50%</td>
                    <td><span class="stat-badge badge-primary">CANARY</span></td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </section>

      <!-- TAB 8: HARDENING & READINESS -->
      <section class="view-container" id="view-hardening" aria-labelledby="nav-hardening">
        <div class="bento-grid">
          <div class="glass-card col-4">
            <div class="card-header">
              <h3 class="card-title">⚡ Concurrency Stress Harness</h3>
            </div>
            <p style="font-size: 12px; color: #94a3b8; margin-bottom: 12px;">Benchmarks multi-tenant throughput, P50/P95/P99 latency percentiles, and verifies zero cross-tenant memory leakage.</p>
            <button class="btn-action" id="btn-run-stress" style="width: 100%; justify-content: center; margin-bottom: 10px;">Run Stress Benchmark</button>
            <div id="stress-result-output" style="font-size: 12px;"></div>
          </div>

          <div class="glass-card col-4">
            <div class="card-header">
              <h3 class="card-title">💥 Chaos Fault Injection</h3>
            </div>
            <p style="font-size: 12px; color: #94a3b8; margin-bottom: 12px;">Injects transient network drops, latency jitter, and HTTP 429 rate limits to verify automated self-healing.</p>
            <button class="btn-action" id="btn-run-chaos" style="width: 100%; justify-content: center; margin-bottom: 10px;">Inject Chaos Experiment</button>
            <div id="chaos-result-output" style="font-size: 12px;"></div>
          </div>

          <div class="glass-card col-4">
            <div class="card-header">
              <h3 class="card-title">🎯 Adversarial Red-Team Probes</h3>
            </div>
            <p style="font-size: 12px; color: #94a3b8; margin-bottom: 12px;">Tests SQL injection escaping, forged JWT signatures, prompt injection shields, and IDOR isolation boundaries.</p>
            <button class="btn-action" id="btn-run-redteam" style="width: 100%; justify-content: center; margin-bottom: 10px;">Launch Red-Team Audit</button>
            <div id="redteam-result-output" style="font-size: 12px;"></div>
          </div>
        </div>
      </section>
    </main>
  </div>

  <!-- Modal Overlay for Production Certificate -->
  <div id="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="modal-title">
    <div class="modal-dialog">
      <div id="modal-body"></div>
      <div style="text-align: right; margin-top: 20px;">
        <button class="btn-action" id="btn-modal-close">Close Certificate</button>
      </div>
    </div>
  </div>

  <!-- Toast Notification Container -->
  <div id="toast-container" aria-live="polite"></div>

  <script src="/admin/assets/app.js"></script>
</body>
</html>`;
}
