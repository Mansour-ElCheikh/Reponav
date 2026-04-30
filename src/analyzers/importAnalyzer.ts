/**
 * Import/Dependency Analyzer
 * 
 * Parses import/require/from statements across JS, TS, Python, Go, Java, and Rust files.
 * Builds a complete dependency graph with real edges — no AI hallucination.
 */

import * as path from 'path';
import { ImportEdge } from '../types';
import { AnalysisProvider, ImportAnalysisOptions, ImportAnalysisResult } from './AnalysisProvider';
import { detectCycles, resolveJsImport, resolvePythonImport } from './utils';

// ─── Import Patterns by Language ─────────────────────────────────────────────

const IMPORT_PATTERNS: Record<string, RegExp[]> = {
    // JavaScript / TypeScript
    'javascript': [
        // import X from 'Y'
        /import\s+(\w+)\s+from\s+['"]([^'"]+)['"]/g,
        // import { X, Y } from 'Z'
        /import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]/g,
        // import * as X from 'Y'
        /import\s+\*\s+as\s+(\w+)\s+from\s+['"]([^'"]+)['"]/g,
        // import 'Y' (side-effect)
        /import\s+['"]([^'"]+)['"]/g,
        // const X = require('Y')
        /(?:const|let|var)\s+(?:(\w+)|\{([^}]+)\})\s*=\s*require\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
        // dynamic import('Y')
        /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
        // export { X } from 'Y'
        /export\s+\{[^}]*\}\s+from\s+['"]([^'"]+)['"]/g,
        // export * from 'Y'
        /export\s+\*\s+from\s+['"]([^'"]+)['"]/g,
    ],
    // Python
    'python': [
        // from X import Y
        /from\s+([\w.]+)\s+import\s+(.+)/g,
        // import X
        /^import\s+([\w.]+(?:\s*,\s*[\w.]+)*)/gm,
    ],
    // Go
    'go': [
        // import "X"
        /import\s+"([^"]+)"/g,
        // import ( "X" )
        /import\s*\(\s*((?:"[^"]+"\s*(?:\n\s*)?)+)\s*\)/g,
    ],
    // Java / Kotlin
    'java': [
        /import\s+(?:static\s+)?([a-zA-Z_][\w.]*(?:\.\*)?)\s*;/g,
    ],
    // Rust
    'rust': [
        /use\s+([\w:]+(?:::\{[^}]+\})?)\s*;/g,
        /mod\s+(\w+)\s*;/g,
    ],
};

// Map file extensions to language keys
const EXT_TO_LANG: Record<string, string> = {
    '.js': 'javascript',
    '.jsx': 'javascript',
    '.ts': 'javascript',
    '.tsx': 'javascript',
    '.mjs': 'javascript',
    '.cjs': 'javascript',
    '.vue': 'javascript',
    '.svelte': 'javascript',
    '.py': 'python',
    '.go': 'go',
    '.java': 'java',
    '.kt': 'java',
    '.kts': 'java',
    '.rs': 'rust',
};



/**
 * Extract import specifiers from a line of code.
 */
function extractSpecifiers(match: RegExpMatchArray, lang: string): string[] {
    // For JS/TS: match groups contain the imported names
    const specifiers: string[] = [];
    for (let i = 1; i < match.length - 1; i++) {
        const group = match[i];
        if (group && !group.includes('/') && !group.includes('.')) {
            specifiers.push(
                ...group.split(',').map((s) => s.trim().replace(/\s+as\s+\w+/, ''))
            );
        }
    }
    return specifiers.filter(Boolean);
}

// ─── Main Analyzer ───────────────────────────────────────────────────────────

/** Regex-based fallback import analyzer used when tree-sitter is unavailable. */
export class RegexAnalysisProvider implements AnalysisProvider {
    /**
     * Analyze all imports in the workspace and build a dependency graph.
     */
    async analyzeImports(
        workspaceRoot: string,
        files: Map<string, string>, // path -> content
        _options?: ImportAnalysisOptions
    ): Promise<ImportAnalysisResult> {
        const allFilePaths = new Set(files.keys());
        const edges: ImportEdge[] = [];
        const externalDeps = new Set<string>();

        for (const [filePath, content] of files) {
            const ext = path.extname(filePath);
            const lang = EXT_TO_LANG[ext];
            if (!lang) continue;

            const patterns = IMPORT_PATTERNS[lang];
            if (!patterns) continue;

            for (const pattern of patterns) {
                // Reset regex lastIndex
                const regex = new RegExp(pattern.source, pattern.flags);
                let match: RegExpExecArray | null;

                while ((match = regex.exec(content)) !== null) {
                    const rawStatement = match[0];
                    const isDynamic = rawStatement.includes('import(');

                    // Extract the module specifier (last capture group is usually the path)
                    let moduleSpecifier: string | null = null;
                    const specifiers: string[] = [];

                    if (lang === 'javascript') {
                        // Find the path-like capture group
                        for (let i = match.length - 1; i >= 1; i--) {
                            const group = match[i];
                            if (group && (group.includes('/') || group.includes('.') || group.startsWith('@') || !group.includes(' '))) {
                                if (group.includes('/') || group.startsWith('.') || group.startsWith('@') || /^[\w@-]+$/.test(group)) {
                                    moduleSpecifier = group;
                                    break;
                                }
                            }
                        }
                        // Collect named specifiers from other groups
                        for (let i = 1; i < match.length; i++) {
                            if (match[i] && match[i] !== moduleSpecifier) {
                                specifiers.push(
                                    ...match[i].split(',').map((s: string) => s.trim()).filter(Boolean)
                                );
                            }
                        }
                    } else if (lang === 'python') {
                        moduleSpecifier = match[1];
                        if (match[2]) {
                            specifiers.push(
                                ...match[2].split(',').map((s: string) => s.trim().replace(/\s+as\s+\w+/, '')).filter(Boolean)
                            );
                        }
                    } else {
                        moduleSpecifier = match[1];
                    }

                    if (!moduleSpecifier) continue;

                    // Resolve to actual file path
                    let resolved: string | null = null;
                    if (lang === 'javascript') {
                        resolved = resolveJsImport(moduleSpecifier, filePath, allFilePaths, workspaceRoot);
                    } else if (lang === 'python') {
                        resolved = resolvePythonImport(moduleSpecifier, filePath, allFilePaths, workspaceRoot);
                    }

                    if (resolved) {
                        edges.push({
                            source: filePath,
                            target: resolved,
                            specifiers,
                            isDynamic,
                            rawStatement,
                        });
                    } else if (lang === 'javascript' && !moduleSpecifier.startsWith('.')) {
                        // External npm package
                        const pkgName = moduleSpecifier.startsWith('@')
                            ? moduleSpecifier.split('/').slice(0, 2).join('/')
                            : moduleSpecifier.split('/')[0];
                        externalDeps.add(pkgName);
                    }
                }
            }
        }

        // Detect circular dependencies
        const circularDependencies = detectCycles(edges);

        return {
            edges,
            externalDependencies: externalDeps,
            circularDependencies,
        };
    }
}

