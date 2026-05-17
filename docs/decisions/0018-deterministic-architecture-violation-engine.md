# ADR-0018: Deterministic Architecture Violation Engine via Tarjan SCC + Declared Layer DAG

**Status:** Accepted
**Date:** 2026-04-05
**Supersedes:** None
**Related:** ADR-0014 (symbol-level analysis strategy), ADR-0002 (analysis-first positioning)

## Context

RepoNav's v1.x–v2.0 analysis pipeline produces a connectivity graph (file import edges, symbol call edges) and forwards it to an LLM for narration. The LLM was also expected to infer architectural findings — layer violations, boundary transgressions, dead-code candidates — from the raw source and graph.

This created three problems:

1. **Reproducibility**: two runs over the same codebase produced different findings because the LLM narrated them, not computed them. Architectural findings should be deterministic — given fixed code, the violation set is fixed.
2. **Hallucination scope**: the LLM could report a "service layer violation" that didn't exist structurally, because it was pattern-matching from training data rather than executing a graph algorithm.
3. **Underbuilt substrate**: the analysis engine already possessed the data needed to compute violations (import edges, file classifications, symbol edges) but stopped at extraction. The gap between "graph extraction" and "architecture awareness" was filled by the AI when it should have been closed by the engine.

A deeper analysis (2026-04-04/05) established that every mainstream "architecture awareness" claim decomposes into a known graph theory algorithm: layer violation detection is a DAG edge-direction check, blast radius is BFS, dead code is a degree-centrality predicate, hotspot detection is degree centrality. None require probabilistic inference.

## Decision

Architecture violation detection is implemented as a two-component deterministic system:

**Component 1 — Empirical Layer Discovery (Tarjan SCC)**
Run Tarjan's Strongly Connected Components algorithm on the import graph. Compute the condensation DAG: collapse each SCC into a single node, preserve inter-SCC directed edges. This produces the *empirical* partial order of the codebase — what layer structure actually exists, derived from code, not declared by a human. Circular imports within the same SCC surface as coupling findings; the condensation remains a proper DAG.

**Component 2 — Declared Layer Ordering**
Define an allowed dependency direction per `FileCategory`: `entry → route → controller → service → model → persistence`. This is a human declaration of architectural intent. It is short (~10 entries), stable, and explicit.

**Violation Detection**
For every edge in the import graph and symbol call graph, map source and target to their dominant `FileCategory` (from `FileClassification`). Check whether the edge direction is allowed by the declared layer ordering. Any edge that goes opposite (backward) or skips multiple layers (skip-layer) is emitted as a `LayerViolation`. The check runs on the condensation DAG, so intra-SCC cycles do not generate false violations.

**The AI's role is unchanged in kind but narrowed in scope**: the LLM narrates findings it did not derive. Tour steps reference `layerViolations[]` from the analysis report as facts; the AI explains *why* each violation matters and suggests fixes. It does not generate the violation set.

This composition rule applies generally: **if a finding has a definite true/false answer derivable from code structure, it belongs in the deterministic engine. The LLM's irreducible domain is: naming-intent inference, novel pattern recognition, and natural language narration.**

## Consequences

**Positive:**
- Violation findings are reproducible: same code → same violation set, every run
- AI narration quality improves because it receives verified facts instead of having to invent them from raw source
- Dead code detection, blast radius, and flow anomaly detection all benefit from the same Tier C substrate — they are cheaper to build once the layer DAG exists
- Enables `reponav check --max-violations N` CI gate with deterministic exit codes (v5.6)
- Separates two previously conflated concerns: *what is wrong* (deterministic engine) vs *why it matters* (LLM narrator)

**Negative:**
- The declared layer ordering is a maintained artifact — it must be updated if a project uses a non-standard architecture (hexagonal, CQRS, event-sourced). A misconfigured ordering generates false violations.
- Tier C requires Tier 1 data (import edges) and Tier 2 data (symbol edges + file classifications) to be complete. It cannot fire until both prior tiers have run.
- Repos with no meaningful layering (scripts, monorepos with irregular structure) will produce noisy violation counts — the engine needs a confidence threshold or a user-configurable opt-out.

**Neutral:**
- The Tarjan SCC algorithm is $O(V+E)$ — runtime is negligible relative to tree-sitter parsing. No performance budget impact.
- Existing `FileCategory` taxonomy (entry/route/controller/service/model/config/utility) remains unchanged. No schema migration required.
- The LLM prompt gains a `## Layer Violations` section in `formatReportForAI()` — same pattern as the existing `## Symbol Hotspots` section added in v1.3.
