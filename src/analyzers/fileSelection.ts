/**
 * File Selection
 *
 * Candidate path collection, filtering, prioritization, and deduplication
 * for workspace analysis. Extracted from analyzers/index.ts.
 *
 * NO vscode imports — depends only on WorkspaceAdapter.
 */

import type { WorkspaceAdapter } from '../WorkspaceAdapter';

// ─── Types ───────────────────────────────────────────────────────────────────

/** Scope of analysis — interactive (quick, preferred roots) or full workspace scan. */
export type AnalysisScope = 'interactive' | 'fullWorkspace';

/** Options controlling file selection for analysis. */
export interface AnalysisOptions {
    scope?: AnalysisScope;
    maxFiles?: number;
    preferredRoots?: string[];
    candidatePaths?: string[];
}

// ─── Constants ───────────────────────────────────────────────────────────────

const PERF_LOG_PREFIX = '[RepoNav][perf][fileSelection]';

/** Default interactive file cap when no user config is set. */
export const DEFAULT_INTERACTIVE_MAX_FILES = 500;

// Interactive scans oversample candidates to preserve prioritization quality before capping.
const INTERACTIVE_OVERSCAN_MULTIPLIER = 4;
const FULL_WORKSPACE_OVERSCAN_MULTIPLIER = 6;
const OVERSCAN_BUFFER = 200;
const TOP_PRIORITY_FILE_SCORE = -100;
const DEFAULT_PATH_PRIORITY_SCORE = 100;
const PACKAGES_SRC_MIN_SEGMENTS = 4;
const PACKAGES_ROOT_SEGMENT_INDEX = 0;
const PACKAGES_SOURCE_SEGMENT_INDEX = 2;
const PREFERRED_ROOT_PRIORITY_STEP = 10;
const LOW_SIGNAL_SEGMENT_PENALTY = 100;
const FULL_WORKSPACE_LOW_SIGNAL_DIVISOR = 4;

/** Files and directories to always skip. */
export const IGNORE_PATTERNS = [
    'node_modules', '.git', '.next', '__pycache__', '.pytest_cache',
    'dist', 'build', '.cache', 'coverage', '.venv', 'venv', 'env',
    '.env', '.DS_Store', 'package-lock.json', 'yarn.lock',
    'pnpm-lock.yaml', 'Cargo.lock', 'go.sum', '*.min.js', '*.map', '*.chunk.*',
    '.reponav',  // exclude RepoNav's own data dir (tours, DB, hooks) from analysis
];

/** Binary/non-code extensions to skip. */
export const BINARY_EXTENSIONS = new Set([
    '.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', '.webp',
    '.mp4', '.mp3', '.webm', '.ogg', '.wav',
    '.woff', '.woff2', '.ttf', '.eot',
    '.zip', '.tar', '.gz', '.br',
    '.pdf', '.doc', '.docx',
    '.exe', '.dll', '.so', '.dylib',
    '.pyc', '.pyo', '.wasm',
]);

/** Code extensions worth analyzing. Anything not in this set is excluded during candidate collection. */
export const CODE_EXTENSIONS = new Set([
    '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
    '.py', '.pyi',
    '.json', '.yaml', '.yml', '.toml',
    '.html', '.css', '.scss', '.less',
    '.rs', '.go', '.java', '.kt', '.swift', '.c', '.cpp', '.h', '.hpp',
    '.sh', '.bash', '.zsh',
    '.sql',
    '.graphql', '.gql',
    '.vue', '.svelte',
    '.prisma',
]);

/** Marker files that indicate a project root directory. */
const PROJECT_ROOT_MARKERS = ['package.json', 'pyproject.toml', 'Cargo.toml', 'go.mod', '.git'];

/** Default root directories to prioritize in file selection. */
export const DEFAULT_PREFERRED_ROOTS = [
    'src',
    'webview/src',
    'shared',
    'app',
    'lib',
    'server',
    'client',
    'packages/*/src',
];

const LOW_SIGNAL_SEGMENTS = new Set([
    'docs',
    'example',
    'examples',
    'fixture',
    'fixtures',
    'test',
    'tests',
    '__tests__',
    'bench',
    'benchmark',
    'benchmarks',
    '_legacy',
]);

const EXCLUDED_ROOT_SEGMENTS = new Set([
    'test-repos',
]);

