# ADR-0004: No mandatory BYOK in MCP mode

**Status:** Accepted
**Date:** 2026-03-10
**Supersedes:** None

## Context
Current extension requires users to bring their own API key (BYOK) for any provider. This creates setup friction and is a barrier to adoption. In MCP mode, the host agent (e.g., Claude, Copilot) already has model access.

## Decision
Remove mandatory BYOK in MCP mode when the host agent performs generation. RepoNav exposes analysis tools; the host agent reasons and generates.

## Consequences
- Zero-config experience for MCP users
- BYOK still required for direct extension provider usage (fallback path)
- Host agent bears inference cost
- RepoNav must validate generated output regardless of who produced it
