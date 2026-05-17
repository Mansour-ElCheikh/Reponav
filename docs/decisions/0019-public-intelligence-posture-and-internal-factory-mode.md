# ADR-0019: Public Intelligence Posture and Internal Factory Mode

**Status:** Accepted
**Date:** 2026-04-21
**Supersedes:** None

## Context
Strategic documentation drift left RepoNav's posture ambiguous across roadmap, positioning, and CTO findings. The product now ships tours, CLI, MCP, CI profiles, and a GitHub Action wrapper from the same deterministic engine, but not all of those surfaces should be presented or enforced the same way. The cleanup surfaced four decisions that blocked closeout: public posture, internal factory posture, benchmark role, and gate escalation for dead-code and other signals.

## Decision
RepoNav's public posture is codebase intelligence plus agent infrastructure, with tours as the human-facing wedge and CLI/MCP/action surfaces as distribution for analysis and guidance. The more opinionated harness, CI profiles, evidence paths, and factory workflow remain internal dogfood and an optional future enterprise packaging path rather than the default public promise. Benchmarking remains a release-confidence and trust instrument, not a default required CI gate, and dead-code or similar signals do not become hard-blocking until confidence tiers and remediation ergonomics are explicit.

## Consequences
Active strategic docs should describe RepoNav as an intelligence layer first and a stricter factory workflow second. `reponav check` remains shipped and supported, but public positioning stays closer to analysis plus signals than policy-first enforcement. The strategic-doc cleanup chapter is considered closed; future posture changes require a new ADR and targeted updates to active docs rather than reviving legacy amendment notes.