import { describe, it, expect, beforeEach } from 'vitest';
import type { AnalysisReport } from '../types';
import { AnalysisCache } from './AnalysisCache';

function makeReport(tier: number): AnalysisReport {
    return {
        timestamp: new Date().toISOString(),
        workspaceRoot: '/test',
        indexTier: tier as 0 | 1 | 2,
        frameworks: [],
        primaryLanguage: 'typescript',
        entryPoints: [],
        dependencyGraph: { nodes: [], edges: [], circularDependencies: [] },
        fileClassifications: [],
        metrics: { totalFiles: 1, totalLines: 10, fileMetrics: [], hotFiles: [], orphanFiles: [] },
        fileTree: {},
        keyFileContents: {},
    };
}

describe('AnalysisCache', () => {
    let cache: AnalysisCache;

    beforeEach(() => {
        cache = new AnalysisCache();
    });

    it('starts with version 0 and no cached data', () => {
        expect(cache.workspaceVersion).toBe(0);
        expect(cache.report).toBeUndefined();
        expect(cache.getCachedTier1('interactive')).toBeUndefined();
        expect(cache.getCachedTier0('interactive')).toBeUndefined();
    });

    describe('store and retrieve', () => {
        it('stores and retrieves a tier 1 report', () => {
            const report = makeReport(1);
            const files = new Map([['a.ts', 'code']]);
            cache.store(report, files, 'interactive');

            expect(cache.getCachedTier1('interactive')).toBe(report);
        });

        it('stores and retrieves a tier 0 report with files', () => {
            const report = makeReport(0);
            const files = new Map([['a.ts', 'code']]);
            cache.store(report, files, 'interactive');

            const cached = cache.getCachedTier0('interactive');
            expect(cached).toBeDefined();
            expect(cached!.report).toBe(report);
            expect(cached!.files).toBe(files);
        });

        it('does not return tier 0 report as tier 1', () => {
            cache.store(makeReport(0), new Map(), 'interactive');
            expect(cache.getCachedTier1('interactive')).toBeUndefined();
        });

        it('does not return tier 0 when files are null', () => {
            cache.store(makeReport(0), null, 'interactive');
            expect(cache.getCachedTier0('interactive')).toBeUndefined();
        });
    });

    describe('scope satisfaction', () => {
        it('fullWorkspace satisfies interactive', () => {
            cache.store(makeReport(1), new Map(), 'fullWorkspace');
            expect(cache.getCachedTier1('interactive')).toBeDefined();
        });

        it('interactive does NOT satisfy fullWorkspace', () => {
            cache.store(makeReport(1), new Map(), 'interactive');
            expect(cache.getCachedTier1('fullWorkspace')).toBeUndefined();
        });

        it('exact scope match works', () => {
            cache.store(makeReport(1), new Map(), 'fullWorkspace');
            expect(cache.getCachedTier1('fullWorkspace')).toBeDefined();
        });
    });

    describe('version staleness', () => {
        it('invalidate bumps version and clears cached data', () => {
            cache.store(makeReport(1), new Map(), 'interactive');
            expect(cache.getCachedTier1('interactive')).toBeDefined();

            cache.invalidate();

            expect(cache.workspaceVersion).toBe(1);
            expect(cache.report).toBeUndefined();
            expect(cache.getCachedTier1('interactive')).toBeUndefined();
            expect(cache.getCachedTier0('interactive')).toBeUndefined();
        });

        it('data stored before invalidation is stale after version bump', () => {
            cache.store(makeReport(1), new Map(), 'interactive');
            cache.invalidate();
            // Even though report was set, version mismatch makes it stale
            expect(cache.getCachedTier1('interactive')).toBeUndefined();
        });

        it('data stored after invalidation is fresh', () => {
            cache.invalidate();
            cache.store(makeReport(1), new Map(), 'interactive');
            expect(cache.getCachedTier1('interactive')).toBeDefined();
        });

        it('clears tier0WarmupPromise on invalidation', () => {
            cache.tier0WarmupPromise = Promise.resolve();
            cache.invalidate();
            expect(cache.tier0WarmupPromise).toBeNull();
        });
    });

    describe('stale state (SWR)', () => {
        it('markStale sets isStale to true', () => {
            const report = makeReport(1);
            cache.store(report, new Map(), 'interactive');
            cache.markStale();
            expect(cache.isStale).toBe(true);
        });

        it('markStale makes getCachedTier1 return undefined', () => {
            cache.store(makeReport(1), new Map(), 'interactive');
            cache.markStale();
            expect(cache.getCachedTier1('interactive')).toBeUndefined();
        });

        it('getStaleReport returns the last stored report when stale and scope matches', () => {
            const report = makeReport(1);
            cache.store(report, new Map(), 'interactive');
            cache.markStale();
            expect(cache.getStaleReport('interactive')).toBe(report);
        });

        it('getStaleReport returns undefined when cache is empty (no prior store)', () => {
            cache.markStale();
            expect(cache.getStaleReport('interactive')).toBeUndefined();
        });

        it('getStaleReport returns undefined when cache is not stale', () => {
            cache.store(makeReport(1), new Map(), 'interactive');
            expect(cache.getStaleReport('interactive')).toBeUndefined();
        });

        it('markStale is idempotent — second call does not increment version further', () => {
            cache.store(makeReport(1), new Map(), 'interactive');
            cache.markStale();
            const versionAfterFirst = cache.workspaceVersion;
            cache.markStale();
            expect(cache.workspaceVersion).toBe(versionAfterFirst);
        });

        it('invalidate clears stale flag', () => {
            cache.store(makeReport(1), new Map(), 'interactive');
            cache.markStale();
            cache.invalidate();
            expect(cache.isStale).toBe(false);
        });

        it('invalidate makes getStaleReport return undefined', () => {
            cache.store(makeReport(1), new Map(), 'interactive');
            cache.markStale();
            cache.invalidate();
            expect(cache.getStaleReport('interactive')).toBeUndefined();
        });

        it('store clears stale flag', () => {
            cache.store(makeReport(1), new Map(), 'interactive');
            cache.markStale();
            cache.store(makeReport(1), new Map(), 'interactive');
            expect(cache.isStale).toBe(false);
        });

        it('store after markStale makes getCachedTier1 return the new report', () => {
            cache.store(makeReport(1), new Map(), 'interactive');
            cache.markStale();
            const fresh = makeReport(1);
            cache.store(fresh, new Map(), 'interactive');
            expect(cache.getCachedTier1('interactive')).toBe(fresh);
        });
    });

    describe('symbol enrichment cache', () => {
        it('stores and retrieves cached enrichment by file path and content hash', () => {
            const symbols = [{
                name: 'helper',
                kind: 'function' as const,
                filePath: 'src/a.ts',
                lineStart: 1,
                lineEnd: 1,
                isExported: false,
                isEntryPoint: false,
                signature: 'helper(): number',
            }];

            cache.storeSymbolEnrichment('src/a.ts', 'hash-1', symbols);

            expect(cache.getSymbolEnrichment('src/a.ts', 'hash-1')).toEqual(symbols);
            expect(cache.getSymbolEnrichment('src/a.ts', 'hash-2')).toBeUndefined();
        });

        it('invalidate clears cached symbol enrichment', () => {
            cache.storeSymbolEnrichment('src/a.ts', 'hash-1', []);

            cache.invalidate();

            expect(cache.getSymbolEnrichment('src/a.ts', 'hash-1')).toBeUndefined();
        });
    });
});
