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

## Self-application

RepoNav's analyzer runs against RepoNav's own source. Two mechanisms make this observable.

**Dogfood loop (factory-time).** The SDLC `review` skill invokes `reponav.analyze` on its own diff before merge. The governance engine's seam-detection rule (R17) runs against RepoNav's own source files. Epic 010-dogfood-signal-fixes (shipped 2026-04-07) closed four self-analysis bugs that only surfaced under self-application: a `CATEGORY_LAYER` key mismatch, an over-firing entry-point detector, a guard that bailed on self-analysis hints, and missing boundary-role entries for VS Code-adjacent packages. R17 hotspot output is checked into `.reponav/arch-context.md` and `.reponav/plan-next-context.md`, flagged in RepoNav's own files by the same rule that flags hotspots in user code.

**MCP gate (agent-time).** A PreToolUse hook (`scripts/governance-mcp-gate.cjs`) intercepts broad architectural searches (`Grep`, `Glob`, `grep_search`) and requires a fresh `reponav.analyze` summary for the current commit state before allowing them. A pre-registered 36-cell eval (3 model classes × 3 arms × 4 reps, n=12 per arm; sweep `2026-05-03-1905-T6L8`, completed 2026-05-03) measured the behavioral effect. Across Haiku 4.5, Sonnet 4.6, and Opus 4.7 on a fair non-leaky fixture, supplying architectural context at agent decision time lifts correct architectural choice from 1/12 (8%) to 11/12 or 12/12 (92 to 100%): a **+83 to +92 percentage-point lift** depending on delivery channel (pre-loaded system-prompt blob vs mid-task tool call). Opus rose from 0% to 100%. The eval lives in the development harness today; full data publishes via the forthcoming `mansour-90/agent-reliability-scaffold` repository.

Output formats are characterized separately. ADR-0041 (`docs/decisions/0041-toon-promotion-after-fidelity-bench.md`) benchmarks `summary` / `compact` / `json` / `toon` / `markdown` on three real fixtures (express, fastapi, RepoNav-self) under a pre-registered decision rule: TOON is 60–69% smaller than markdown at 100% fidelity on spot-checked counts; `summary` remains the default for orientation.

The dogfood loop and the MCP gate share the same underlying tool but operate at different points in the lifecycle. Each is independently observable.

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
