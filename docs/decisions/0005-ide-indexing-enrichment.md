# ADR-0005: IDE indexing as analyzer enrichment

**Status:** Accepted
**Date:** 2026-03-10
**Supersedes:** None

## Context
VS Code and LSP provide symbol resolution, references, and diagnostics that can improve analysis quality beyond what static tree-sitter parsing alone achieves.

## Decision
Use IDE indexing (LSP, Language Model APIs) as an analyzer input enrichment source. RepoNav's own tree-sitter analysis remains the foundation; IDE signals supplement it.

## Consequences
- Improved symbol resolution accuracy when IDE signals available
- RepoNav remains useful without IDE signals (standalone analysis still works)
- Must handle cases where IDE indexing is unavailable or incomplete
