# ADR-005 — One Model Gateway for every agent model call

**Status:** Accepted (2026-10-01, Session 04) · **WP:** docs/kriya WP-1.1, WP-1.3

## Context
Three overlapping "routers" existed: `orchestration/routing/ModelRouter` (execution + primary/fallback
from the agent's hardcoded model names), `model/certification/CertifiedModelRouter` (pick a certified
model by tier × language with a degradation ladder, but never executed anything), and
`model/resilience/DynamicModelRouter` + `ModelFallbackManager` (registry/policy plan + execution,
used only by the `/model-resilience/execute` API). Agents called `ModelRouter` directly, so the
owner's chosen, certified brain was never used, and certification did not gate execution.

## Decision
`src/model/gateway/modelGateway.ts` is the single entry point for agent model calls:

1. Refuse before spending if the tenant brain config is not `active` (paused / budget exhausted).
2. Select only models holding a **valid, unexpired certification cell** for (tier × language):
   owner brains first (assigned-to-agent first, BYO key read from the vault), then — only for
   `managed` supply — platform-certified models via `CertifiedModelRouter`'s ladder. Reduced
   autonomy / decompose routes mark the output as a draft needing approval. Otherwise escalate.
3. Execute through `ModelRouter` (now a low-level executor) with fallback across certified candidates.
4. Structured output: validate against a Zod schema; exactly one repair attempt; then
   `StructuredOutputError`. A schema failure does not fall through to other models.
5. Sandbox/test only: with nothing certified, run the simulated adapter, labelled `sandbox_uncertified`.

Agents declare `capabilityTier` in their config (default T2; orchestrator T3).

## Consequences
- A production tenant cannot run an agent until a brain is certified for that tier × language.
  This is intended (CLAUDE.md §9; blueprint "verified action").
- `CertifiedModelRouter` is retained as the gateway's managed-supply selection step.
- `DynamicModelRouter`/`ModelFallbackManager` remain only behind the legacy
  `/model-resilience/execute` API. Retire or route it through the gateway in a follow-up (tracked in 00_STATUS).
- BYO keys are validated against OpenRouter's `/key` endpoint; other providers are refused until a
  direct adapter exists (decision D2).
