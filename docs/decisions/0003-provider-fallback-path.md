# ADR-0003: Keep extension provider fallback path

**Status:** Accepted
**Date:** 2026-03-10
**Supersedes:** None

## Context
MCP-first is the target distribution model, but MCP adoption is early. Users without MCP-capable agents still need to generate tours.

## Decision
Keep the extension/provider fallback path (Groq/Gemini/Anthropic/OpenAI/Mock) during the MCP transition. The provider hierarchy continues to work for direct extension usage.

## Consequences
- Two generation paths to maintain: MCP-delegated and extension-internal
- Provider hierarchy (BaseProvider, DynamicLLMProvider) remains active code
- MockProvider enables dev/demo/offline mode regardless of MCP adoption
- Will re-evaluate once MCP adoption reaches sufficient maturity
