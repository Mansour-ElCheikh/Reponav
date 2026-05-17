# ADR-0040: Agent steering contract — invariants and composite policy

**Status:** Accepted
**Date:** 2026-05-04
**Supersedes:** None

## Context

RepoNav's agent-facing summary output (`format=summary` from CLI and MCP) had grown organically as a flat payload of mixed-purpose fields. Agents consuming the output had no way to distinguish architectural facts from change-risk signals from analysis-completeness metadata, no way to know how trustworthy a given value was (whether it came from a full-workspace analysis or a sampled view), and no enforced contract preventing future signal additions from drifting.

The agent-steering signal contract slice (commits `cb63207`, `d00db7c`, `5e103f5` on 2026-05-04) was scoped to fix this. During implementation, real-data eval captures surfaced three quality defects that synthetic unit fixtures had hidden: ownership concentration on quiet repos was 100% sparse-history noise, instability rankings tied at 1.0 and resolved alphabetically, and dangerous-hotspots had no significance floor. These defects were defects of the data shape, not of the contract layer — but they motivated the truth-first principle that now governs every signal addition.

A separate forcing function: `dangerous-hotspots` was originally implemented as a composite (`recencyWeightedChurn × fanIn`) with a `weights` field carrying `{ recencyWeightedChurn: 1, fanIn: 1 }`. Multiplying by 1 was a no-op; the field was vestigial. More importantly, the existence of any composite signal opens a metastasis risk where future contributors stack additional composites without examining the cost of blended scores. Sentrux's failure mode (coarse scorecarding without hard steering) is exactly what unbounded composites produce.

## Decision

The agent steering contract carries the following invariants, enforced by code and tests in `src/types.ts`, `src/commands/summarySignals.ts`, and `validateSummarySignalContract`.

**Signal envelope.** Every surfaced signal in the summary contract is a `SummarySignal<T>` with the shape:

```ts
{ id: string; label: string; family: SignalFamily; kind: SignalKind;
  basis: SignalBasis; sampled: boolean; cappedAt?: number; data: T; }
```

**Three families only.** `SignalFamily = 'architecture' | 'risk' | 'confidence'`. Architecture is structural shape independent of recent edits. Risk is why touching something now is dangerous. Confidence is how trustworthy the picture is. New families require explicit type extension and a consumer audit; mixing semantics across families is a contract break.

**Three kinds only.** `SignalKind = 'fact' | 'derived' | 'gate-hint'`. Facts come straight from analyzer output. Derived signals are computed from analyzer output (instability, propagation reach, ownership concentration, dangerous hotspots). Gate-hints are recovery prompts emitted by the MCP gate.

**Truth-first basis.** `SignalBasis = AnalysisScope | 'unknown'`. When `report.completeness` is absent, basis is `'unknown'`, never a default scope value. No signal pretends more certainty than the underlying analysis basis allows.

**Composite signals are forbidden by default.** `dangerous-hotspots` is the sole permitted composite, with the formula pinned at definition time (`score = recencyWeightedChurn * fanIn`). Any new composite signal requires a new ADR or plan amendment. Weights, when used, must be non-trivial — a no-op weight field (e.g. `{ x: 1, y: 1 }`) is removed rather than left as API surface.

**Category-driven filter, single source of truth.** Architecture and risk family rankings exclude files in non-steering categories (`test`, `e2e`, `fixture`, `example`, `archive`, `entry`). The category map is built from `report.fileClassifications` (produced by `src/analyzers/fileClassifier.ts`); the `FileCategory` enum in `shared/types.ts` is the only place categories are defined. Inline regex for category checks is forbidden — extend the enum and add a classifier rule instead.

**Quality gates that must hold on real data.** Instability returns `null` for zero-coupling files and excludes `fanIn === 0` leaves from rankings. Ownership concentration drops sparse-history rows (`totalCommits < 4`). Dangerous hotspots have a significance floor: `value > 0 && (commitCount > 1 || fanIn > 1)`.

**Eval coverage is real-data, not synthetic.** Every signal addition must be exercised by `scripts/evals/agentSteeringEval.test.ts` against real-repo fixtures in `eval__harness/` (currently express-upstream tier 6 plus RepoNav-on-RepoNav tier 6). Synthetic baselines are forbidden as eval gates because they structurally guarantee positive deltas.

## Consequences

**Constraints accepted:**

- New signals must declare family + kind + basis at definition time. The validator throws on unlabeled or duplicate-id signals at build time, so drift is caught before merge.
- New families require type extension and a consumer audit. The slice scope expanded in this direction once and may again — the type cost is acceptable for the contract integrity.
- Composite signals require an explicit decision (ADR or plan amendment). This adds friction for legitimate composites but prevents Sentrux-style scorecarding.
- Category-based filters cannot be added inline. Adding a new exclusion category requires extending `FileCategory` enum + adding a classifier rule. This is one extra change set per new category, but it prevents the regex/classifier drift hazard that this slice already encountered once.
- Eval coverage is more expensive than synthetic fixtures. Real-data captures must be regenerated when the analyzer output shape changes. The slice ships with a regeneration helper command (vite-node bin/reponav.ts -- analyze).

**Capabilities gained:**

- Agents consuming `format=summary` can trust the surface: every value declares its provenance and trustworthiness.
- The contract is enforced by tests, not convention. A future contributor cannot land an unlabeled or dual-classified signal without the build failing.
- Real-data eval coverage means future regressions in signal quality (e.g. another sparse-history defect) will be caught before merge, not in the field.
- The composite ban gives a stable Schelling point for resisting requests to "just multiply two existing signals" — the answer is "open an ADR or plan amendment first."

**What this does not promise:**

- This contract does not measure agent behavioral lift. L6 (gate-copy upgrade A/B) and L8/T6 (priming with non-leaky prompt) in the existing eval harness measure that axis. The contract guarantees information surface is complete and labeled; whether agents convert that into better task completion is downstream.
- Truth-first basis defaulting to `'unknown'` is conservative. Some consumers may need to handle the `'unknown'` variant explicitly. This is intentional — the cost is one extra case per consumer, the benefit is no overclaim.

**Future work this enables:**

- Extending `FileCategory` to model additional non-production paths (e.g. `'docs'`) is a one-rule addition.
- Adding new derived signals (e.g. `cycle-membership` ranking) follows the same template — declare family + kind + basis, add a builder, add an eval corpus token.
- Wiring the contract output into a CLAUDE.md auto-include (per L8/T6's product implication, expected to deliver +83 to +92pp lift on hard architectural choices) is the next product complement.
