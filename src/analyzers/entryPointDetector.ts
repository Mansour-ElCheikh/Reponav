/**
 * Entry Point Detector
 * 
 * Finds main files, route handlers, CLI commands, and config files
 * using manifest parsing + heuristic patterns. No AI involved.
 */

import * as path from 'path';
import { EntryPoint } from '../types';
import { inferEntrySurface } from './entrySurface';

// ─── Manifest-based detection (HIGH confidence) ─────────────────────────────

interface ManifestParser {
    file: string;
    parse: (content: string, allFiles: Set<string>) => EntryPoint[];
}

const MANIFEST_PARSERS: ManifestParser[] = [
    // package.json
    {
        file: 'package.json',
        parse: (content: string, allFiles: Set<string>): EntryPoint[] => {
            const entries: EntryPoint[] = [];
            try {
                const pkg = JSON.parse(content);

                // "main" field
                if (pkg.main && allFiles.has(pkg.main)) {
                    entries.push({
                        file: pkg.main,
                        type: 'main',
                        entrySurface: inferEntrySurface(pkg.main),
                        confidence: 'high',
                        reason: 'package.json "main" field',
                    });
                }

                // "scripts.start" can reference a file
                if (pkg.scripts?.start) {
                    const startMatch = pkg.scripts.start.match(/(?:node|ts-node|tsx)\s+(\S+)/);
                    if (startMatch && allFiles.has(startMatch[1])) {
                        entries.push({
                            file: startMatch[1],
                            type: 'main',
                            entrySurface: inferEntrySurface(startMatch[1]),
                            confidence: 'high',
                            reason: 'package.json "scripts.start"',
                        });
                    }
                }

                // "bin" field (CLI entry points)
                if (pkg.bin) {
                    const bins = typeof pkg.bin === 'string' ? { [pkg.name]: pkg.bin } : pkg.bin;
                    for (const [, binPath] of Object.entries(bins)) {
                        if (typeof binPath === 'string' && allFiles.has(binPath)) {
                            entries.push({
                                file: binPath,
                                type: 'cli',
                                entrySurface: inferEntrySurface(binPath),
                                confidence: 'high',
                                reason: 'package.json "bin" field',
                            });
                        }
                    }
                }
            } catch {
                // Invalid JSON
            }
            return entries;
        },
    },

    // pyproject.toml
    {
        file: 'pyproject.toml',
        parse: (content: string, allFiles: Set<string>): EntryPoint[] => {
            const entries: EntryPoint[] = [];

            // [tool.poetry.scripts] or [project.scripts]
            const scriptMatch = content.match(/\[(?:tool\.poetry\.scripts|project\.scripts)\]\s*\n([\s\S]*?)(?:\n\[|\n$)/);
            if (scriptMatch) {
                const lines = scriptMatch[1].split('\n');
                for (const line of lines) {
                    const m = line.match(/\w+\s*=\s*"([^"]+)"/);
                    if (m) {
                        // "module:function" → "module.py"
                        const modulePath = m[1].split(':')[0].replace(/\./g, '/') + '.py';
                        if (allFiles.has(modulePath)) {
                            entries.push({
                                file: modulePath,
                                type: 'cli',
                                entrySurface: inferEntrySurface(modulePath),
                                confidence: 'high',
                                reason: 'pyproject.toml scripts entry',
                            });
                        }
                    }
                }
            }

            return entries;
        },
    },

    // Cargo.toml
    {
        file: 'Cargo.toml',
        parse: (content: string, allFiles: Set<string>): EntryPoint[] => {
            const entries: EntryPoint[] = [];

            // [[bin]] sections or default src/main.rs
            if (allFiles.has('src/main.rs')) {
                entries.push({
                    file: 'src/main.rs',
                    type: 'main',
                    entrySurface: inferEntrySurface('src/main.rs'),
                    confidence: 'high',
                    reason: 'Rust default binary entry point',
                });
            }
            if (allFiles.has('src/lib.rs')) {
                entries.push({
                    file: 'src/lib.rs',
                    type: 'main',
                    entrySurface: inferEntrySurface('src/lib.rs'),
                    confidence: 'high',
                    reason: 'Rust library entry point',
                });
            }

            return entries;
        },
    },
];

