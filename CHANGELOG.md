# Changelog

All notable changes to RepoNav are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.3] - 2026-04-30

### Fixed

- `test:e2e` filter actually excludes visual tests now. v0.1.2's `--grep-invert '^visual:'` matched against playwright's `<file>:line:col > <title>` string, which starts with `webview-visual.e2e.ts` — the `^visual:` anchor never matched. Switched to `--grep-invert 'webview-visual'` (matches the file segment). CI E2E job now runs 24 behavior + smoke tests, skips 9 visual-snapshot tests.

## [0.1.2] - 2026-04-30

### Fixed

- `action.yml`: removed `cache: npm` + `cache-dependency-path` from setup-node step. The previous config produced `.//package-lock.json` when invoked locally (uses: ./), which actions/setup-node@v4 rejects with "Relative pathing '.' and '..' is not allowed." Self-test workflow (`reponav-check.yml`) now passes.

### Changed

- `test:e2e` now excludes visual-snapshot tests via `--grep-invert '^visual:'`. Visual snapshots are platform-specific (chromium-darwin baselines fail on chromium-linux CI runners) and require deliberate baseline management — making them opt-in via dedicated scripts:
  - `npm run test:e2e:visual` — run visual snapshot tests
  - `npm run test:e2e:visual:update` — regenerate baselines for current platform
  - `npm run test:e2e:all` — full e2e including visual

  CI runs `test:e2e` (behavior + smoke). Visual regression testing is a separate workflow once cross-platform baseline management lands.

## [0.1.1] - 2026-04-30

### Changed

- README rewritten as sensor-first positioning; surfaces (CLI, MCP, Action, Extension) get equal billing instead of extension-centric framing
- README grounds technical claims in the actual analyzer pipeline (BM25 over SQLite FTS4 + Reciprocal Rank Fusion, BFS with weighted edges for blast radius, Tarjan SCC for layer DAG, Bridge-Edge community detection, recency-weighted churn with bot-author filtering, multi-pass dead-code classification, tree-sitter parsers per language)
- README documents all 7 CLI subcommands and all 10 MCP tools (was 5 of each)
- Install instructions added for npx-via-GitHub interim path until npm publish lands

### Fixed

- `mcpServer.test.ts` coupling test now self-builds a deterministic git fixture repo with multi-commit co-change history. Previously asserted against `process.cwd()`, which failed in CI where the public repo has only one squashed-release commit.
- Removed the verify-oss-extract.sh sed-skip workaround for the same test.

## [0.1.0] - 2026-04-29

Initial public release.

### Added

- VS Code extension with architecture tour generation, dependency graphs, and in-IDE Q&A
- CLI (`npx reponav`) with `analyze`, `check`, `impact`, `flows`, `coupling`, and `mcp` subcommands
- MCP (Model Context Protocol) server for LLM agent integration
- GitHub Action (`Mansour-ElCheikh/Reponav@v0.1.0`) for CI architecture gating
- Multi-language analyzer support: TypeScript, JavaScript, TSX, Python, Go
- Deterministic graph + analyzer fan-out (file selection → tree-sitter parse → graph build → analyzer fan-out → serializer)
- Analysis tiers 0–6 (file discovery → temporal intelligence)
- Output formats: `summary`, `compact`, `json`, `toon`, `table`
- AI provider routing: VS Code Language Model, Anthropic, OpenAI, Groq, Gemini, mock
- Architecture analyzers: layer DAG + violations, blast radius, change coupling, dead code, federation edges, framework detection, schema entities, temporal risk scoring
