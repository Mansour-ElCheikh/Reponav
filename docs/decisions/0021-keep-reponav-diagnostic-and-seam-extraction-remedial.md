# ADR-0021: Keep RepoNav Diagnostic and Seam Extraction Remedial

**Status:** Accepted
**Date:** 2026-04-21
**Supersedes:** None

## Context

R17 now flags seam candidates with cheap local heuristics, while RepoNav can also compute richer structural signals such as blast radius, coupling, and layer violations. Without an explicit boundary, it is easy to drift toward wiring governance to live RepoNav runtime data or treating RepoNav analysis as the replacement for the seam-extraction workflow itself.

That would mix two different layers of the system. Governance needs to stay deterministic, local, fast, and CI-safe. RepoNav analysis is richer, but it is a diagnostic substrate whose availability, cost, and execution model are different from a self-contained rule engine.

## Decision

Keep the layers separate. R17 remains a cheap, local, deterministic, self-contained governance heuristic. RepoNav is used only after a candidate is flagged, or otherwise suspected, to rank the candidate, confirm the smell, and choose the extraction seam.

Seam extraction remains the remediation workflow. The fix path stays test-first, narrow in scope, and validated with focused checks. Governance must not depend on RepoNav MCP/runtime availability to emit R17 findings.

## Consequences

Governance stays fast, reproducible, and runnable in CI without external runtime dependencies. RepoNav still adds value, but as the richer advisor that improves prioritization and seam selection rather than as a hidden dependency of the rule engine.

This preserves a clean abstraction boundary: RepoNav diagnoses architectural risk, while seam extraction executes the fix safely. The trade-off is that some high-value smells remain outside mechanical governance and still require explicit RepoNav follow-up when ranking refactor work.
