/**
 * Unit tests for analyzer utility functions.
 */
import { describe, it, expect } from 'vitest';
import { resolveJsImport, detectCycles } from './utils';

const ROOT = '/workspace';

// Helpers
function makeSet(paths: string[]): Set<string> {
    return new Set(paths);
}

// ─── resolveJsImport ─────────────────────────────────────────────────────────

describe('resolveJsImport', () => {
    describe('relative imports', () => {
        it('resolves ./b to src/b.ts', () => {
            const files = makeSet(['src/b.ts']);
            expect(resolveJsImport('./b', 'src/a.ts', files, ROOT)).toBe('src/b.ts');
        });

        it('resolves ../utils to utils.ts from nested file', () => {
            const files = makeSet(['utils.ts']);
            expect(resolveJsImport('../utils', 'src/a.ts', files, ROOT)).toBe('utils.ts');
        });

        it('resolves to index file for directory import', () => {
            const files = makeSet(['src/db/index.ts']);
            expect(resolveJsImport('./db', 'src/a.ts', files, ROOT)).toBe('src/db/index.ts');
        });

        it('returns null for unresolvable relative import', () => {
            const files = makeSet(['src/b.ts']);
            expect(resolveJsImport('./missing', 'src/a.ts', files, ROOT)).toBeNull();
        });
    });

    describe('path alias imports', () => {
        it('@/ resolves against src/ root', () => {
            const files = makeSet(['src/utils/helpers.ts']);
            expect(resolveJsImport('@/utils/helpers', 'src/a.ts', files, ROOT)).toBe('src/utils/helpers.ts');
        });

        it('@/ resolves against workspace root fallback', () => {
            const files = makeSet(['lib/shared.ts']);
            expect(resolveJsImport('@/lib/shared', 'src/a.ts', files, ROOT)).toBe('lib/shared.ts');
        });

        it('@/ resolves to index file', () => {
            const files = makeSet(['src/components/index.ts']);
            expect(resolveJsImport('@/components', 'src/a.ts', files, ROOT)).toBe('src/components/index.ts');
        });

        it('~/ resolves against src/ root', () => {
            const files = makeSet(['src/store/state.ts']);
            expect(resolveJsImport('~/store/state', 'src/a.ts', files, ROOT)).toBe('src/store/state.ts');
        });

        it('~/ resolves against workspace root fallback', () => {
            const files = makeSet(['types/global.ts']);
            expect(resolveJsImport('~/types/global', 'src/a.ts', files, ROOT)).toBe('types/global.ts');
        });

        it('# subpath resolves against src/ root', () => {
            const files = makeSet(['src/utils/index.ts']);
            expect(resolveJsImport('#utils', 'src/a.ts', files, ROOT)).toBe('src/utils/index.ts');
        });

        it('external npm package returns null', () => {
            const files = makeSet(['src/b.ts']);
            expect(resolveJsImport('react', 'src/a.ts', files, ROOT)).toBeNull();
        });

        it('scoped package without match returns null', () => {
            const files = makeSet(['src/b.ts']);
            expect(resolveJsImport('@scope/package', 'src/a.ts', files, ROOT)).toBeNull();
        });
    });
});

// ─── detectCycles ─────────────────────────────────────────────────────────────

describe('detectCycles', () => {
    it('detects a 2-node cycle (A<->B)', () => {
        const cycles = detectCycles([
            { source: 'src/a.ts', target: 'src/b.ts', specifiers: [], isDynamic: false, rawStatement: '' },
            { source: 'src/b.ts', target: 'src/a.ts', specifiers: [], isDynamic: false, rawStatement: '' },
        ]);
        expect(cycles.length).toBeGreaterThan(0);
        const flatNodes = cycles.flat();
        expect(flatNodes).toContain('src/a.ts');
        expect(flatNodes).toContain('src/b.ts');
    });

    it('detects a 3-node cycle (A->B->C->A)', () => {
        const cycles = detectCycles([
            { source: 'src/a.ts', target: 'src/b.ts', specifiers: [], isDynamic: false, rawStatement: '' },
            { source: 'src/b.ts', target: 'src/c.ts', specifiers: [], isDynamic: false, rawStatement: '' },
            { source: 'src/c.ts', target: 'src/a.ts', specifiers: [], isDynamic: false, rawStatement: '' },
        ]);
        expect(cycles.length).toBeGreaterThan(0);
        const flatNodes = cycles.flat();
        expect(flatNodes).toContain('src/a.ts');
        expect(flatNodes).toContain('src/b.ts');
        expect(flatNodes).toContain('src/c.ts');
    });

    it('returns empty array when no cycle exists', () => {
        const cycles = detectCycles([
            { source: 'src/a.ts', target: 'src/b.ts', specifiers: [], isDynamic: false, rawStatement: '' },
            { source: 'src/b.ts', target: 'src/c.ts', specifiers: [], isDynamic: false, rawStatement: '' },
        ]);
        expect(cycles).toHaveLength(0);
    });

    it('detects a cycle isolated from the rest of the graph', () => {
        const cycles = detectCycles([
            { source: 'x.ts', target: 'y.ts', specifiers: [], isDynamic: false, rawStatement: '' },
            { source: 'a.ts', target: 'b.ts', specifiers: [], isDynamic: false, rawStatement: '' },
            { source: 'b.ts', target: 'a.ts', specifiers: [], isDynamic: false, rawStatement: '' },
        ]);
        expect(cycles.length).toBeGreaterThan(0);
        const flatNodes = cycles.flat();
        expect(flatNodes).toContain('a.ts');
        expect(flatNodes).toContain('b.ts');
    });

    it('deduplicates equivalent cycles', () => {
        // Both A->B and B->A — should produce exactly one 2-node cycle
        const cycles = detectCycles([
            { source: 'a.ts', target: 'b.ts', specifiers: [], isDynamic: false, rawStatement: '' },
            { source: 'b.ts', target: 'a.ts', specifiers: [], isDynamic: false, rawStatement: '' },
        ]);
        expect(cycles).toHaveLength(1);
    });

    it('returns empty array for empty edge list', () => {
        expect(detectCycles([])).toHaveLength(0);
    });
});

// ─── End-to-end: alias imports enable cycle detection ─────────────────────────

describe('RegexAnalysisProvider + alias imports — cycle detection', () => {
    it('detects cycle when both files use @/ alias', async () => {
        // Dynamically import to avoid circular import lint
        const { RegexAnalysisProvider } = await import('./importAnalyzer');
        const provider = new RegexAnalysisProvider();
        const files = new Map([
            ['src/services/auth.ts', `import { User } from '@/models/user';`],
            ['src/models/user.ts', `import { validateAuth } from '@/services/auth';`],
        ]);
        const result = await provider.analyzeImports(ROOT, files);
        // Both edges should be resolved thanks to the @/ heuristic
        expect(result.edges.length).toBe(2);
        expect(result.circularDependencies.length).toBeGreaterThan(0);
    });
});
