# RepoNav

> **The deterministic architecture sensor for any codebase.** RepoNav reads what's there — symbols, imports, layers, churn, ownership — and surfaces it across IDE, CLI, MCP, and CI. It senses your repo. It does not refactor, score, or run it.

[![CI](https://github.com/Mansour-ElCheikh/Reponav/actions/workflows/ci.yml/badge.svg)](https://github.com/Mansour-ElCheikh/Reponav/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/Mansour-ElCheikh/Reponav)](https://github.com/Mansour-ElCheikh/Reponav/releases)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache--2.0-blue.svg)](LICENSE)

---

## What it is

A **deterministic graph + analyzer fan-out** over your repo. Tree-sitter parses, the graph builder resolves edges, and a fan of analyzers extracts architectural signal. Optional LLM-mediated narration sits on top as a presentation layer over the deterministic facts.

**Sensor, not actuator:**
- Does NOT refactor your code
- Does NOT score your team
- Does NOT run your code
- Does NOT require a backend service
- Does NOT lock you to one AI provider

**Four equal surfaces over one engine:**

| Surface | Use it for |
|---|---|
| **CLI** (`reponav <cmd>`) | Headless analysis — scripts, ad-hoc inspection, agent automation |
| **MCP server** (`reponav mcp`) | Structured repo intelligence for LLM agents (Claude Desktop, Cursor, Cline, etc.) |
| **GitHub Action** (`Mansour-ElCheikh/Reponav@v0.2.2`) | CI gating on architecture metrics |
| **VS Code extension** | Interactive tours, dependency graphs, in-IDE Q&A |

The CLI is the canonical surface — extension and action wrap the same engine.

---

## How it senses

```
File selection (.gitignore-aware)
    ▼
Tree-sitter parse (TypeScript, TSX, JavaScript, Python, Go via WASM)
    ▼
Graph build (file edges + symbol edges)
    ▼
Analyzer fan-out (parallel, deterministic)
    │
    ├─ Symbol extractor + walker (per-language ASTs → symbols + edges)
    ├─ Import analyzer (fan-in / fan-out / hot files / orphans)
    ├─ Layer DAG (Tarjan SCC condensation, layer-violation detection)
    ├─ Blast radius (BFS over reverse call graph, weighted edges:
    │       calls=1.0, extends=1.5, implements=1.2, uses_type=0.5)
    ├─ Change coupling (git log mining; minSupport=2, ubiquity-filtered)
    ├─ Temporal risk (recency-weighted churn; bot-author filter)
    ├─ Dead code (multi-pass: callers + exports + entry-points + boundary roles)
    ├─ Federation (tsconfig paths + pnpm/yarn/Nx workspaces → cross-repo edges)
    ├─ Schema entities + relations
    ├─ Framework + boundary-role classification
    ├─ Bridge-edge community detection (graph-cut analysis)
    ├─ Flow detector (entry → boundary chains)
    └─ Hybrid retriever (BM25 over SQLite FTS4 + 2-hop graph walks,
            merged via Reciprocal Rank Fusion)
    ▼
Serializer (summary | compact | json | toon | table)
```

This pipeline is the entire crafted value of RepoNav. Surfaces are different ways to invoke and consume its output.

---

## Install

### CLI (interim — pre-npm publish)

`v0.2.2` ships via GitHub Releases. npm registry publish lands in `v0.2.x`. Until then:

```bash
# One-off via npx (resolves bin entry from the GitHub repo)
npx github:Mansour-ElCheikh/Reponav#v0.2.2 analyze --repo .

# Or clone + link for repeated use
git clone https://github.com/Mansour-ElCheikh/Reponav.git
cd reponav && npm install && npm run build
npm link    # exposes `reponav` on PATH
reponav analyze --repo /path/to/target
```

### VS Code Extension

Download `reponav-0.2.2.vsix` from [GitHub Releases v0.2.2](https://github.com/Mansour-ElCheikh/Reponav/releases/tag/v0.2.2):

```bash
code --install-extension reponav-0.2.2.vsix
```

Marketplace listing lands in `v0.2.x` once the publisher account is finalized.

### MCP server

Add to your agent config:

```json
{
  "mcpServers": {
    "reponav": {
      "command": "npx",
      "args": ["github:Mansour-ElCheikh/Reponav#v0.2.2", "mcp"]
    }
  }
}
```

Tools exposed (see §MCP tools below). Stdio transport.

### GitHub Action

```yaml
name: Architecture gate
on: pull_request

jobs:
  reponav:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: Mansour-ElCheikh/Reponav@v0.2.2
        with:
          repo-path: .
          max-violations: '5'
          max-dead-code: '20'
          max-blast-radius: '30'
```

---

## CLI commands (7)

| Command | What |
|---|---|
| `reponav analyze --repo <path>` | Full analysis (file selection → tree-sitter → graph → analyzers → serializer). Tier 0–6, format selectable. |
| `reponav check --repo <path>` | CI gate: layer violations, dead-code candidates, max blast radius. Exits non-zero on threshold breach. |
| `reponav impact <symbol>` | Reverse-traversal blast radius for a single symbol (BFS over reverse call graph). |
| `reponav risk` | Temporal risk hotspots (churn × recency × ownership concentration; bot authors filtered). |
| `reponav seams` | Architectural seams — edges whose removal would cleave the graph (Bridge Edge detection). |
| `reponav flows` | Entry-point → boundary chains (HTTP routes, CLI entries, exported public surfaces). |
| `reponav coupling` | Change coupling pairs from git log mining. minSupport configurable. |

All commands accept `--format <summary | compact | json | toon | table>`.

---

## MCP tools (10)

| Tool | Returns |
|---|---|
| `analyze` | Full analysis report, format-selectable |
| `check` | CI-gate result (pass/fail + breach details) |
| `impact` | Blast radius for a symbol |
| `risk` | Temporal risk hotspots |
| `seams` | Bridge edges (architectural seams) |
| `flows` | Entry → boundary flow chains |
| `coupling` | Change coupling pairs |
| `dead-code` | Multi-pass dead-code candidates |
| `layer-violations` | Layer DAG violations |
| `blast-radius` | Repo-wide blast-radius distribution |

All tools accept `repo`. Most accept `format` and `top` for budgeting.

---

## Output formats

`--format <fmt>` on the CLI / `format` arg on MCP tools.

| Format | Approx tokens (medium repo) | Use |
|---|---|---|
| `summary` | 200–500 | Self-calibrating Pareto hot files; default for orientation |
| `compact` | ~20K | Per-file metrics, frameworks, entry points, circular deps |
| `json` | ~100K | Full deterministic graph + violations + classifications |
| `toon` | high-density agent format (`@section #key:value`) | Cheaper LLM context than JSON |
| `table` | tab-separated | Human terminal use for `coupling`, `flows` |

---

## Analysis tiers

`--tier <0–6>` controls depth. Higher tiers strictly include lower ones.

| Tier | Adds |
|---|---|
| 0 | File discovery, framework detection, language stats |
| 1 | Import graph, fan-in/out metrics, hot files, orphans |
| 2 | Symbol extraction (tree-sitter), symbol edges, flows, dead-code, change coupling |
| 3 | Layer DAG, layer violations |
| 4 | Schema entities + relationships |
| 5 | Federation — sister-repo discovery via tsconfig paths and pnpm/yarn/Nx workspaces |
| 6 | Temporal intelligence — git churn, ownership, hotspot risk |

---

## Languages

Full analysis (parser + walker + edge tracer):

| Language | Extensions | Symbol kinds | Edge kinds |
|---|---|---|---|
| TypeScript | `.ts` | functions, classes, interfaces, methods, exports | calls, extends, implements, uses_type |
| TSX | `.tsx` | (shares TS) | (shares TS) |
| JavaScript | `.js`, `.jsx` | functions, classes, methods, exports | calls, extends |
| Python | `.py` | functions, classes, methods | calls |
| Go | `.go` | functions, structs, interfaces, methods | calls, struct embedding |

Roadmap (graduates as parsers + walkers land): Rust, Java, C#, Ruby. Change coupling already accepts these by extension; full symbol/edge analysis pending walker implementation.

---

## AI provider routing (LLM tour synthesis)

The deterministic engine never requires an LLM. Tour narration (the "explain this codebase" surface) optionally routes through:

- VS Code Language Model (default in extension; uses GitHub Copilot's models)
- Anthropic, OpenAI, Groq, Google Gemini (BYOK via settings)
- `mock` provider (offline, deterministic responses for testing)

If no provider is configured, deterministic surfaces still work — only narration degrades.

---

## Architecture

See [ARCHITECTURE.md](ARCHITECTURE.md). Single-install, zero infrastructure dependencies. WASM-bundled tree-sitter + sql.js. No backend service.

---

## Issues

Bugs, feature requests, questions: [github.com/Mansour-ElCheikh/Reponav/issues](https://github.com/Mansour-ElCheikh/Reponav/issues).

For security issues, see [SECURITY.md](SECURITY.md).

## License

Apache-2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
