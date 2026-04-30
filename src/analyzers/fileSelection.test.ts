import { describe, it, expect } from 'vitest';
import {
    isCodeFile,
    isExcludedPath,
    dedupePaths,
    getPathPriority,
    buildExcludePattern,
    DEFAULT_INTERACTIVE_MAX_FILES,
    IGNORE_PATTERNS,
    BINARY_EXTENSIONS,
    CODE_EXTENSIONS,
    normalizeAnalysisOptions,
} from './fileSelection';

describe('fileSelection', () => {
    it('isCodeFile returns true for .ts files', () => {
        expect(isCodeFile('src/index.ts')).toBe(true);
    });

    it('isCodeFile returns false for binary extensions', () => {
        expect(isCodeFile('image.png')).toBe(false);
    });

    it('isExcludedPath excludes test-repos', () => {
        expect(isExcludedPath('test-repos/sample/index.js')).toBe(true);
    });

    it('isExcludedPath allows normal paths', () => {
        expect(isExcludedPath('src/index.ts')).toBe(false);
    });

    it('dedupePaths removes duplicate paths', () => {
        const result = dedupePaths(['a.ts', 'b.ts', 'a.ts']);
        expect(result).toEqual(['a.ts', 'b.ts']);
    });

    it('getPathPriority returns lower score (higher priority) for preferred roots', () => {
        const srcPriority = getPathPriority('src/index.ts', 'interactive', ['src']);
        const vendorPriority = getPathPriority('vendor/lib.ts', 'interactive', ['src']);
        expect(srcPriority).toBeLessThan(vendorPriority);
    });

    it('getPathPriority keeps priority files at the current top-priority score', () => {
        expect(getPathPriority('package.json', 'interactive', ['src'])).toBe(-100);
    });

    it('getPathPriority spaces preferred roots by the current 10-point buckets', () => {
        const firstPreferred = getPathPriority('src/index.ts', 'interactive', ['src', 'lib']);
        const secondPreferred = getPathPriority('lib/index.ts', 'interactive', ['src', 'lib']);

        expect(firstPreferred).toBe(0);
        expect(secondPreferred).toBe(10);
    });

    it('getPathPriority applies the current low-signal penalty per segment in interactive scope', () => {
        expect(getPathPriority('docs/examples/guide.ts', 'interactive', [])).toBe(300);
    });

    it('getPathPriority discounts the current low-signal penalty in fullWorkspace scope', () => {
        expect(getPathPriority('docs/examples/guide.ts', 'fullWorkspace', [])).toBe(150);
    });

    it('buildExcludePattern returns a non-empty string', () => {
        expect(buildExcludePattern().length).toBeGreaterThan(0);
    });

    it('IGNORE_PATTERNS is a non-empty array', () => {
        expect(IGNORE_PATTERNS.length).toBeGreaterThan(0);
    });

    it('BINARY_EXTENSIONS and CODE_EXTENSIONS are non-overlapping sets', () => {
        for (const ext of BINARY_EXTENSIONS) {
            expect(CODE_EXTENSIONS.has(ext)).toBe(false);
        }
    });

    it('fullWorkspace defaults are not capped by the interactive max-files setting', () => {
        const adapter = {
            getConfig: <T>(_section: string, key: string, defaultValue: T): T => {
                if (key === 'maxFilesToAnalyze') return 25 as T;
                return defaultValue;
            },
        };

        const interactive = normalizeAnalysisOptions(adapter as any, { scope: 'interactive' });
        const fullWorkspace = normalizeAnalysisOptions(adapter as any, { scope: 'fullWorkspace' });

        expect(interactive.maxFiles).toBe(25);
        expect(fullWorkspace.maxFiles).toBeGreaterThan(25);
    });

    it('interactive defaults fall back to the shared default max-files budget', () => {
        const adapter = {
            getConfig: <T>(_section: string, _key: string, defaultValue: T): T => defaultValue,
        };

        const interactive = normalizeAnalysisOptions(adapter as any, { scope: 'interactive' });

        expect(interactive.maxFiles).toBe(DEFAULT_INTERACTIVE_MAX_FILES);
    });
});
