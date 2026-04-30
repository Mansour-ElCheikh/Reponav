# Changelog

All notable changes to RepoNav are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-04-29

Initial public release.

### Added

- VS Code extension with architecture tour generation, dependency graphs, and in-IDE Q&A
- CLI (`npx reponav`) with `analyze`, `check`, `impact`, `flows`, `coupling`, and `mcp` subcommands
- MCP (Model Context Protocol) server for LLM agent integration
- GitHub Action (`mansour-90/reponav@v0.1.0`) for CI architecture gating
- Multi-language analyzer support: TypeScript, JavaScript, TSX, Python, Go
- Deterministic graph + analyzer fan-out (file selection → tree-sitter parse → graph build → analyzer fan-out → serializer)
- Analysis tiers 0–6 (file discovery → temporal intelligence)
- Output formats: `summary`, `compact`, `json`, `toon`, `table`
- AI provider routing: VS Code Language Model, Anthropic, OpenAI, Groq, Gemini, mock
- Architecture analyzers: layer DAG + violations, blast radius, change coupling, dead code, federation edges, framework detection, schema entities, temporal risk scoring
