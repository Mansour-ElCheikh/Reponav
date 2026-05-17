# ADR-0006: Schema contracts over prompt-coupled interfaces

**Status:** Accepted
**Date:** 2026-03-10
**Supersedes:** None

## Context
Current tour generation is tightly coupled to prompt templates — changes to the prompt format can silently break output parsing. In MCP mode, multiple host agents will consume RepoNav tools, making stable contracts essential.

## Decision
Shift from prompt-heavy coupling to schema and validation contracts in the MCP path. All MCP tool responses validated against JSON Schema before rendering.

## Consequences
- Strict JSON Schema validation on all MCP tool inputs/outputs
- Schema versioning: tools declare their schema version
- Malformed responses rejected before reaching rendering layer
- Prompts can evolve independently of schema contracts
