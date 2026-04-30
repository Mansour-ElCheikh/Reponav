import * as path from 'path';
import { ImportEdge } from '../types';

const IMPORT_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.vue', '.svelte'];

/**
 * Try to resolve a bare (non-relative) path segment against candidate roots,
 * using the same extension/index probing as `resolveJsImport`.
 * Returns the matched workspace-relative path or null.
 */
function tryResolveFromRoots(
    bareSegment: string,
    allFiles: Set<string>
): string | null {
    const candidate = path.normalize(bareSegment);
    if (allFiles.has(candidate)) return candidate;
    for (const ext of IMPORT_EXTENSIONS) {
        if (allFiles.has(candidate + ext)) return candidate + ext;
    }
    for (const ext of IMPORT_EXTENSIONS) {
        const idx = path.join(candidate, `index${ext}`);
        if (allFiles.has(idx)) return idx;
    }
    return null;
}

/**
 * Detect common tsconfig path-alias prefixes present in the file set.
 * Returns a Map<prefix, string[]> of root candidates to try for that prefix.
 *
 * Heuristics (no tsconfig required):
 *  - `@/*`  → try `src/`, `` (root)  — covers Next.js, Vite, CRA with alias
 *  - `~/`   → try `src/`, ``
 *  - `#`    → try `src/`            — Node.js subpath imports
 *  - bare paths (e.g. `components/`)
 *    are NOT guessed; too ambiguous with real npm scoped packages.
 */
const ALIAS_ROOTS = ['src/', ''];

/**
 * Resolve a JS/TS import specifier to an actual workspace-relative file path.
 * Handles:
 *  - Relative paths (./foo, ../bar)
 *  - Absolute paths (/foo)
 *  - Common tsconfig path aliases: @/* and ~/  (heuristic — tries src/ and root)
 *  - Node.js subpath imports: #utils
 *
 * Path aliases that are unambiguously external npm packages (e.g. `axios`,
 * `@company/package` without a `/` in the scope) are still skipped.
 *
 * NOTE: For projects with non-standard tsconfig `paths`, call this with a
 * pre-built alias map instead (future: accept optional TsconfigPaths param).
 */
export function resolveJsImport(
    importSpecifier: string,
    sourceFile: string,
    allFiles: Set<string>,
    workspaceRoot: string
): string | null {
    const isRelative = importSpecifier.startsWith('.') || importSpecifier.startsWith('/');

    if (!isRelative) {
        // ── Path alias heuristics ────────────────────────────────────────────
        // @/* alias (most common — Next.js, Vite baseUrl, create-react-app aliases)
        if (importSpecifier.startsWith('@/')) {
            const bare = importSpecifier.slice(2); // strip '@/'
            for (const root of ALIAS_ROOTS) {
                const match = tryResolveFromRoots(root + bare, allFiles);
                if (match) return match;
            }
            return null;
        }
        // ~/* alias (Webpack, Vue CLI, some Vite configs)
        if (importSpecifier.startsWith('~/')) {
            const bare = importSpecifier.slice(2);
            for (const root of ALIAS_ROOTS) {
                const match = tryResolveFromRoots(root + bare, allFiles);
                if (match) return match;
            }
            return null;
        }
        // Node.js subpath imports (#utils, #lib/foo)
        if (importSpecifier.startsWith('#')) {
            const bare = importSpecifier.slice(1);
            for (const root of ALIAS_ROOTS) {
                const match = tryResolveFromRoots(root + bare, allFiles);
                if (match) return match;
            }
            return null;
        }
        // Scoped package with sub-path: @scope/pkg/deep — might be local monorepo module.
        // Try resolving `pkg/deep` under `packages/` and `src/`.
        if (importSpecifier.startsWith('@') && importSpecifier.includes('/')) {
            const withoutScope = importSpecifier.replace(/^@[^/]+\//, '');
            for (const root of ['packages/', 'src/', '']) {
                const match = tryResolveFromRoots(root + withoutScope, allFiles);
                if (match) return match;
            }
        }
        // All other bare imports (e.g. 'react', 'express') are external — skip.
        return null;
    }

    const sourceDir = path.dirname(sourceFile);
    let resolved = path.resolve(workspaceRoot, sourceDir, importSpecifier);
    // Make relative to workspace
    resolved = path.relative(workspaceRoot, resolved);

    // Try direct match
    if (allFiles.has(resolved)) return resolved;

    // Try with extensions
    for (const ext of IMPORT_EXTENSIONS) {
        if (allFiles.has(resolved + ext)) return resolved + ext;
    }

    // Try as directory with index file
    for (const ext of IMPORT_EXTENSIONS) {
        const indexPath = path.join(resolved, `index${ext}`);
        if (allFiles.has(indexPath)) return indexPath;
    }

    return null;
}

/**
 * Resolve a Python import to an actual file path.
 */
export function resolvePythonImport(
    importModule: string,
    sourceFile: string,
    allFiles: Set<string>,
    workspaceRoot: string
): string | null {
    // Convert dotted module path to file path
    const parts = importModule.split('.');

    // Try as direct file
    const asFile = parts.join('/') + '.py';
    if (allFiles.has(asFile)) return asFile;

    // Try as package (__init__.py)
    const asPackage = parts.join('/') + '/__init__.py';
    if (allFiles.has(asPackage)) return asPackage;

    // Try relative to source file's directory
    const sourceDir = path.dirname(sourceFile);
    const relFile = path.join(sourceDir, parts.join('/') + '.py');
    const normalized = path.normalize(relFile);
    if (allFiles.has(normalized)) return normalized;

    const relPackage = path.join(sourceDir, parts.join('/'), '__init__.py');
    const normalizedPkg = path.normalize(relPackage);
    if (allFiles.has(normalizedPkg)) return normalizedPkg;

    return null;
}

/**
 * Detect circular dependencies using DFS.
 */
export function detectCycles(edges: ImportEdge[]): string[][] {
    const adjacency = new Map<string, string[]>();
    for (const edge of edges) {
        if (!adjacency.has(edge.source)) adjacency.set(edge.source, []);
        adjacency.get(edge.source)!.push(edge.target);
    }

    const visited = new Set<string>();
    const inStack = new Set<string>();
    const cycles: string[][] = [];

    function dfs(node: string, path: string[]) {
        if (inStack.has(node)) {
            // Found a cycle — extract it
            const cycleStart = path.indexOf(node);
            if (cycleStart !== -1) {
                cycles.push(path.slice(cycleStart));
            }
            return;
        }
        if (visited.has(node)) return;

        visited.add(node);
        inStack.add(node);
        path.push(node);

        const neighbors = adjacency.get(node) || [];
        for (const neighbor of neighbors) {
            dfs(neighbor, [...path]);
        }

        inStack.delete(node);
    }

    for (const node of adjacency.keys()) {
        if (!visited.has(node)) {
            dfs(node, []);
        }
    }

    // Deduplicate cycles
    const uniqueCycles: string[][] = [];
    const seen = new Set<string>();
    for (const cycle of cycles) {
        const sorted = [...cycle].sort().join('|');
        if (!seen.has(sorted)) {
            seen.add(sorted);
            uniqueCycles.push(cycle);
        }
    }

    return uniqueCycles;
}
