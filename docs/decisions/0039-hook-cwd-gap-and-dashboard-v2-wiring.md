# ADR-0039: Hook-CWD gap + dashboard v2 wiring

**Status:** Accepted
**Date:** 2026-05-01
**Supersedes:** None (extends ADR-0038)

## Context

Two findings from a 2026-04-30 self-audit converged into one ADR:

### Finding 1: governance hooks were silently bypassed across an entire session

While building Phase A/D (skill-anatomy, R26, ADRs 0036/0037, dashboard v1), the PreToolUse `run-governance-gate.sh` and the Stop `run-touched.sh` never fired. Confirmed by direct inspection of `.reponav/hook.log`:

- Last `INVOKE` line: `2026-04-26T20:45:52Z` — five days before the audit period.
- All Phase A/D writes (telemetry probes, governance.yaml R26 add, 17 skill appends, dashboard generator) produced **zero** new `INVOKE` lines.
- Test fixtures from the parallel `eval__harness` work in the same calendar window DID produce `BLOCKED` lines, proving the hook script itself is correct.

Root cause: Claude Code session CWD was `/Users/mansourelcheikh/Reponav-Migration/worktrees/RepoNav-clean/` — a worktree-parent holder dir, **not a git repo**, and lacking both `.reponav/governance.yaml` and a `.claude/settings.json` with PreToolUse + Stop hooks. The actual code dir `/Users/mansourelcheikh/Reponav-Migration/RepoNav-clean/` had the hooks configured, but Claude Code loads `.claude/settings.json` from CWD, not from any ancestor.

Result: an entire round of harness-affecting changes landed without governance enforcement. R5 (TDD test_first), R13 (file size cap), R26 (skill size cap) all silently inactive. The session leaned on the existing test suite as a regression net but never had pre-write enforcement.

### Finding 2: dashboard v1 had real abstraction gaps

User feedback on v1 dashboard:

- Layer cards displayed state, not flow. No way to see how layers wire together.
- No factory health surface. Sanity-11 reports a factory `health=RED` signal that v1 ignored — yet factory health is the meta-signal. If the closed loop is broken, individual layer cards being green is misleading.
- No wiring check. Rules with file_patterns matching zero files (dead probes) looked identical to rules with patterns matching files that simply hadn't been violated.
- No dormancy detection. Skills, sinks, and rules silently dormant looked identical to actively-quiet ones.
- No per-session aggregation. Probes emit per-call; no view of "what does a typical agent run cost?"
- No provider breakdown. ADR-0028 emission collected the data; nothing rendered it.
- No auto-load context cost. CLAUDE.md + .claude/rules/* + .claude/agents/* have a per-session load cost that's invisible.
- No open counter. Kill criterion in ADR-0038 ("opened <1×/day for 14d → delete") had no data source.

## Decision

### Part 1: Fix the CWD gap

Add `/Users/mansourelcheikh/Reponav-Migration/worktrees/RepoNav-clean/.claude/settings.json` mirroring the code dir's hook config, with absolute paths to the canonical hook scripts in the code dir. This makes governance fire from any session started in either dir.

Add `scripts/sanity/12-hook-wired.sh` to the sanity grid. It pipes a synthetic Write probe through the hook and asserts:
1. `hook.log` line count increments.
2. The new line includes the `OUTCOME` marker (probe #4 contract from Phase 1).

Sanity-12 is added to `run-fast.sh` and to the layer routing in `run-touched.sh` (any change to `.claude/settings.json`, `.reponav/hooks/*`, or `scripts/sanity/12-*` triggers it).

### Part 2: Dashboard v2 — TDD-first refactor + new sections

Pure compute logic moves to `src/proctor/dashboardCompute.ts` (TS) with `src/proctor/dashboardCompute.test.ts` covering 19 cases. Renderer at `scripts/proctor/dashboard.ts` runs via `vite-node` and imports compute. The previous `dashboard.mjs` is deleted.

New v2 sections:

| Section | Source | Renders |
|---|---|---|
| Factory health banner | `.reponav/reports/ci-profile-report.json` `profileResults` | Top-of-page color-coded banner. RED = "layer cards below may be misleading." |
| Topology DAG | layer card statuses | Inline SVG, 10 nodes + arrows, color-by-status. Replaces "abstract feeling" with flow shape. |
| Auto-load context cost | filesystem stat over `CLAUDE.md`, `.claude/rules/*`, `.claude/agents/*` | Total bytes + estimated tokens per session. Top 12 contributors table. |
| Per-session tokens | `llm-usage.jsonl` grouped by `sessionId` (new field) | Top 10 sessions by token total. |
| MCP latency p95 by tool | `mcp-usage.jsonl.duration_ms` grouped by tool | Sortable table. |
| Provider routing distribution | `llm-usage.jsonl.chosen` counts | Sorted table. ADR-0028 emission becomes useful, not just collected. |
| Wiring check | governance.yaml file_patterns vs repo file list | List of rules whose patterns match 0 files (dead probes). |
| Dormancy panel | `proctor/latest-summary.json` skill invocation count | Skills with 0 invocations in the latest snapshot. |
| Open counter | `.reponav/dashboard-opens.jsonl` (new sink) | Last-7-day count in footer. Drives ADR-0038 kill criterion. |

`sessionId` field added to `src/telemetry/llmUsageLog.ts`. One ID per Node process — sufficient for grouping; not a security identifier.

### Part 3: Auto-refresh wiring

`scripts/sanity/run-touched.sh` (the Stop hook entry) tail-checks dashboard freshness: if any tracked sink mtime is newer than `dashboard.html` mtime, regenerate via `dashboard.sh hook`. Browser does not open on the `hook` trigger.

`/dashboard` slash command at `.claude/commands/dashboard.md` for explicit refresh. Increments the counter on every invocation regardless of trigger.

The counter is the single source of truth for ADR-0038's kill criterion. The criterion is restated here for clarity: **fewer than 7 opens over the last 14 days → delete the dashboard generator + html + slash command**.

## Consequences

- A regression as severe as "an entire workstream bypassed governance" is now structurally caught — sanity-12 fails fast on the next CWD drift, and `run-touched.sh` fires the Stop hook to surface the failure.
- The TDD-first refactor produces a small unit-test surface (`dashboardCompute.test.ts`, 19 tests) that can absorb future probe additions without rewriting the renderer. The renderer stays untested by design — its output is HTML, brittle to assert.
- v2 dashboard surfaces the factory meta-signal explicitly. A green dashboard with a red factory now reads correctly: "downstream layers green, but closed loop broken."
- Topology DAG replaces v1's flat card layout. State + flow visible together.
- Wiring panel + dormancy panel close the silent-quiet vs unwired ambiguity. A rule pointing at zero files used to look the same as a rule with no violations; now they're labeled differently.
- The auto-load cost panel directly answers the cognitive-load + token-budget concern raised in the architecture review. SLO added: auto-load tokens per session < 25 000.
- Per-session tokens, MCP latency p95, and provider distribution are derivable today from existing sinks; the dashboard makes them visible for the first time.
- Open counter is now a real signal. The kill criterion can be enforced after the 14-day trial closes, not deferred for lack of data.
- Risks accepted: the auto-refresh on Stop hook adds ~100-300ms to end-of-turn latency when sinks moved. Mitigated by the mtime check (no-op when sinks are stable).
- Risks not yet addressed: dashboard does not store time-series snapshots. Trend analysis (e.g., "p95 over the last 14 days") requires either a daily snapshot cron or an external timeseries DB. Per Lean Launch posture, deferred until usage data justifies the cost.
