# ADR-0037: Keep `/sdlc` umbrella, layer seven phase commands as aliases

**Status:** Accepted
**Date:** 2026-04-30
**Supersedes:** None

## Context

Skill eval (2026-04-30) flagged a structural choice: our `/sdlc` is an umbrella that fans out internally to spec → plan → build → review. `addyosmani/agent-skills` exposes seven explicit phase commands instead: `/spec`, `/plan`, `/build`, `/test`, `/review`, `/code-simplify`, `/ship`.

The eval suggested adopting their seven-command split. On reflection, the right move is **both** — keep the umbrella as a context-aware dispatcher, expose the phase commands as aliases for direct entry. Each pattern serves a different workflow.

Two distinct usage patterns exist:

- **Resume / continue** — user wants the system to read state and resume from wherever the active epic is. They don't want to specify a phase. They want `/sdlc`. This pattern is unique to our session-resume model (`.reponav/plan-next-context.md` auto-refresh).
- **Direct phase entry** — user knows what they want next, wants to skip the dispatcher. They want `/plan` or `/review`.

Forcing pattern 1 users into pattern 2 (theirs') costs them context-recall every session. Forcing pattern 2 users into pattern 1 (ours) costs them a redundant dispatcher hop.

## Decision

Keep `/sdlc` as the umbrella dispatcher. Add the seven phase commands as **slash commands** that route to the existing skills directly:

| Command | Skill |
|---|---|
| `/spec` | `spec` (already exists) |
| `/plan` | `plan` (already exists) |
| `/build` | `build` (already exists; `define` consolidation handled in Phase B) |
| `/test` | `test-driven-development` (port from theirs in Phase C) |
| `/review` | `review` (already exists) |
| `/code-simplify` | `refactor` (already exists; rename trigger to add `/code-simplify`) |
| `/ship` | `shipping-and-launch` (port from theirs in Phase C) |
| `/sdlc` | `sdlc` (umbrella, unchanged) |

Slash commands live in `.claude/commands/*.md` (their convention). Each command file is a thin pointer that invokes the matching skill.

## Consequences

- Users get both ergonomics: resume-from-state via `/sdlc`, direct-phase via `/spec`/`/plan`/etc.
- The seven-command surface matches addyosmani's discoverability story without us giving up the umbrella.
- Each phase command's skill is responsible for its own gating + validation. The umbrella just dispatches; it doesn't re-implement phase logic.
- Two of the seven commands (`/test`, `/ship`) point to skills that don't exist yet — they are placeholders until Phase C ports `test-driven-development` and `shipping-and-launch` from `addyosmani/agent-skills`. Documented as such.
- `/code-simplify` is an alias for the `refactor` skill so users coming from theirs' world have continuity. Adding the alias doesn't create a new skill.
- Slash commands auto-load into the agent surface. Cost is negligible (each command file is <1KB) but the count contributes to the meta-layer concern from the architecture review (see ADR-0036 context). Mitigation: each command file is the minimum pointer + JTBD line, not a duplicated workflow.
