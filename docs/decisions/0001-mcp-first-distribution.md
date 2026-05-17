# ADR-0001: MCP-first distribution

**Status:** Accepted
**Date:** 2026-03-10
**Supersedes:** None

## Context
RepoNav runs as a VS Code extension that calls LLM providers directly. This requires users to configure API keys (BYOK) and couples the extension to specific model providers. MCP (Model Context Protocol) offers a standard way for AI agents to consume structured tools, enabling broader distribution without provider lock-in.

## Decision
Prefer MCP tool distribution for interoperability. Position RepoNav as a structured architecture analysis provider that exposes tools via MCP. Avoid depending on private VS Code extension internals.

## Consequences
- RepoNav tools output structured analysis/graph context; host agents handle generation
- Lower setup friction (no BYOK required in delegated MCP mode)
- Host agent bears model cost in delegated generation mode
- Risk: output variance across host agents — mitigated by strict schema validation
- Extension provider path kept as fallback during transition (see ADR-0003)
