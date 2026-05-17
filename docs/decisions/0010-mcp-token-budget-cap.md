# ADR-0010: MCP token budget cap

**Status:** Accepted
**Date:** 2026-03-17
**Supersedes:** None

## Context
MCP tools need to return responses that fit within AI agent context windows without dominating the conversation. Current approach dumps full AnalysisReport objects into LLM prompts with no size control, leading to bloated context and wasted tokens. A fixed budget forces disciplined compression and prioritization.

## Decision
Cap all MCP tool responses at 800 tokens and all LLM prompt contexts at 6,000 tokens. Use top-N ranking by fan-in + structural importance to select which nodes/edges to include. Apply code skeletonization (strip function bodies, keep signatures) for ~8x compression.

## Consequences
- Every MCP tool must fit within 800 tokens — enforced by validation gates
- Requires implementing a ranking/prioritization layer for graph data
- Code skeletonization needed before prompts are assembled
- Simple top-N ranking ships in v1.2; hybrid retrieval (BM25 + embeddings) deferred to v2.1
- Lazy loading pattern: outlines first, details on demand
