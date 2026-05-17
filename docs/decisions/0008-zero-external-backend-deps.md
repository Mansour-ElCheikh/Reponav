# ADR-0008: Zero external backend dependencies

**Status:** Accepted
**Date:** 2026-03-17
**Supersedes:** None

## Context
Evaluated integrating Axon (Python/KuzuDB) as an MCP backend for symbol-level analysis, community detection, and dead code analysis. This would require users to install a separate Python tool and consume additional tokens via cross-MCP communication.

## Decision
Zero external backend dependencies. All analysis runs natively in TypeScript/WASM within the extension. Techniques from external tools (Axon, etc.) are studied and ported natively — no runtime dependency on any external tool.

## Consequences
- Single install experience (VS Code extension only)
- No Python, KuzuDB, or other runtime dependencies
- Must implement all algorithms natively (Leiden, BFS impact, multi-pass dead code, etc.)
- More implementation work upfront, but zero friction for users
- Tree-sitter WASM + SQLite WASM + pure TypeScript covers all needs
