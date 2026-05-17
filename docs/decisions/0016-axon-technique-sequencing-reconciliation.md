# ADR-0016: Axon Technique Sequencing Reconciliation

**Status:** Accepted
**Date:** 2026-04-01
**Supersedes:** ADR-0009
**Related:** ADR-0014, ADR-0015

## Context

ADR-0009 correctly selected Axon-inspired analysis techniques for native TypeScript adoption, but its milestone timing no longer matches shipped reality. v1 delivered symbol extraction, directory grouping, and Sigma rendering, while community detection and impact analysis were not shipped in v1.4/v1.5. In parallel, ADR-0015 deferred standalone MCP distribution and established an extension-first execution path.

Without a sequencing reconciliation ADR, architecture records conflict with roadmap status and can mislead implementation ordering.

## Decision

Keep ADR-0009 capability scope, but supersede its milestone sequencing with this canonical order:
- Completed in v1: symbol-level foundation, prompt enrichment, directory grouping, Sigma renderer, interaction polish
- v2 (extension-first): hybrid retrieval, dead code detection, change coupling, process/flow detection, stale-while-revalidate
- v3+: advanced visualization overlays (edge types, symbol UI mode, DSM, git-aware overlays)
- v4+: higher-order intelligence workflows (risk/test impact and explanation layers) implemented as extension commands/services, not MCP tools

All externalization remains optional and protocol-agnostic (library/CLI path), with no standalone MCP runtime milestone commitment.

## Consequences

- Architecture documentation is now consistent with shipped work and active roadmap sequencing.
- Teams should treat ADR-0016 + ADR-0015 as the authoritative planning pair for post-v1 execution.
- ADR-0009 remains valuable for technique scope, but its original dated milestone mapping is no longer normative.
