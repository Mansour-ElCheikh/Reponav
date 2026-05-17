# ADR-0002: Analysis-first positioning

**Status:** Accepted
**Date:** 2026-03-10
**Supersedes:** None

## Context
RepoNav could position as a generic chat/retrieval assistant or as a specialized architecture intelligence layer. The former puts it in direct competition with GitHub Copilot, Cursor, and other AI coding tools. The latter leverages its unique deterministic analysis pipeline.

## Decision
Position RepoNav as structured architecture analysis first. The moat is the intelligence layer: structural graph, file/layer classification, guided tour curation, persistence/cache. AI narration is second — the deterministic analysis is the product.

## Consequences
- 80/20 split: 80% deterministic analysis engine, 20% AI narration
- Tours are saved artifacts, not ephemeral chat
- RepoNav does not compete as a generic coding assistant
- MCP tools expose analysis data, not raw LLM responses
