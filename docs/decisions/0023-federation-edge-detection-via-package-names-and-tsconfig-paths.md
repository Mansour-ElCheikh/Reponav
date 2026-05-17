# ADR-0023: Federation Edge Detection via Package Names and tsconfig Paths

**Status:** Accepted
**Date:** 2026-04-27
**Supersedes:** None

## Context

Tier 5 federation analysis detected sister repositories in the parent directory but always returned zero cross-repo edges. The original heuristic only matched `../`-relative imports, which almost never appear in real monorepos or workspace setups. Most cross-repo imports use a package name (e.g., `@myorg/auth`) or a tsconfig path alias (e.g., `@shared/*`).

## Decision

Extend `FederationAnalyzer.buildCrossRepoEdges` to detect three categories of cross-repo imports:
1. Relative paths escaping the current repo (`../` resolving into a sister repo path) — existing logic retained.
2. Package-name imports matched against each sister repo's `package.json` `name` field.
3. tsconfig `compilerOptions.paths` aliases whose resolved base path falls within a sister repo.

Sister repo `package.json` files and the current repo's `tsconfig.json` are read once per call and cached in local maps. All file reads are wrapped in `try/catch` — missing files silently produce no edges.

## Consequences

Tier 5 now produces real cross-repo edges for yarn/pnpm/Nx monorepos and repos using tsconfig path aliases. Standalone repos (like RepoNav itself) still return zero edges — correct behaviour. Two additional test cases cover the new detection paths. The `fs` mock in tests must stub both `existsSync` and `readFileSync`.
