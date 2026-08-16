# Xylarc AI — Autonomous Agent Workforce Platform

[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue.svg)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-v24.x-green.svg)](https://nodejs.org/)
[![Fastify](https://img.shields.io/badge/Fastify-4.x-black.svg)](https://fastify.dev/)
[![React](https://img.shields.io/badge/React-19.x-blue.svg)](https://react.dev/)
[![Vitest](https://img.shields.io/badge/Vitest-Passed-green.svg)](https://vitest.dev/)
[![License](https://img.shields.io/badge/License-MIT-purple.svg)](LICENSE)

**Xylarc AI** is an enterprise-grade **Autonomous Business Workforce Platform** that transitions organizations from siloed chatbots to a coordinated, multi-agent digital workforce across Lead Qualification, Consultative Sales, Omnichannel Support, Customer 360, Scheduling, Churn Retention, and Executive Operations.

---

## 🏛️ Four-Plane System Architecture

1. **Control Plane:** Multi-tenant hierarchy, identity, dynamic RBAC/ABAC policy engine, organization workspaces, quotas, and feature flags.
2. **Governance Plane:** Agent Safety Firewall, 4-tier risk classification (`LOW`, `MEDIUM`, `HIGH`, `BLOCK`), deterministic verification, emergency kill-switches, and cryptographic tamper-evident audit ledger.
3. **Execution Plane:** Hierarchical multi-agent runtime (Strategy & Operations Managers + Domain Specialist Agents), OpenRouter dynamic model router, and sandboxed tool execution gateway.
4. **Intelligence Plane:** Continuous customer 360 identity resolution, business digital twin, sentiment & urgency radar, and hybrid RAG knowledge fabric.

---

## 🛠️ Technology Stack

* **Backend Runtime:** Node.js 24 (ESM Native) / TypeScript 5.x
* **API Framework:** Fastify REST API + WebSockets / SSE
* **Schema Safety:** Zod 3.x for runtime contracts and tool parameters
* **Frontend Admin:** React 19 / Vite SPA with custom Token Design System
* **Database & Caching:** SQLite / PostgreSQL (Supabase) + Redis
* **AI Provider Routing:** OpenRouter, Google Gemini, Anthropic Claude, OpenAI, Groq, Ollama
* **Omnichannel Channels:** WhatsApp Cloud API, Twilio Voice/SMS, Resend/SMTP Email
* **Monetization:** Stripe Payment Intents & Webhooks

---

## 🚀 Quick Start

### 1. Installation
```bash
# Clone the repository
git clone https://github.com/chaitanyakumar1403-sudo/agent-workforce.git
cd agent-workforce

# Install all monorepo dependencies (Backend + Frontend)
npm install
```

### 2. Environment Setup
Copy the environment template and fill in your API keys:
```bash
cp .env.example .env
cp web/.env.example web/.env
```

### 3. Verification & Test Suite
```bash
# Run backend TypeScript verification (0 errors)
npm run typecheck

# Run backend test suite (154 test files / 359 tests)
npm test

# Run frontend verification & production build
npm --prefix web run typecheck
npm --prefix web run build
```

### 4. Development Servers
```bash
# Start backend Fastify REST server (http://localhost:3000)
npm run dev

# Start frontend Vite admin console (http://localhost:5173)
npm --prefix web run dev
```

---

## 📄 License
MIT License. Developed by Xylarc AI Enterprise Engineering.
