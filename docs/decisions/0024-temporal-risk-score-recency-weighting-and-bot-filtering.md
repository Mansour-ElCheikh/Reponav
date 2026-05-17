# ADR-0024: Temporal Risk Score Recency Weighting and Bot Commit Filtering

**Status:** Accepted
**Date:** 2026-04-27
**Supersedes:** None

## Context

The Tier 6 temporal analyzer computed `riskScore = complexityScore = (lines/100) × commits`. This formula treated a file churned heavily 3 years ago as equally risky as one churned last week, and counted bot commits (Dependabot, GitHub Actions) as real churn, inflating scores for actively-maintained repos.

## Decision

Two targeted changes to `TemporalAnalyzer`:

1. **Bot filtering**: COMMIT lines whose author email matches `[bot]`, `noreply@github.com`, `github-actions@`, or `dependabot` are skipped entirely — their associated file paths are not counted toward churn or authorship.

2. **Recency multiplier**: `riskScore` is now `round(complexityScore × recencyMultiplier(lastChangedUnix))` where the multiplier is `1.5` (< 30 days), `1.2` (30–90 days), `1.0` (90–180 days), or `0.8` (> 180 days). `complexityScore` is preserved unchanged as a separate field.

The `FileChurn` type already carried both `complexityScore` and `riskScore` as distinct fields, so no schema change was required.

## Consequences

Recently-active hotspots rank higher in Tier 6 output — better signal for "what should I refactor now". Stale churn depresses score naturally. Bot-inflated churn no longer skews ownership maps. Existing test assertions on exact `riskScore` values were replaced with domain-invariant checks (`> 0`, relative ordering). Two new tests cover bot filtering and recency ordering.
