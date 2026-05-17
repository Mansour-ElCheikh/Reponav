# ADR-0015: Defer MCP Server Distribution

**Status:** Superseded by ADR-0017
**Date:** 2026-04-01
**Supersedes:** ADR-0001, ADR-0004
**Related:** ADR-0002 (analysis-first positioning), ADR-0006 (schema contracts), ADR-0014 (symbol-level strategy)

## Context

RepoNav v1 shipped the core platform goals inside VS Code: `vscode.lm` zero-BYOK path, validation gates, symbol-level extraction, Sigma-based graph UX, and governance enforcement. The roadmap still carried a v2.0 standalone MCP server track, but no MCP runtime implementation exists in the codebase (no transport layer, no MCP tool handlers, no process boundary integration).

Building the MCP server next would add substantial delivery overhead before shipping user-facing analysis capabilities already planned (hybrid retrieval, dead code detection, coupling, and flow detection). Current product momentum and user value are concentrated in extension-native intelligence and visualization improvements.

## Decision

Defer standalone MCP server distribution indefinitely and remove it as the immediate v2 entry point. Prioritize the analysis enrichment roadmap directly in the VS Code extension:
- hybrid retrieval and context compression
- dead code detection
- change coupling analysis
- process/flow detection
- stale-while-revalidate caching

Keep schema contracts and pure analyzer boundaries reusable so MCP can be revisited later if demand is validated.

## Consequences

- v2 sequencing is simplified: analysis features proceed without an MCP prerequisite.
- ADR-0001 and ADR-0004 are superseded as near-term distribution strategy; extension-first delivery becomes the active default.
- Existing architecture investments remain valid: schema validation, pure TypeScript analyzers, and adapter boundaries still support future headless packaging.
- Non-IDE distribution (CI/agent-first MCP tooling) is postponed and is no longer a current milestone commitment.
