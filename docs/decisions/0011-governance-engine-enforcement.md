# ADR-0011: Governance engine enforcement

**Status:** Accepted
**Date:** 2026-03-17
**Supersedes:** None

## Context
As the codebase grew, architectural boundaries (e.g., only 3 files may import `vscode`), naming conventions, and test proximity rules were being violated without detection. Manual code review couldn't reliably catch drift. The project needed automated enforcement that runs at build time, not just documentation of rules.

## Decision
Implement a governance engine (`src/governance/coreRules.ts`) that enforces boundary, drift, naming, and test proximity rules. Rules are defined in code and policy in `.reponav/governance.yaml`. Violations fail `npm run test:governance` and `npm run governance:audit`.

## Consequences
- Architectural boundaries are machine-enforced, not just documented
- New rules can be added as the codebase evolves (e.g., MCP schema validation)
- `npm run test:governance` gates CI — violations block merges
- Developers get immediate feedback on boundary violations
- Rule definitions live in code (`coreRules.ts`), policy config in YAML — separation of mechanism and policy
