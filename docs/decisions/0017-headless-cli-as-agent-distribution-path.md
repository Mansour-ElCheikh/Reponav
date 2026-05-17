# ADR-0017: Headless CLI as Agent Distribution Path (Supersedes ADR-0015 Defer Stance)

**Status:** Accepted
**Date:** 2026-04-03
**Supersedes:** ADR-0015 (defer MCP server distribution)
**Related:** ADR-0001 (MCP-first distribution), ADR-0013 (write-time enforcement), ADR-0014 (symbol-level analysis strategy)

## Context

ADR-0015 deferred MCP server distribution indefinitely and declared extension-native delivery as the active default. The reasoning was sound at the time: no MCP runtime existed, analysis enrichment features (hybrid retrieval, dead code, coupling) delivered more immediate user value than a transport layer.

However, the "defer MCP" stance had an unexamined gap: coding agents (Claude Code, Cursor, GitHub Copilot) operate exclusively on text — they have grep and file reads, but no AST, no dependency graph, no boundary violation detector. RepoNav's analyzer is already pure TypeScript with no VS Code boundary dependency (`WorkspaceAdapter` interface enforces the seam). The prerequisite for non-IDE consumption is already satisfied. The missing piece is not MCP protocol — it is a CLI entry point that routes existing analyzer output to stdout.

A headless CLI is categorically different from a standalone MCP server: it requires no transport protocol, no schema lock-in, no process orchestration, and no new runtime dependencies. It is thin plumbing over an analysis layer that already exists.

## Decision

Build a headless CLI (`reponav analyze`) as the agent distribution path, in three stages:

1. **v5.1 — Headless Analyzer**: `reponav analyze --repo <path> --format json` routes existing Tier 0/1 analysis to stdout. No new analysis logic — pure output redirection.
2. **v5.2 — Agent Query API**: Sub-commands (`symbols`, `imports`, `dependents`, `check-boundary`, `seams`) designed for agent tool calls and `jq` pipelines. Exit 0 = clean, exit 1 = violations.
3. **v5.3 — MCP Wrapper**: Thin adapter over v5.2. Each sub-command becomes an MCP tool. Revisits ADR-0001 and ADR-0015 with a stable, tested API underneath.

ADR-0015's "defer MCP" stance is superseded not by resuming MCP directly, but by building the right foundation (CLI) first. MCP becomes mechanical once v5.2 is stable.

Sequencing constraint: v5 work begins after v2.0 (hybrid retrieval). The query API is most useful to agents when it can answer coupling, dead-code, and flow queries — not just imports. v5.1 can ship before v2.0 as a standalone milestone; v5.2 gates on v2.x query infrastructure.

## Consequences

- The narrow "defer MCP indefinitely" stance in ADR-0015 is replaced with "CLI first, MCP as a wrapper after CLI is stable."
- `planNextStep.ts` is transitional scaffolding — it will be superseded by `reponav analyze --compact` when v5.1 ships.
- The existing `WorkspaceAdapter` boundary isolation (ADR-0013) is the direct prerequisite that makes this feasible without a rewrite.
- v5 does not change the extension-first delivery priority; the analysis enrichment roadmap (v2.x, v3.x) proceeds in parallel and feeds the CLI's query richness.
- Non-IDE agent consumers (Claude Code, Cursor, CI pipelines) get ground-truth AST analysis instead of grep approximations once v5.1 ships.
