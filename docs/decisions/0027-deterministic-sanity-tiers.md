# ADR-0027: Deterministic-only sanity-check tiers

**Status:** Accepted
**Date:** 2026-04-29
**Supersedes:** None

## Context

The harness audit (2026-04-29) introduced two sanity-check tiers — a fast tier that runs after every harness tweak and a deep tier scheduled as a daily cron — to stabilize the system before the v1 RepoNav pass. The user's stated philosophy is "80% deterministic, 20% LLM dependency" (see `memory/user_philosophy.md`). A sanity check that fails when an LLM provider is unavailable would rank the harness's behavior on something it cannot guarantee — defeating the point of the check.

## Decision

Both `/sanity:fast` and the layer-by-layer scripts under `scripts/sanity/` MUST be fully deterministic and runnable with **no** LLM provider configured. The fast tier never invokes `DynamicLLMProvider`, `tourGenerator`, or any other code path that triggers a network call to a model provider. The deep tier (`/sanity:deep`) MAY include a *weekly*, opt-in, key-gated live-provider smoke (Groq + Anthropic), but its result is **advisory** — it never gates the deep run's overall pass/fail verdict.

Concretely:
- Sanity scripts assert structure, contracts, file sizes, exit codes, deterministic analyzer output hashes, hook outcomes from synthetic fixtures.
- LLM-touching tests (`src/ai/**.test.ts`) run with provider mocks, never live calls, in fast tier.
- The system-e2e smoke runs the CLI + MCP analyze parity check against a read-only fixture (`archive/express`) — no LLM in the loop.

## Consequences

- Sanity tiers stay green even when API keys are absent, vscode.lm is unavailable, or a provider's endpoint is down.
- The MockProvider terminator contract from ADR-0025 remains the only LLM-shape verification carried by the fast tier.
- New tests that depend on a real provider must be tagged and routed exclusively to the weekly opt-in suite.
- The `LLMProvider` cascade still emits a usage record per call (per ADR-0028), so live-mode behavior remains observable on the rare occasions sanity runs touch it.
