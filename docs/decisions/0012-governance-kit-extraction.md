# ADR-0012: Extract Governance Framework into Standalone Kit

**Status:** Proposed
**Date:** 2026-03-17
**Supersedes:** None

## Context

RepoNav developed a governance framework (deterministic architecture linter, YAML policy config, skills for audit/refactor/ADR creation, pre-commit hooks) that proved effective at preventing boundary violations, drift, naming inconsistencies, and test gaps. The framework's patterns are project-agnostic — only the config values (approved boundary files, forbidden imports, source extensions) are project-specific.

To reuse this across repos without copy-pasting and diverging, the framework should be extracted into a standalone kit that any project can adopt via a single `/scaffold` command.

## Decision

Create a standalone `governance-kit` repository containing:

### Engine (architecture linting, not syntax linting)
A config-driven TypeScript rule engine extracted from `src/governance/coreRules.ts`. Complements language-specific linters (ESLint, ruff, clippy) — they lint code syntax, the engine lints repo structure:

- **R1 Boundary imports** — only approved files may import a framework (vscode, django, gin, etc.)
- **R2 Drift prevention** — forbidden import paths (_legacy/, vendor/old/, etc.)
- **R3 Naming consistency** — discouraged path fragments (old, copy, tmp, backup)
- **R4 Test proximity** — source files need co-located tests
- **R5-R7 (optional)** — circular imports, max file size, forbidden content patterns

Rules with empty config are skipped. The YAML template ships R1-R4 as parameterized slots; `/scaffold` fills project-specific values by reading the repo.

### Structure

```
governance-kit/
├── engine/
│   ├── coreRules.ts              # portable, config-driven
│   ├── coreRules.test.ts
│   ├── cli.ts                    # npx governance-audit
│   └── package.json              # standalone, dep: yaml only
├── policy/
│   └── governance.yaml.template  # R1-R4 parameterized
├── templates/
│   ├── claude/CLAUDE.md.template
│   ├── cursor/                   # .cursor/rules/ format
│   ├── codex/                    # AGENTS.md format
│   └── docs/decisions/.gitkeep
├── skills/
│   ├── adr/SKILL.md
│   ├── audit/SKILL.md
│   ├── refactor/SKILL.md
│   └── scaffold/SKILL.md
├── hooks/
│   ├── pre-commit                # advisory governance check
│   └── install-hooks.sh
└── README.md
```

### /scaffold skill — two modes

**Bootstrap mode** (new/ungoverned repo): detects language, source dirs, test patterns, framework imports, existing docs, commit style, active agent → proposes governance.yaml values → generates files → installs hooks.

**Adopt mode** (existing repo): detects what already exists → diffs against templates → fills gaps only → never overwrites.

### Multi-agent support

**Universal layer** (works for all agents): governance.yaml, engine, hooks, docs/decisions/, ADRs.

**Agent-specific layer** (steering files + skills): each agent processes instructions differently — Claude uses imperative rules, Cursor uses contextual hints, Copilot uses examples. Templates have agent-specific variants, not mechanical translations.

**Agent switching** (e.g., Claude → Codex): universal pieces persist; `/scaffold --agent codex` in Adopt mode swaps only steering files + skills.

**Priority:** Claude first → Cursor second → Codex third → Copilot last (no skill system).

### Language portability

JS/TS repos get the full engine (`npm install`). Other languages use governance.yaml + skills + hooks; `/audit` calls native linters alongside architecture rules. Don't rebuild clippy/ruff — complement them.

### Execution sequence

1. Extract engine from RepoNav, parameterize config
2. Create governance.yaml.template with R1-R4 configurable slots
3. Create agent-specific steering file templates
4. Build /scaffold skill with detection + bootstrap + adopt modes
5. Test on blank repo, then existing repo (RepoNav as validation)
6. Add Cursor adapter
7. Publish to GitHub

### What NOT to build

- No custom CLI tool — /scaffold skill is the CLI
- No package manager distribution beyond npm — git clone + copy
- No central config server — each repo owns its governance.yaml
- No WASM binary for cross-language engine — native linters exist
- No Copilot skill system — it doesn't have one

## Consequences

**Positive:**
- Any repo gets deterministic architecture governance in one command
- Universal layer works regardless of which AI coding agent is used
- Engine complements existing linters instead of competing with them
- Adopt mode enables incremental adoption without disruption

**Negative:**
- Engine requires Node.js runtime (JS/TS only); other languages rely on soft rules + native linters
- Agent-specific templates require maintenance as agent formats evolve (especially Codex)
- Steering file variants are real work, not mechanical translation — each agent's instruction model differs

**Risks:**
- Agent format churn (Codex especially) could require frequent template updates
- Scope creep toward a "universal governance platform" — guard against this by keeping the kit minimal
