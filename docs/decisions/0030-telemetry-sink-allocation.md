# ADR-0030: Telemetry sink allocation

**Status:** Accepted
**Date:** 2026-04-29
**Supersedes:** None

## Context

The harness audit (2026-04-29) added several new telemetry probes (LLM token usage, governance cache hit/miss, hook OUTCOME line, future tier-split timing, future workstream events). Without an explicit ownership map, future probes risk fragmenting telemetry into a sprawl of tiny `.jsonl` files — each with its own schema, retention, and consumer. Inversely, dumping every event into one log makes consumers do dispatch on shape rather than file path. Both extremes lower the signal-to-noise of the SLO dashboard.

## Decision

The harness has six canonical telemetry sinks. Every probe MUST emit into exactly one of them. New sinks require a successor ADR.

| Sink | Owner | What lives here |
|---|---|---|
| `.reponav/mcp-usage.jsonl` | MCP server (`src/mcp/mcpServer.ts:logUsage`) | Per-MCP-tool invocation: `{ts, tool, repo, params, duration_ms, output_chars, approx_tokens}`. Future: webview ↔ extension messages tagged `kind:"webview"`. |
| `.reponav/llm-usage.jsonl` | DynamicLLMProvider (`src/telemetry/llmUsageLog.ts`) | Per-LLM-provider call: `{ts, provider, model?, promptTokens?, completionTokens?, totalTokens?, durationMs, callerTool, mode, chosen?, candidatesTried?, cascadeFailed?, error?}`. Per ADR 0028 emission is mandatory. |
| `.reponav/hook.log` | Governance hook + cache (`run-governance-gate.sh`, `governance-gate.mjs`, `governanceResultCache.ts`) | Plaintext lines, one per hook lifecycle event. Markers: `INVOKE`, `OUTCOME`, `PASS`, `BLOCKED`, `WARN`, `SKIP`, `CACHE`, `CRASH`, `FATAL`. |
| `.reponav/tier-timing.jsonl` (future) | Analyzer tier orchestrator (`src/analyzers/index.ts`) | Per-tier timing: `{ts, tier, durationMs, fileCount, repo, cacheHit}`. Sink to be created when probe lands. |
| `.reponav/proctor/latest-summary.json` | Proctor aggregator | Daily skill + sanity-deep summary: `{generatedAt, day, eventCount, skills, sanityDeep?}`. Single replaced JSON, not append-only. |
| `.reponav/parallel-workstreams.events.jsonl` (future) | parallelManifest (`src/services/parallelManifest.ts`) | Workstream FSM transitions: `{ts, stream, fromState, toState, actor}`. Sink to be created when probe lands. |
| `.reponav/mcp-gate-events.jsonl` | RepoNav MCP gate (`scripts/governance-mcp-gate.cjs`) | Pre-existing — RepoNav-MCP gate decisions. Owner clarified by ADR 0029. |

### Schemas are append-only

Fields may be added but never renamed or dropped. Consumers must tolerate unknown fields. Renames require a new sink + a deprecation window — never an in-place rename.

### Auto-trim

Every `.jsonl` sink listed above retains 30 days. The proctor cron is responsible for daily rotation (cut points: midnight UTC + size > 50 MB). Sinks below the trim threshold are untouched.

### What does NOT belong in any sink

- Secrets, API keys, full prompt bodies, full LLM outputs (truncate or hash).
- Stack traces unless the event's `cascadeFailed=true` or `outcome="CRASH"` — keep raw debug logs out of these structured sinks.
- Source code being checked. The hook may include the file path, never the content.

## Consequences

- Every new probe gets a one-line decision: which sink owns it. No new files unless an ADR successor adds one.
- The SLO dashboard (`scripts/proctor/scorecard-dashboard.js` extension) can hard-code six paths and stop discovering files at runtime.
- Deprecating a sink requires a new ADR — protects against accidental schema thrash.
- Schema-versioning is implicit (additive). Tooling that depends on a specific field shape must guard for `undefined` or use a typed reader.
- Today's audit-2026-04-29 sinks (`mcp-usage.jsonl`, `llm-usage.jsonl`, `hook.log`, `mcp-gate-events.jsonl`, `proctor/latest-summary.json`) are already populated; the two future sinks (`tier-timing.jsonl`, `parallel-workstreams.events.jsonl`) come online with their respective probes per the rollout plan.
