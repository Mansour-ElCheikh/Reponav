# ADR-0013: Write-Time Governance Enforcement via PreToolUse Hooks

**Status:** Accepted
**Date:** 2026-03-18
**Supersedes:** None

## Context

The governance engine (coreRules.ts) and pre-commit hook only enforce rules at commit time or on-demand. Rules in CLAUDE.md and `.claude/rules/` are purely instructional — the AI agent can silently ignore them. This was demonstrated when Claude violated the TDD rule twice in one session, writing production code without tests. The pre-commit hook is advisory (always exits 0), so even at commit time violations don't block.

Write-time enforcement catches drift at the moment code is written, not after. Claude Code supports PreToolUse hooks that fire before Write/Edit tool calls and can block the action.

## Decision

Add a three-tier enforcement model:

- **Tier 1 (write-time):** A single Node dispatcher (`.reponav/hooks/governance-gate.mjs`) runs as a Claude Code PreToolUse hook on Write/Edit. It loads `governance.yaml`, filters rules with `enforcement: [hook]`, and blocks (exit 2) or warns (exit 0 + JSON) on violations.
- **Tier 2 (commit-time):** Existing pre-commit hook remains as safety net for cross-file rules (test alignment, stale references).
- **Tier 3 (on-demand):** Existing `npm run governance:audit` for full repo validation.

Each rule in `governance.yaml` declares its enforcement tiers via a new `enforcement` field. Rules without this field default to `[engine]`. A new `check` field maps each rule to a checker function in the dispatcher.

New rules added: R5 (TDD test-first), R7 (JSDoc on exports), R8 (ADR format), R9 (ADR immutability), R13 (prompt size cap).

## Consequences

- **Positive:** Silent drift is caught at write-time for 8 of 11 rules. The TDD test-first gate (R5) specifically prevents the failure mode that prompted this decision.
- **Positive:** Enforcement coverage is visible — every rule declares its tier, making gaps explicit rather than hidden.
- **Negative:** The dispatcher adds ~100-150ms latency per Write/Edit action (Node startup + YAML parse).
- **Negative:** R5 (TDD) only enforces the first step (test file must exist). It cannot enforce the full red-green-refactor cycle.
- **Trade-off:** The dispatcher fails open — if it errors, the write proceeds. This prevents the governance system from blocking all work if misconfigured.
