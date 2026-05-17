# ADR-0009: Native adoption of Axon analysis techniques

**Status:** Accepted
**Date:** 2026-03-17
**Supersedes:** None

## Context
Axon (MIT-licensed, Python/KuzuDB) implements several advanced code analysis techniques: symbol-level AST extraction, call tracing, Leiden community detection, multi-pass dead code detection, change coupling via git co-change mining, hybrid search (BM25 + embeddings), impact analysis (BFS blast-radius), and process/flow detection. These techniques would significantly strengthen RepoNav's analysis layer.

## Decision
Study all Axon backend techniques and port them natively to TypeScript. No runtime dependency on Axon. Use the same algorithmic approaches adapted to RepoNav's TypeScript/WASM stack (tree-sitter WASM for AST, SQLite WASM for persistence, pure TS for graph algorithms).

## Consequences
- Symbol-level parsing (v1.3): function/class/method extraction via tree-sitter AST walk
- Community detection (v1.4): Leiden algorithm ported to TypeScript
- Impact analysis (v1.5): BFS on call graph grouped by hop depth
- Dead code detection (v2.2): multi-pass framework-aware analysis
- Change coupling (v2.3): git log co-change mining
- Hybrid search (v2.1): SQLite FTS5 + transformers.js + reciprocal rank fusion
- Process detection (v2.4): execution flow sequence identification
- Visualization (v3.4): community hulls, symbol-level graph view
- See docs/ROADMAP.md for implementation schedule
