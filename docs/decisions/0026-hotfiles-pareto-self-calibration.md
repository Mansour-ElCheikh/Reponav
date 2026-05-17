# ADR-0026: hotFiles Pareto Self-Calibration

**Status:** Accepted
**Date:** 2026-04-27
**Supersedes:** None

## Context

`metricsCollector.ts` computed `hotFiles` by sorting all files by `fanIn + fanOut` score and returning the top 20 (hardcoded `MAX_HOT_FILES = 20`). This fixed-count approach broke at both ends: small repos with concentrated coupling always returned 20 files even when a handful carry all traffic; large repos capped at 20 even when many more files merit attention. The `hotFilesCoverage` metric compounded this — it divided cumulative hotFile fanIn by `edges.length` instead of total fanIn, producing values > 1 on repos with high fanIn but few distinct edges.

## Decision

Replace the fixed cap with a Pareto-based self-calibrating algorithm in `metricsCollector.ts`:

1. Sort by fanIn primary (tie-break: fanOut, then lines) — fanIn is the meaningful signal; a file that 30 others import is riskier than one that imports 30 others.
2. Accumulate fanIn; stop when cumulative coverage reaches `HOT_FILES_COVERAGE_TARGET = 0.8` (80% of total fanIn) OR `MAX_HOT_FILES = 100` is reached.
3. Never return fewer than `MIN_HOT_FILES = 5`.

Fix `hotFilesCoverage` denominator: divide by total fanIn across all `fileMetrics`, not `edges.length`.

## Consequences

`hotFiles` adjusts to repo shape: focused repos return fewer files (coverage saturates early), diffuse repos can expand up to 100. The 80% coverage figure in analysis summaries is now meaningful and self-consistent. R17 seam detection and `plan-next` structural recommendations inherit this improvement — ranked candidates reflect actual import-traffic distribution rather than an arbitrary top-N.
