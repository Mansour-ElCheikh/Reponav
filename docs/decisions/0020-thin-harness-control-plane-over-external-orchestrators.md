# ADR-0020: Thin Harness Control Plane Over External Orchestrators

**Status:** Accepted
**Date:** 2026-04-21
**Supersedes:** None

## Context
RepoNav now has a deterministic architecture-analysis engine plus an increasingly capable internal harness around CI profiles, evidence collection, workflow scripts, and manifest-driven parallel work. Recent build-vs-buy review of external systems such as Superpowers, Speckit-style workflows, Paperclip, and team/swap-style orchestration showed useful patterns but also a risk of importing a heavier control plane than RepoNav needs. The open question was whether to replace the current harness direction with an external orchestration framework or keep building a local control plane on top of RepoNav's substrate.

## Decision
RepoNav will keep its own harness as a thin, deterministic control plane built on top of the RepoNav analysis engine. The project may borrow specific patterns from external systems such as skill portability, phase gating, atomic task checkout, and explicit shared state, but policy, manifests, workflow commands, and CI evidence remain in-repo and machine-readable. Full external orchestration platforms, persistent swarm runtimes, and prompt-only governance conventions are excluded from the default path.

## Consequences
Future harness work should prioritize lightweight manifests, orchestrator-to-worker dispatch, ownership contracts, and deterministic closeout over new infrastructure or dashboards. External tools remain reference material and optional pattern sources, not the primary runtime or policy source. Sequencing also stays conservative: finish active seam and reconcile work first, keep strategic-doc cleanup closed unless posture changes again, and only advance harness automation when it directly hardens the existing control plane rather than creating a parallel platform.