// ─── Heuristic exclusion filter ─────────────────────────────────────────────

/** Basenames excluded from heuristic (pattern + content) entry-point detection. */
const HEURISTIC_EXCLUDED_BASENAMES = /\.(test|spec)\.(ts|js|tsx|jsx|py|go|rs)$/;

/** Full paths excluded from heuristic (pattern + content) entry-point detection. */
const HEURISTIC_EXCLUDED_PATHS = [
    /^tsconfig(?:\.\S+)?\.json$/,
    /^vite\.config\.(ts|js|mjs)$/,
    /^webpack\.config\.(ts|js|mjs)$/,
    /^playwright\.config\.(ts|js|mjs)$/,
    /^jest\.config\.(ts|js|mjs|cjs)$/,
    /^esbuild\.(js|mjs|cjs)$/,
];

const HEURISTIC_EXCLUDED_ROOTS = [
    'docs/',
    'presentation/',
    'presentation-v2/',
    'scripts/',
    'media/',
    'test-results/',
    'dev/',
];

const DEFAULT_TYPE_SORT_ORDER = 5;

/** Returns true if `filePath` should be skipped in heuristic pattern + content matching. */
function isHeuristicExcluded(filePath: string): boolean {
    const normalizedPath = filePath.replace(/\\/g, '/');
    const basename = normalizedPath.split('/').pop() ?? '';
    if (HEURISTIC_EXCLUDED_BASENAMES.test(basename)) return true;
    if (HEURISTIC_EXCLUDED_ROOTS.some((prefix) => normalizedPath.startsWith(prefix))) return true;
    const normalized = normalizedPath.replace(/^.*\//, '');
    return HEURISTIC_EXCLUDED_PATHS.some(re => re.test(normalized));
}

// ─── Heuristic-based detection (MEDIUM confidence) ──────────────────────────

/** File patterns that strongly suggest entry points */
const ENTRY_POINT_PATTERNS: Array<{
    pattern: RegExp;
    type: EntryPoint['type'];
    confidence: EntryPoint['confidence'];
    reason: string;
}> = [
        // Main application files
        { pattern: /^(?:src\/)?main\.(ts|js|py|go|rs)$/, type: 'main', confidence: 'medium', reason: 'Conventional main file' },
        { pattern: /^(?:src\/)?index\.(ts|js|tsx|jsx)$/, type: 'main', confidence: 'medium', reason: 'Conventional index file' },
        { pattern: /^(?:src\/)?app\.(ts|js|tsx|jsx|py)$/, type: 'main', confidence: 'medium', reason: 'Conventional app file' },
        { pattern: /^(?:src\/)?server\.(ts|js)$/, type: 'main', confidence: 'medium', reason: 'Server entry point' },

        // Framework-specific
        { pattern: /^app\/layout\.(tsx|jsx|js)$/, type: 'main', confidence: 'high', reason: 'Next.js App Router root layout' },
        { pattern: /^pages\/_app\.(tsx|jsx|js)$/, type: 'main', confidence: 'high', reason: 'Next.js Pages Router custom app' },
        { pattern: /^app\/page\.(tsx|jsx|js)$/, type: 'route', confidence: 'high', reason: 'Next.js App Router root page' },
        { pattern: /^manage\.py$/, type: 'cli', confidence: 'high', reason: 'Django management script' },
        { pattern: /^cmd\/\w+\/main\.go$/, type: 'main', confidence: 'high', reason: 'Go cmd entry point' },

        // Route handlers
        { pattern: /^app\/api\/.*route\.(ts|js)$/, type: 'route', confidence: 'high', reason: 'Next.js API route' },
        { pattern: /^pages\/api\/.*\.(ts|js)$/, type: 'route', confidence: 'high', reason: 'Next.js Pages API route' },
        { pattern: /routes?\.(ts|js)$/, type: 'route', confidence: 'medium', reason: 'Route definition file' },

        // Config files
        { pattern: /^next\.config\.(ts|js|mjs)$/, type: 'config', confidence: 'high', reason: 'Next.js configuration' },
        { pattern: /^vite\.config\.(ts|js)$/, type: 'config', confidence: 'high', reason: 'Vite configuration' },
        { pattern: /^webpack\.config\.(ts|js)$/, type: 'config', confidence: 'high', reason: 'Webpack configuration' },
        { pattern: /^tsconfig\.json$/, type: 'config', confidence: 'medium', reason: 'TypeScript configuration' },
    ];

// ─── Content-based detection (check file content for indicators) ─────────────

const CONTENT_INDICATORS: Array<{
    pattern: RegExp;
    type: EntryPoint['type'];
    confidence: EntryPoint['confidence'];
    reason: string;
    extensions?: string[];
}> = [
        // Express/Fastify server listen
        { pattern: /\.listen\s*\(\s*(?:PORT|port|\d{4})/, type: 'main', confidence: 'medium', reason: 'Server .listen() call detected', extensions: ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'] },
        // FastAPI/Flask app definition
        { pattern: /(?:FastAPI|Flask)\s*\(/, type: 'main', confidence: 'high', reason: 'Python web framework app initialization', extensions: ['.py'] },
        // CLI frameworks
        { pattern: /\b(?:commander|yargs|meow)\s*\./, type: 'cli', confidence: 'medium', reason: 'CLI framework usage', extensions: ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'] },
        { pattern: /\barg\s*\(/, type: 'cli', confidence: 'medium', reason: 'CLI framework usage', extensions: ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'] },
        { pattern: /if\s+__name__\s*==\s*['"]__main__['"]/, type: 'main', confidence: 'medium', reason: 'Python __main__ guard', extensions: ['.py'] },
    ];

function matchesExtension(filePath: string, extensions?: string[]): boolean {
    if (!extensions || extensions.length === 0) return true;
    return extensions.includes(path.extname(filePath).toLowerCase());
}

// ─── Main Detector ───────────────────────────────────────────────────────────

export async function detectEntryPoints(
    files: Map<string, string> // path -> content
): Promise<EntryPoint[]> {
    const allFilePaths = new Set(files.keys());
    const entries: EntryPoint[] = [];
    const foundFiles = new Set<string>();

    // 1. Manifest-based detection (highest confidence)
    for (const parser of MANIFEST_PARSERS) {
        const content = files.get(parser.file);
        if (content) {
            const found = parser.parse(content, allFilePaths);
            for (const entry of found) {
                if (!foundFiles.has(entry.file)) {
                    entries.push(entry);
                    foundFiles.add(entry.file);
                }
            }
        }
    }

    // 2. Pattern-based detection
    for (const filePath of allFilePaths) {
        if (foundFiles.has(filePath)) continue;
        if (isHeuristicExcluded(filePath)) continue;

        for (const { pattern, type, confidence, reason } of ENTRY_POINT_PATTERNS) {
            if (pattern.test(filePath)) {
                entries.push({
                    file: filePath,
                    type,
                    entrySurface: inferEntrySurface(filePath),
                    confidence,
                    reason,
                });
                foundFiles.add(filePath);
                break;
            }
        }
    }

    // 3. Content-based detection (for files not already identified)
    for (const [filePath, content] of files) {
        if (foundFiles.has(filePath)) continue;
        if (isHeuristicExcluded(filePath)) continue;

        for (const { pattern, type, confidence, reason, extensions } of CONTENT_INDICATORS) {
            if (matchesExtension(filePath, extensions) && pattern.test(content)) {
                entries.push({
                    file: filePath,
                    type,
                    entrySurface: inferEntrySurface(filePath),
                    confidence,
                    reason,
                });
                foundFiles.add(filePath);
                break;
            }
        }
    }

    // Sort by confidence (high first), then by type priority
    const confidenceOrder: Record<string, number> = { high: 0, medium: 1, low: 2 };
    const typeOrder: Record<string, number> = { main: 0, route: 1, cli: 2, config: 3, test: 4 };

    entries.sort((a, b) => {
        const confDiff = confidenceOrder[a.confidence] - confidenceOrder[b.confidence];
        if (confDiff !== 0) return confDiff;
        return (typeOrder[a.type] || DEFAULT_TYPE_SORT_ORDER) - (typeOrder[b.type] || DEFAULT_TYPE_SORT_ORDER);
    });

    return entries;
}
