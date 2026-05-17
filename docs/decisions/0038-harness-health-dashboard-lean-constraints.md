# ADR-0038: Harness health dashboard — lean constraints + kill criteria

**Status:** Accepted
**Date:** 2026-04-30
**Supersedes:** None

## Context

The harness audit (2026-04-29) added 10 abstraction layers, 7 telemetry sinks (per ADR-0030), 26 governance rules (R1–R26 after ADR-0036), and a tiered sanity grid. Cognitive load to hold "what is healthy at which layer right now" is high in a fast-moving development loop. Reading individual log files to answer that question takes ~5–15 minutes per check.

A live dashboard reduces the answer time to ~5 seconds. But dashboards have a long history of becoming scaffolding themselves: built once, maintained forever, opened by no one. The architecture review flagged five specific risks the dashboard must mitigate by construction, not by hope.

## Decision

Ship a single-file static HTML dashboard with explicit lean constraints baked in.

### Hard constraints (build will be rejected if violated)

1. **No backend.** No server. No auto-refresh. No websocket. No fetch. The HTML is a static artifact with data inlined as the dashboard generator's output.
2. **No chart libraries.** Vanilla CSS + small inline JS for tooltips only. SVG inline if a chart is needed; usually a colored cell suffices.
3. **Single-file generator.** One `scripts/proctor/dashboard.mjs` reads sinks, emits one HTML file. Re-run to refresh. No watch loops.
4. **Reads only existing sinks per ADR-0030.** No new telemetry collected here. Schema change in any sink is intentionally a visible failure of the dashboard, not a silent gap.
5. **Surfaces invariants, not raw numbers alone.** Every layer card states the SLO/invariant in plain text, then the current value, then traffic-light status. A green dashboard means "invariants hold," not "metrics exist."

### Scope (what the dashboard shows)

- 10 layer cards on one screen (per ADR-0036's layer map). Each card: invariant statement, current key metric, traffic-light status (green/amber/red/gray), last-event timestamp.
- SLO snapshot table — 6 metrics with target + current value + pass/fail.
- Governance rule heatmap — 23 cells (R1–R26, sparse), colored by recent fire count.
- Pillar 1 A-vs-B sweep panel — best-effort read of `scripts/evals/aggregate.out` if present. Renders as plain text. Updates manually after each sweep run.

### Scope (what the dashboard does NOT show)

- No time-series charts. Sinks are append-only logs, not a metrics database.
- No alerting. Sanity grid + Stop hook already alert on regressions; the dashboard is for ad-hoc inspection.
- No interactivity beyond static tooltips. No clicks, filters, or dropdowns.
- No editing. No "click to fix." Editing tools stay separate (vitest, governance audit, sanity scripts).
- No login, no multi-user, no remote view. Local file only.

### Risk mitigations baked into the build

| Risk (from architecture review) | Mitigation |
|---|---|
| Becomes scaffolding | Kill criterion below + ADR records the cap. |
| Replaces thinking with watching | Each card states the invariant, not just the metric. Green = invariant holds. |
| Becomes v1 product | One day cap. No libraries. ADR locks the scope. |
| Drift unhealthy fast | Reuses existing sinks; schema break = dashboard breaks loudly. |
| Cognitive overload | One screen, no nav, no tabs. Re-run = full refresh. |

### Kill criteria (enforced)

- If the dashboard is opened **less than once per day on average over 14 days**, delete `scripts/proctor/dashboard.{mjs,sh,html}` and supersede this ADR.
- If the schema of any consumed sink changes such that the generator throws, fix the generator the same day or delete it. No half-working dashboard.
- If the cognitive-load reduction it provides is replaced by a single sanity-grid line of output, prefer the line.

Open count is tracked manually for the first 14 days. After the trial, either: (a) the dashboard has earned its place and stays, or (b) it is removed and the harness goes back to relying on `/sanity:fast` + sink-reading.

## Consequences

- One day of work for the build. Zero ongoing maintenance cost if no sinks change.
- New telemetry probes that introduce new sinks must extend the dashboard or accept that the new layer goes unrendered (gray status). Either is acceptable; silent failure is not.
- The dashboard is visible evidence of which layers are observable today. Layers that show "gray" because their probe isn't wired surface that gap to anyone who opens the page. This is a side benefit: the dashboard quietly records its own coverage gaps.
- A future ADR may extend the dashboard with a TUI variant (`scripts/proctor/dashboard.sh --tui`) if browser-launching becomes friction. Out of scope for v1.
- If the dashboard meets its kill criteria and is removed, we have evidence that direct sink-reading was sufficient for our cognitive needs at this scale. That itself is a useful finding.
