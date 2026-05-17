# ADR-0014: Symbol-Level Analysis Strategy

**Status:** Accepted
**Date:** 2026-03-25
**Supersedes:** None
**Related:** ADR-0009 (Axon technique adoption), ADR-0008 (zero external backend deps)

## Context

RepoNav's analysis is file-level: nodes are files, edges are imports. This limits tour quality ("file X imports file Y") and blocks downstream features like community detection, dead code analysis, and impact analysis — all of which need symbol-level granularity ("function createUser() calls validateEmail()").

The roadmap originally planned v1.3 as a big-bang: full symbol extraction, cross-file call tracing, heritage extraction, type references, VS Code DocumentSymbolProvider integration, DB schema migration, prompt enrichment, graph builder updates, and community detection prep — all before shipping.

After review, this was judged too risky. A leaner incremental path was chosen.

## Decision

### 1. Tree-sitter is the primary engine for symbol extraction

Tree-sitter produces **cross-file** symbol graphs: who calls what, what extends what, across the entire workspace. VS Code's DocumentSymbolProvider gives per-file outlines but has no batch API for cross-file call graphs or heritage chains. Tree-sitter is deterministic, testable outside VS Code, and already initialized in our pipeline.

VS Code symbols are an optional enrichment (richer type signatures, resolved generics) — not the primary source.

### 2. Lean incremental path over big-bang

**Original plan:**
- v1.3: Symbol extraction + DB schema + call tracing + heritage + VS Code enrichment + prompt changes + graph builder changes
- v1.4: Louvain community detection + Sigma.js migration (replace ReactFlow)

**Revised plan:**
- v1.3: Symbol extraction foundation (types, DB, extractor, Tier 2 analysis) → prompt enrichment only
- v1.4: Directory-based grouping + collapsible clusters in ReactFlow (80% of visual decluttering, zero renderer risk)
- v1.5: Evaluate Louvain + Sigma.js based on real usage data — only build if directory grouping proves insufficient

### 3. Directory grouping before algorithmic community detection

| Approach | Pros | Cons |
|---|---|---|
| Directory grouping | Instant, deterministic, zero dependencies, matches how developers think about code | Misses cross-directory relationships |
| Louvain (graphology) | Discovers true code communities from call patterns | Requires symbol graph, adds dependency, may produce surprising clusters |
| Leiden | Fixes Louvain's disconnected community issue | No JS implementation, would need custom port |
| Label propagation | Very fast | Non-deterministic, unstable across runs |

Directory grouping ships first. Louvain is evaluated only after symbol data exists and users have given feedback on whether directory grouping is sufficient.

### 4. Keep ReactFlow until proven insufficient

Sigma.js (WebGL, 10K+ nodes) is the better long-term renderer, but replacing ReactFlow is a full webview component rewrite — the highest-risk single change in the roadmap. ReactFlow with collapsible directory clusters handles the immediate need (visual decluttering on 50-200 node graphs). The Sigma.js migration is deferred until graph sizes consistently exceed ReactFlow's comfort zone or community hull rendering is needed.

### 5. Language scope unchanged

v1.3 adds depth (symbol-level) to existing languages (JS/TS/Python), not breadth. New languages (Go, Rust, Java) require adding tree-sitter WASM grammars and language-specific AST node mappings — deferred to v2+ or on demand.

## Consequences

**Positive:**
- Lower risk: each step is shippable and testable independently
- Faster time to value: directory grouping ships without waiting for community detection
- No new runtime dependencies until proven needed (graphology, sigma deferred)
- Existing behavior preserved at every step

**Negative:**
- Directory grouping is less sophisticated than algorithmic community detection
- Two potential renderer migrations if Sigma.js is eventually needed
- Symbol extraction without immediate visual payoff (v1.3 improves prompts but not the graph view)

**Neutral:**
- Tree-sitter remains the only parser for cross-file analysis regardless of path chosen
- DB schema migration (v2) is additive and backward-compatible
