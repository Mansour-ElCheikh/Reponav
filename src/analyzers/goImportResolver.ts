/**
 * Go Import Resolver
 *
 * Resolves Go import paths in three categories:
 *   - Standard library (e.g. "fmt", "net/http") → "stdlib:<pkg>"
 *   - Same-module relative paths (e.g. "./utils") → directory-relative path
 *   - go.mod module-path imports → strip module prefix for internal, "external:<path>" for third-party
 *
 * NO vscode imports. Fully testable outside VS Code.
 */

import * as path from 'path';
import type { ImportEdge } from '../types';

// Standard library top-level package names (first path segment determines stdlib status)
const STDLIB_PACKAGES = new Set([
    'bufio', 'bytes', 'context', 'crypto', 'database', 'debug', 'embed', 'encoding',
    'errors', 'expvar', 'flag', 'fmt', 'go', 'hash', 'html', 'image', 'io', 'log',
    'math', 'mime', 'net', 'os', 'path', 'plugin', 'reflect', 'regexp', 'runtime',
    'sort', 'strconv', 'strings', 'sync', 'syscall', 'testing', 'text', 'time',
    'unicode', 'unsafe',
]);

/** Returns true if the import path is a Go standard library package. */
function isStdlib(importPath: string): boolean {
    const topLevel = importPath.split('/')[0];
    if (!topLevel) return false;
    // stdlib packages have no dots in the top-level segment
    return STDLIB_PACKAGES.has(topLevel) || !topLevel.includes('.');
}

/**
 * Resolve a list of Go import path strings for a given source file.
 * Returns ImportEdge records for each import.
 *
 * @param sourceFile   - Relative path of the Go source file (e.g. "cmd/main.go")
 * @param workspaceRoot - Absolute path to the workspace root (used for relative resolution)
 * @param importPaths  - Raw import path strings parsed from the source file
 * @param moduleName   - The module name declared in go.mod (e.g. "github.com/user/repo"), or null
 */
export function resolveGoImports(
    sourceFile: string,
    workspaceRoot: string,
    importPaths: string[],
    moduleName: string | null
): ImportEdge[] {
    return importPaths.map((importPath) => {
        let target: string;

        if (importPath.startsWith('./') || importPath.startsWith('../')) {
            // Relative path within same package/module
            const sourceDir = path.dirname(sourceFile);
            const resolved = path.normalize(path.join(sourceDir, importPath));
            target = resolved;
        } else if (moduleName && importPath.startsWith(moduleName + '/')) {
            // Internal module import: strip module name prefix
            target = importPath.slice(moduleName.length + 1);
        } else if (moduleName && importPath === moduleName) {
            target = '.';
        } else if (isStdlib(importPath)) {
            target = `stdlib:${importPath}`;
        } else {
            // Third-party external dependency
            target = `external:${importPath}`;
        }

        return {
            source: sourceFile,
            target,
            specifiers: [importPath],
            isDynamic: false,
            rawStatement: importPath,
        };
    });
}
