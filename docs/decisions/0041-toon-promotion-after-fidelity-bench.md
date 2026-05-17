# ADR-0041: Promote TOON format after fidelity benchmark

**Status:** Accepted; implementation shipped 2026-04-30. MCP `analyze` default remains `summary` per §"What this ADR does *not* do"; TOON is the recommended next step (not the default). Re-affirmed during Wave 1 / S1.5a (2026-05-17) after a planned default-flip was reconciled against the ADR's own non-flip clause.
**Date:** 2026-04-30
**Supersedes:** None

## Context

TOON (Token-Oriented Object Notation) was implemented in `src/analyzers/reportFormatting.ts:417` and exposed via the MCP `analyze` tool (`src/mcp/mcpServer.ts:142`). It is also the default for tour generation (`src/ai/tourQuery.ts:57` — `REPONAV_TOUR_FORMAT || 'toon'`).

Telemetry from `.reponav/mcp-usage.jsonl` (632 calls captured) showed **zero** MCP callers passed `format=toon` despite it being available. Distribution: 54 summary, 52 json, 0 toon. The format was plumbed but dormant in production — classic shipped-but-unused tech.

Two open questions before any promotion:

1. **Size win** — does TOON actually save tokens vs markdown / json on real fixtures, not synthetic?
2. **Fidelity** — does it preserve the data points an agent needs to make architecturally-correct decisions?

A pre-registered decision rule was set:

- TOON ≥30% smaller AND zero fidelity loss → promote to default
- TOON ≥30% smaller AND ≤2% fidelity loss → keep optional, document tradeoff
- TOON <30% smaller OR >2% fidelity loss → demote, remove default

## Decision

Run a deterministic shell-eval benchmark — no agent, no LLM — that:

1. Invokes `bin/reponav.ts analyze --tier 1 --format <fmt>` on three fixtures (`../express`, `../fastapi`, RepoNav-self).
2. Captures byte size + approx-token count per format.
3. Spot-checks fidelity: parses key counts (modules, edges) from each non-JSON output and compares against JSON ground truth.
4. Emits results to `.reponav/format-bench.jsonl` (append-only).
5. Prints aggregate verdict.

Bench script lives at `scripts/bench/toon-vs-markdown.mjs`. Executed 2026-04-30.

### Results

| Fixture | json | markdown | toon | toon vs markdown | toon fidelity |
|---|---|---|---|---|---|
| express | 173,457 B | 10,470 B | 4,089 B | **−60.9%** | **100%** |
| fastapi | 1,235,352 B | 14,776 B | 5,781 B | **−60.9%** | **100%** |
| reponav-self | 594,644 B | 18,989 B | 5,941 B | **−68.7%** | **100%** |

Aggregate: TOON is **63.5%** smaller than markdown on average. Fidelity is **100%** across all fixtures on the spot-checked counts (modules, edges).

Decision rule resolves to **PROMOTE — ≥30% smaller, zero fidelity loss**.

### Promotion actions taken in this change

1. **MCP `analyze` tool description** (`src/mcp/mcpServer.ts:133-145`) — `toon` listed second in the description and recommended as "preferred for agent consumption" with the bench citation.
2. **`CLAUDE.md` MCP tool priority section** — added `toon` as the recommended next step beyond `summary` for architectural questions, with the bench citation and ADR pointer.
3. **Format-distribution probe** (`src/mcp/mcpServer.ts` `withLogging`) — every MCP call now records the requested `output_format` in `.reponav/mcp-usage.jsonl`, so future eval can confirm whether the promotion changed agent behavior.

### What this ADR does *not* do

- Does not change `format` default in MCP — `summary` remains default. TOON is the recommended **next step** when summary is insufficient.
- Does not run an agent-driven A/B (Pillar 1 / 2 style). The fidelity bench answers the structural question; the agent-correctness question is a separate, more expensive eval. If telemetry over the next two weeks shows TOON uptake AND a measurable shift in agent behavior, escalate to a Pillar slot then.
- Does not modify `tourQuery.ts` (already TOON-default since the original implementation).
- Does not deprecate any of `summary`, `compact`, `json`, or `markdown`. All four remain available; relative recommendations changed only in the description text.

## Consequences

- Agents reading the MCP tool description (and CLAUDE.md routing) now have an explicit, evidence-cited reason to prefer `toon` over `compact` or `json` when they need detail beyond `summary`. Prior to this ADR, `toon` was buried in the format enum without justification.
- `output_format` field in `mcp-usage.jsonl` lets the dashboard and SLO checks track real-world format distribution. Expected signal over two weeks: TOON share rises from 0% to non-zero. If it stays at 0%, agents are ignoring the promotion — investigate harness routing.
- The benchmark script becomes a re-runnable artifact. Adding new fixtures or new formats in future is a one-line change in `scripts/bench/toon-vs-markdown.mjs`. Score trends can be tracked over time the same way `scripts/skill-eval/score.mjs` tracks skill quality trends.
- Fidelity check is a **spot-check on counts**, not a full round-trip equivalence proof. Sufficient for the structural question but doesn't catch subtle field-loss bugs (e.g., a frameworks entry might be present in JSON but stripped in TOON without the spot-check noticing). Future improvement: write an actual TOON decoder + diff against source AnalysisReport. Out of scope for this ADR — current spot-check is enough to clear the pre-registered bar.
- The TOON format remains an internal convention. No external spec, no compatibility commitment. Future revisions can change the encoder without ADR if the format-bench score holds.
