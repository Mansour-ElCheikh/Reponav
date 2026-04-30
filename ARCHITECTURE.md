# RepoNav — Architecture

RepoNav is a deterministic architecture sensor with four shipped surfaces over a single analysis pipeline.

## One sentence

A deterministic graph + analyzer fan-out over your repo, with optional LLM-mediated tour synthesis as a presentation layer.

## Four surfaces, one pipeline

```text
┌─────────────────────────────────────────────────────────────────┐
│                          Surfaces                               │
│                                                                 │
│  VS Code Extension     CLI            MCP Server     Action    │
│  src/extension.ts      bin/reponav.ts src/mcp/       action.yml │
│         │                  │              │            │       │
│         └──────┬───────────┴──────┬───────┴───────┬────┘       │
│                │                  │               │            │
│                ▼                  ▼               ▼            │
│            ┌────────────────────────────────────────────┐      │
│            │  Deterministic Analysis Pipeline           │      │
│            │  src/analyzers/**                          │      │
│            └────────────────────────────────────────────┘      │
│                              │                                 │
│                              ▼                                 │
│              ┌─────────────────────────────────┐               │
│              │  AI Tour Synthesis (optional)   │               │
│              │  src/ai/**                      │               │
│              └─────────────────────────────────┘               │
│                              │                                 │
│                              ▼                                 │
│              ┌─────────────────────────────────┐               │
│              │  Webview UI (extension only)    │               │
│              │  webview/src/**                 │               │
│              └─────────────────────────────────┘               │
└─────────────────────────────────────────────────────────────────┘
```

All four surfaces consume the same analyzer pipeline. There is no surface-specific re-implementation.

## The pipeline

```
File selection
    │   src/analyzers/fileSelection.ts
    │   filters by extension, .gitignore, manifest hints
    ▼
Tree-sitter parse
    │   src/analyzers/TreeSitterProvider.ts
    │   WASM-backed; languages: TS, JS, TSX, Python, Go
    ▼
Graph build
    │   src/analyzers/graphBuilder.ts + importAnalyzer
    │   nodes = files + symbols; edges = imports + symbol refs
    ▼
Analyzer fan-out
    │   src/analyzers/{layerDag, blastRadiusAnalyzer,
    │     changeCouplingAnalyzer, deadCodeClassifier,
    │     federationAnalyzer, schemaAnalyzer, seamDetector,
    │     riskAnalyzer, frameworkDetector, ...}
    │   parallel-safe; each consumes the graph independently
    ▼
Serializer
    │   src/services/tours/TourSerializer.ts (extension)
    │   src/services/analysisCompleteness.ts (CLI/MCP)
    │   formats: summary, compact, json, toon, table
```

This pipeline is the entire crafted value of RepoNav. The four surfaces are just different ways to invoke it and consume its output.

## Deterministic vs LLM

The split is roughly **80% deterministic, 20% LLM-mediated.**

**Deterministic (always, no API key required):**
- File discovery and language stats
- Import graph + fan-in/out metrics
- Symbol extraction (tree-sitter)
- Layer DAG + violations
- Blast radius (BFS over import graph)
- Change coupling (git log mining)
- Dead code candidates (multi-pass reachability)
- Schema entities + relationships
- Federation edges (tsconfig paths + workspace manifests)
- Temporal risk (git churn + ownership + bot filtering)

**LLM-mediated (opt-in, via configured provider):**
- Tour narration (the deterministic graph supplies the structure; the LLM supplies the prose)
- Custom Q&A in the extension panel ("how does auth work?")

The LLM never invents architectural facts. It explains facts the analyzers already extracted. If the LLM provider is unavailable or unconfigured, every deterministic capability still works — only narration degrades to a non-LLM template.

## Surfaces in detail

### VS Code Extension (`src/extension.ts`)

Composition root. Wires:
- Workspace adapter (`src/VSCodeWorkspaceAdapter.ts`)
- Provider routing (`src/ai/DynamicLLMProvider.ts`)
- Tour generator (`src/ai/tourGenerator.ts`)
- Webview lifecycle (`src/webview/webviewProvider.ts`)
- Persistence (`src/db/RepoDatabase.ts`)

Commands: `reponav.openPanel`, `reponav.generateTour`, `reponav.showDependencyGraph`, `reponav.analyzeWorkspace`, `reponav.healthCheck`, `reponav.clearCache`.

### CLI (`bin/reponav.ts`)

Headless. Subcommands: `analyze`, `check`, `dead-code`, `coupling`, `flows`, `impact`, `risk`, `seams`, `mcp`. Routes through the same pipeline as the extension.

### MCP Server (`src/mcp/mcpServer.ts`)

Stdio transport. Tools: `analyze`, `check`, `impact`, `flows`, `coupling`. Same pipeline, structured outputs sized for LLM context windows.

### GitHub Action (`action.yml`)

Wraps `reponav check` for CI. Inputs: `repo-path`, `max-violations`, `max-dead-code`, `max-blast-radius`. Fails the job when thresholds are exceeded.

## Webview

The webview (`webview/src/**`) is React + Sigma.js + graphology. It renders graphs the deterministic engine produces. State flows extension → webview via VS Code message API; the webview is a pure renderer.

## Persistence

`.reponav/index.db` (SQLite via WASM) caches analysis results, tours, and retrieval chunks. Cache invalidation is content-based (hashed inputs). The DB is created lazily on first analysis.

## Non-goals

RepoNav explicitly does NOT:
- Refactor your code
- Score your team or developers
- Run your code (no execution; tree-sitter parses, never invokes)
- Require a backend service (single-install, no infrastructure)
- Lock you to a specific AI provider (BYOK across multiple providers)

These are deliberate boundaries. The architecture stays small because the scope stays small.

## Tech stack

| Layer | Technology |
|---|---|
| Extension | TypeScript, VS Code API, esbuild |
| AI | VS Code Language Model + provider-based BYOK routing |
| Webview UI | React 18, Vite, Sigma.js, graphology |
| Analysis | tree-sitter WASM + native TypeScript graph algorithms |
| Persistence | SQLite via WASM |
| Headless surfaces | CLI (Commander), MCP (stdio) |

Zero backend services. Zero external runtime dependencies. Single-install experience.
