# ADR-0029: Split governance-gate.mjs to honor the R13 24KB file cap

**Status:** Accepted
**Date:** 2026-04-29
**Supersedes:** None

## Context

The PreToolUse hook entry point `.reponav/hooks/governance-gate.mjs` had grown to 25,113 bytes — over the 24,576-byte cap defined by governance rule R13 (`prompt_size_cap`). The hook was therefore self-violating: any edit to it would trigger its own block. The growth came from the embedded RepoNav-MCP-gate sub-system (overview/impact freshness gates, mcp-gate state IO, mcp-gate event log) which had accreted as a self-contained module inside the dispatcher file.

Sanity-check audit (2026-04-29) flagged the cap breach as a Phase 2 unblock for further hook hardening (probe #4 OUTCOME line, future cache-correlated telemetry).

## Decision

Extract the RepoNav-MCP-gate sub-system into a stand-alone CommonJS module at `scripts/governance-mcp-gate.cjs`, mirroring the pattern already used for `scripts/governance-checks.cjs` and `scripts/governance-hook-core.cjs`. The module is hand-authored CJS (not bundled) since it depends only on Node built-ins; a build step would be unnecessary ceremony.

The module exports a single entry point: `enforceRepoNavGate(toolName, toolInput, cwd, hookLog)` which returns `true` when the gate handled the tool and the caller should `process.exit(0)`, or `false` to defer to the regular write-time enforcement flow. `hookLog` is injected as a callback so the gate module does not need its own log abstraction.

`governance-gate.mjs` requires the new module via `createRequire(import.meta.url)` and falls back to a no-op stub if the file is missing, matching the resilience pattern used for the other two scripts.

## Consequences

- `governance-gate.mjs` shrinks from 25,113 → ~12,500 bytes, well under the R13 cap with margin for future probes.
- The MCP-gate logic gains a clean ownership boundary; future edits to gate semantics no longer risk pushing the dispatcher over the cap.
- One new dependency surface (a `require()` call) is introduced. Mitigated by the same try/catch fallback used for `governance-checks.cjs` and `governance-hook-core.cjs`.
- Telemetry sinks (`mcp-gate-state.json`, `mcp-gate-events.jsonl`) are unchanged. Existing cached state continues to apply.
- A small duplication exists: the gate module accepts `hookLog` as a callback; the dispatcher still defines `hookLog` locally. Acceptable given the alternative (a third shared utility module) adds more surface than it saves. Future ADR may consolidate hook-side utilities once a second consumer appears.
