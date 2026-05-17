import * as fs from 'fs';
import * as path from 'path';

const wasmCache = new Map<string, string>();

/**
 * Locate the WASM directory across runtime layouts:
 * - Bundled extension at <ext>/dist/extension.js → __dirname = dist/, wasm at dist/wasm/
 * - Bundled bin at <ext>/dist/bin/{reponav,mcp}.js → __dirname = dist/bin/, wasm at ../wasm/
 * - Src-mode tests at src/utils/wasmLocator.ts → __dirname = src/utils/, wasm at ../../wasm/
 * - Src-mode analyzers at src/analyzers/ → __dirname = src/analyzers/, wasm at ../../wasm/
 */
export function getWasmDirectory(requiredFiles: string[] = []): string {
    const cacheKey = [...requiredFiles].sort().join('\0');
    const cached = wasmCache.get(cacheKey);
    if (cached) return cached;

    const candidateDirs = [
        path.join(__dirname, 'wasm'),                  // bundled dist/extension.js
        path.join(__dirname, '..', 'wasm'),            // bundled dist/bin/* OR src/utils/
        path.join(__dirname, '..', '..', 'wasm'),      // src/utils/ legacy + src/analyzers/
    ];

    for (const candidate of candidateDirs) {
        if (!fs.existsSync(candidate)) continue;

        const hasAllRequiredFiles = requiredFiles.every((fileName) => {
            return fs.existsSync(path.join(candidate, fileName));
        });

        if (hasAllRequiredFiles) {
            wasmCache.set(cacheKey, candidate);
            return candidate;
        }
    }

    const required = requiredFiles.length > 0 ? ` with files: ${requiredFiles.join(', ')}` : '';
    throw new Error(
        `Unable to locate WASM directory${required}. Checked: ${candidateDirs.join(', ')}`
    );
}

/** Clears the memoized WASM directory lookup cache for tests and re-init flows. */
export function clearWasmCache(): void {
    wasmCache.clear();
}