/** Files that should always appear first in selection order. */
export const PRIORITY_FILES = [
    'package.json',
    'pyproject.toml',
    'Cargo.toml',
    'go.mod',
    'README.md',
    'Dockerfile',
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Merge user-provided options with defaults. */
export function normalizeAnalysisOptions(adapter: WorkspaceAdapter, options?: AnalysisOptions): Required<AnalysisOptions> {
    const scope = options?.scope ?? 'interactive';
    return {
        scope,
        maxFiles: options?.maxFiles
            ?? (scope === 'fullWorkspace'
                ? Number.MAX_SAFE_INTEGER
                : adapter.getConfig<number>('reponav', 'maxFilesToAnalyze', DEFAULT_INTERACTIVE_MAX_FILES)),
        preferredRoots: options?.preferredRoots ?? DEFAULT_PREFERRED_ROOTS,
        candidatePaths: options?.candidatePaths ?? [],
    };
}

/** Build a glob pattern that excludes noise directories and files. */
export function buildExcludePattern(): string {
    return `{${IGNORE_PATTERNS.map((pattern) => `**/${pattern}`).join(',')}}`;
}

/** Score a file path for selection priority (lower = higher priority). */
export function getPathPriority(filePath: string, scope: AnalysisScope, preferredRoots: string[]): number {
    const normalizedPath = filePath.replace(/\\/g, '/');
    const segments = normalizedPath.split('/');
    if (PRIORITY_FILES.includes(normalizedPath)) {
        return TOP_PRIORITY_FILE_SCORE;
    }
    let score = DEFAULT_PATH_PRIORITY_SCORE;

    const preferredIndex = preferredRoots.findIndex((root) => {
        if (root === 'packages/*/src') {
            return segments.length >= PACKAGES_SRC_MIN_SEGMENTS
                && segments[PACKAGES_ROOT_SEGMENT_INDEX] === 'packages'
                && segments[PACKAGES_SOURCE_SEGMENT_INDEX] === 'src';
        }
        return normalizedPath === root || normalizedPath.startsWith(`${root}/`);
    });

    if (preferredIndex !== -1) {
        score = preferredIndex * PREFERRED_ROOT_PRIORITY_STEP;
    }

    const lowSignalPenalty = segments.reduce((penalty, segment) => {
        return penalty + (LOW_SIGNAL_SEGMENTS.has(segment) ? LOW_SIGNAL_SEGMENT_PENALTY : 0);
    }, 0);

    if (scope === 'interactive') {
        score += lowSignalPenalty;
    } else {
        score += Math.floor(lowSignalPenalty / FULL_WORKSPACE_LOW_SIGNAL_DIVISOR);
    }

    return score;
}

/** Remove duplicate paths while preserving order. */
export function dedupePaths(paths: string[]): string[] {
    const unique: string[] = [];
    const seen = new Set<string>();

    for (const filePath of paths) {
        if (seen.has(filePath)) continue;
        seen.add(filePath);
        unique.push(filePath);
    }

    return unique;
}

/** Check if a path contains an excluded root segment (e.g., test-repos). */
export function isExcludedPath(filePath: string): boolean {
    const segments = filePath.replace(/\\/g, '/').split('/');
    return segments.some((segment) => EXCLUDED_ROOT_SEGMENTS.has(segment));
}

/** Check if a file has a recognized code extension. Priority files (package.json etc.) always pass. */
export function isCodeFile(filePath: string): boolean {
    const fileName = filePath.split('/').pop() ?? filePath;
    if (PRIORITY_FILES.includes(fileName)) return true;
    const lastDot = fileName.lastIndexOf('.');
    if (lastDot === -1) return false;
    return CODE_EXTENSIONS.has(fileName.slice(lastDot));
}

/**
 * Walk down from the workspace root to find the actual project root.
 * Returns the first directory containing a project marker (package.json, .git, etc).
 * If the workspace root itself has a marker, returns it unchanged.
 */
export async function resolveProjectRoot(adapter: WorkspaceAdapter): Promise<string | null> {
    const wsRoot = adapter.getWorkspaceRoot();
    if (!wsRoot) return null;
    for (const marker of PROJECT_ROOT_MARKERS) {
        const matches = await adapter.findFiles(marker, '', 1);
        if (matches.length > 0) return wsRoot;
    }
    // No marker at root — look one level down for nested project
    for (const marker of PROJECT_ROOT_MARKERS) {
        const matches = await adapter.findFiles(`*/${marker}`, '', 1);
        if (matches.length > 0) {
            const matchPath = matches[0].replace(/\\/g, '/');
            return matchPath.split('/').slice(0, -1).join('/') || wsRoot;
        }
    }
    return wsRoot;
}

// ─── Main ────────────────────────────────────────────────────────────────────

/**
 * Collect and rank candidate file paths for analysis.
 * Priority files appear first, then files are ranked by path priority
 * and capped at maxFiles.
 */
export async function collectCandidatePaths(
    adapter: WorkspaceAdapter,
    options: Required<AnalysisOptions>
): Promise<string[]> {
    if (options.candidatePaths.length > 0) {
        return options.candidatePaths;
    }

    const collectStart = performance.now();
    const excludePattern = buildExcludePattern();
    const candidatePaths: string[] = [];

    for (const filePath of PRIORITY_FILES) {
        const matches = await adapter.findFiles(filePath, excludePattern, 1);
        candidatePaths.push(...matches);
    }

    const overscanMultiplier = options.scope === 'interactive'
        ? INTERACTIVE_OVERSCAN_MULTIPLIER
        : FULL_WORKSPACE_OVERSCAN_MULTIPLIER;
    const overscan = Math.max(options.maxFiles * overscanMultiplier, options.maxFiles + OVERSCAN_BUFFER);
    candidatePaths.push(...await adapter.findFiles('**/*', excludePattern, overscan));

    const deduped = dedupePaths(candidatePaths);
    const filtered = deduped.filter((filePath) => !isExcludedPath(filePath) && isCodeFile(filePath));

    filtered.sort((a, b) => {
        const priorityDiff = getPathPriority(a, options.scope, options.preferredRoots)
            - getPathPriority(b, options.scope, options.preferredRoots);
        return priorityDiff !== 0 ? priorityDiff : a.localeCompare(b);
    });

    const selected = filtered.slice(0, options.maxFiles);
    console.error(`${PERF_LOG_PREFIX} collectCandidatePaths: ${(performance.now() - collectStart).toFixed(1)}ms`, {
        scope: options.scope,
        candidates: candidatePaths.length,
        selected: selected.length,
    });
    return selected;
}
