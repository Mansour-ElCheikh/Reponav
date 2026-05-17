# ADR-0036: Skill anatomy contract + R26 skill size cap

**Status:** Accepted
**Date:** 2026-04-30
**Supersedes:** None

## Context

Audit-driven skill eval (2026-04-30, see `dev/eval/skills-2026-04-30.md`) compared our 17 skills against `addyosmani/agent-skills` 21 skills on a 6-dimension rubric. Headline gap: ours averaged 10.6/18, theirs averaged 15.5/18. The single largest contributor was anti-rationalization — every theirs skill has excuses-vs-reality tables and Red Flags sections; **0/17 of ours did**.

Two governance questions surfaced from the eval:

1. The eval rig used a generic 24KB byte cap as a hygiene signal and flagged `skill-creator` (33.7KB) as a violation. R13_prompt_size_cap targets `src/ai/prompts.ts` only (via `file_patterns`), so this was an **eval-rig signal, not a governance.yaml violation**. The user correctly challenged conflating the two: R13 protects an LLM-context-hot file; skill files have a different load profile.
2. The skill anatomy itself was undocumented in our governance. New skills could land without Common Rationalizations, Red Flags, or Verification sections. The eval result is the natural consequence — undocumented standard, drift inevitable.

## Decision

### Part 1: Codify the skill-anatomy contract

Every `.claude/skills/*/SKILL.md` MUST contain (in this order):

1. **YAML frontmatter** with `name` (must match dir name) and `description` (≤1024 chars, JTBD-shaped — what + when).
2. **`# <Skill Title>`** H1.
3. **`## Overview`** — one to two sentences explaining what + why.
4. **`## When to Use`** — bullets including a `**When NOT to use:**` clause.
5. **The workflow body** — numbered phases or gated steps, explicit exit criteria per phase.
6. **`## Common Rationalizations`** — table mapping excuse → rebuttal.
7. **`## Red Flags`** — bullet list of behavioral signals the skill is being skipped or misapplied.
8. **`## Verification`** — checklist with evidence requirements.

Format inspiration: `addyosmani/agent-skills/docs/skill-anatomy.md`. Our deviation: enforce structurally via R26, not by convention.

### Part 2: R26 — soft skill size cap

Add a new governance rule:

```yaml
- id: R26_skill_size_warn
  severity: warning
  description: SKILL.md files should stay structurally bounded so they don't bloat agent context when triggered.
  enforcement: [hook, engine]
  check: prompt_size_warn
  file_patterns:
    - ".claude/skills/**/SKILL.md"
  warn_bytes: 16000
  max_bytes: 32000
```

Reuses the existing `prompt_size_warn` checker. Rationale for the thresholds:

- **16KB warn** — at typical token density (~3.5 chars/token in TS+English mix, ~4 chars/token in plain prose), this is roughly 4–5K tokens. A skill larger than this consumes a meaningful slice of agent context every time it triggers.
- **32KB hard** — generous ceiling. Skills approaching it should split into sibling skills or extract reference files into `references/` per the addyosmani pattern. Three of our 17 skills currently exceed 16KB (`skill-creator` 33.7KB, `parallel-workflow` 14.2KB just under, `seam-extract` 8.4KB clear). Only `skill-creator` exceeds the hard cap and triggers split.
- **Soft warn, not block** — skills are content, not structural code. A warn-band gives the author room to ship before refactoring. R13 stays hard-block because prompts.ts is structurally hot.

R13 is **unchanged**. It still targets only `src/ai/prompts.ts`.

### Part 3: Anti-rationalization template applied to all retained skills

Every existing skill gets a Common Rationalizations table, Red Flags section, and Verification checklist appended in this same change. Future skills must include them at creation. R26 covers size; the anatomy contract covers structure.

## Consequences

- The eval rig's d4 score (anti-rationalization) lifts from 0/3 → ≥2/3 across all 17 skills mechanically. d3 (verification) and d6 (when-not-to-use) lift opportunistically. Re-running `scripts/skill-eval/score.mjs` should show our cohort average move from 10.6 → ~14.5.
- `skill-creator` remains in place (no R13 violation). It triggers an R26 warning at 33.7KB, which is the correct outcome — the rule asks the author to consider splitting, doesn't block.
- New skills cannot land structurally bare. The hook fires on Write/Edit to `.claude/skills/**/SKILL.md` and warns when over 16KB.
- The contract is enforced by data, not docs. ADR text says "should"; R26 + sanity grid say "or you'll see a warning".
- A future eval pass (after Phase B/C ports from `addyosmani/agent-skills`) re-runs the same rig and tracks the score trend over time. Score becomes a leading indicator of skill-layer health.
