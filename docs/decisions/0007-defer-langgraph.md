# ADR-0007: Defer LangGraph

**Status:** Accepted
**Date:** 2026-03-10
**Supersedes:** None

## Context
LangGraph provides multi-step orchestration, retries, memory, and queuing. Evaluated whether RepoNav needs this for tour generation or MCP tool serving.

## Decision
Defer LangGraph unless RepoNav owns autonomous multi-step orchestration loops (retries, memory, queues). Current architecture does not require it — analysis is a single-pass pipeline, and MCP tools are stateless request/response.

## Consequences
- No LangGraph dependency
- Simpler architecture, fewer moving parts
- If future features require multi-step autonomous orchestration, revisit this decision
