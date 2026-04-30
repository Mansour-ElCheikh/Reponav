# RepoNav — Architecture Tours for any codebase

> Generate interactive architecture tours for any codebase. Understand repos in minutes, not days.

[![CI](https://github.com/mansour-90/reponav/actions/workflows/ci.yml/badge.svg)](https://github.com/mansour-90/reponav/actions/workflows/ci.yml)
[![Marketplace](https://img.shields.io/visual-studio-marketplace/v/reponav.reponav)](https://marketplace.visualstudio.com/items?itemName=reponav.reponav)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache--2.0-blue.svg)](LICENSE)

RepoNav is a **deterministic architecture sensor** for any codebase. It builds a real graph of your repo (tree-sitter parse, import resolution, layer DAG, federation edges, temporal risk scoring), then offers four surfaces to explore that graph: a VS Code extension, a CLI, an MCP server for LLM agents, and a GitHub Action for CI gating.

It does **not** refactor your code, score your team, or run your code. It surfaces what is already there, deterministically, and explains it on request.

## Why

Onboarding to an unfamiliar codebase is slow because the architecture is implicit — buried in import paths, scattered across folders, expressed in folklore. RepoNav makes the architecture explicit. The same data powers four use cases:

- **Onboarding:** "show me how auth works" → guided tour through the actual files
- **Pre-PR review:** "what does this change touch?" → blast-radius + change-coupling
- **CI gating:** "block PRs that increase layer violations or dead code" → action threshold
- **Agent context:** MCP tools give LLM agents structured, token-efficient repo intelligence

## Install

### VS Code Extension

Install from the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=reponav.reponav) (search "RepoNav").

Or from the command palette:
```
ext install reponav.reponav
```

### CLI

```bash
npx reponav analyze .
npx reponav check . --max-violations 5 --max-dead-code 20
npx reponav impact <symbol>
```

### GitHub Action

```yaml
name: Architecture gate
on: pull_request

jobs:
  reponav:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: mansour-90/reponav@v0.1.0
        with:
          repo-path: .
          max-violations: '5'
          max-dead-code: '20'
          max-blast-radius: '30'
```

### MCP Server

RepoNav ships an MCP (Model Context Protocol) server. Add to your agent config:

```json
{
  "mcpServers": {
    "reponav": {
      "command": "npx",
      "args": ["reponav", "mcp"]
    }
  }
}
```

Tools exposed: `analyze`, `check`, `impact`, `flows`, `coupling`.

## Quick start (extension)

1. Install the extension.
2. Choose an AI provider in settings: VS Code Language Model (default), Anthropic, OpenAI, Groq, Gemini, or `mock` (offline demo).
3. Open any project. Run `Cmd+Shift+P → RepoNav: Generate Architecture Tour`.

The tour walks through the actual files in your repo, narrating what each does and how it connects.

## Surfaces

| Surface | Use | Example |
|---|---|---|
| **VS Code extension** | Interactive tours, dependency graphs, in-IDE Q&A | `RepoNav: Generate Architecture Tour` |
| **CLI** (`npx reponav`) | Headless analysis for scripts, ad-hoc inspection | `reponav analyze . --tier 3 --format json` |
| **MCP server** | Structured repo intelligence for LLM agents | `reponav mcp` (stdio transport) |
| **GitHub Action** | CI gating on architecture metrics | `mansour-90/reponav@v0.1.0` |

## Analysis tiers

`reponav analyze --tier <0-6>` controls depth. Higher tiers strictly include lower ones.

| Tier | Adds |
|---|---|
| 0 | File discovery, framework detection, language stats |
| 1 | Import graph, fan-in/out metrics, hot files, orphans |
| 2 | Symbol extraction (tree-sitter), symbol edges, flows |
| 3 | Layer DAG, layer violations, dead-code candidates |
| 4 | Schema entities + relationships |
| 5 | Federation — sister-repo discovery via tsconfig paths and pnpm/yarn/Nx workspaces |
| 6 | Temporal intelligence — git churn, ownership, hotspot risk |

## Output formats

`--format <fmt>` on the CLI / `format` arg on MCP tools.

| Format | Approx tokens (medium repo) | Use |
|---|---|---|
| `summary` | 200–500 | Self-calibrating Pareto hot files; default for orientation |
| `compact` | ~20K | Per-file metrics, frameworks, entry points, circular deps |
| `json` | ~100K | Full deterministic graph + violations + classifications |
| `toon` | high-density agent format (`@section #key:value`) | Cheaper LLM context than JSON |
| `table` | tab-separated | Human terminal use for `coupling`, `flows` |

## Architecture

See [ARCHITECTURE.md](ARCHITECTURE.md). One sentence: RepoNav is a deterministic graph + analyzer fan-out, with optional LLM-mediated tour synthesis as a presentation layer over the graph.

## Issues

Bugs, feature requests, questions: [github.com/mansour-90/reponav/issues](https://github.com/mansour-90/reponav/issues).

For security issues, see [SECURITY.md](SECURITY.md).

## License

Apache-2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
