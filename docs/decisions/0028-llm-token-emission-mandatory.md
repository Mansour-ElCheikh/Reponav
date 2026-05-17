# ADR-0028: Mandatory LLM token-usage telemetry

**Status:** Accepted
**Date:** 2026-04-29
**Supersedes:** None

## Context

Audit (2026-04-29) found that all configured providers (`AnthropicProvider`, `BaseOpenAICompatibleProvider`, etc.) extract `response.usage.{prompt,completion,total}_tokens` from their SDKs but **never emit those numbers anywhere**. The values are returned through `LLMResponse.usage` and dropped on the floor by callers. This left token cost invisible across the entire AI surface — no per-provider, per-model, per-session, or per-prompt accounting was possible.

A second blind spot lived in `DynamicLLMProvider.generate()`: the cascade chose a provider via `console.log(...)` only, with no structured record of which provider actually answered, how many fallbacks were tried, or how long the cascade took. Auto-mode behavior was effectively un-auditable.

## Decision

Every code path that calls a concrete `LLMProvider.generate()` MUST emit one structured telemetry record to `.reponav/llm-usage.jsonl` via `src/telemetry/llmUsageLog.ts`. The record schema is:

```
{ ts, provider, model?, promptTokens?, completionTokens?, totalTokens?,
  durationMs, callerTool, mode, chosen?, candidatesTried?, cascadeFailed?, error? }
```

The single point of emission is `DynamicLLMProvider.generate()` and `DynamicLLMProvider.generateStream()` — every concrete provider is reached only through these two entry points (verified by grep). Adding the emission here covers all current and future providers without per-provider plumbing.

`promptTokens` / `completionTokens` / `totalTokens` are populated when the underlying SDK exposes them; they remain `undefined` for providers that do not (e.g., `VSCodeLMProvider`, `MockProvider`). The schema is append-only — fields may be added but never renamed or dropped.

Future providers cannot land without flowing through `DynamicLLMProvider`. Direct instantiation of a concrete provider in product code is not a sanctioned path; if one ever appears it must be amended to use the dynamic dispatcher or call `logLLMUsage` directly.

## Consequences

- `.reponav/llm-usage.jsonl` becomes the canonical source for: per-provider call frequency, prompt/completion token totals, cascade depth, fallback rate, p95 latency. Sanity-check SLO dashboard derives most of its AI-cost metrics from this file.
- The fast sanity tier excludes live-provider tests (per ADR-0027), so the file accumulates only on real workflow runs — no test-induced noise.
- A trivial telemetry helper (`src/telemetry/append.ts` + `src/telemetry/llmUsageLog.ts`, < 50 LOC combined) absorbs the emission. Failures are silent: telemetry never breaks a hot path.
- Without this hook, ADR-0030 (sink-allocation) cannot enforce the `llm-usage.jsonl` ownership rule. With it, the sink is populated automatically and ADR-0030's contract becomes self-verifying.
