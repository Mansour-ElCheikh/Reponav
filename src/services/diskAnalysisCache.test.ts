import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
    computeCacheKey,
    readAnalysisCache,
    writeAnalysisCache,
    readCouplingCache,
    writeCouplingCache,
    type CacheKey,
} from './diskAnalysisCache';
import type { AnalysisReport, CoChangePair } from '../types';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeReport(overrides: Partial<AnalysisReport> = {}): AnalysisReport {
    return {
        timestamp: '2026-01-01T00:00:00Z',
        workspaceRoot: '/repo',
        indexTier: 3,
        frameworks: [],
        primaryLanguage: 'TypeScript',
        entryPoints: [],
        dependencyGraph: { nodes: [], edges: [], circularDependencies: [] },
        fileClassifications: [],
        metrics: {
            totalFiles: 5,
            totalLines: 100,
            fileMetrics: [],
            hotFiles: [{ filePath: 'src/a.ts', lineCount: 50, importCount: 3, importedByCount: 2, isCircular: false }],
            orphanFiles: [],
        },
        fileTree: {},
        keyFileContents: {},
        ...overrides,
    } as AnalysisReport;
}

function makeKey(overrides: Partial<CacheKey> = {}): CacheKey {
    return { repoPath: '/repo', gitHead: 'abc123', fileCount: 5, ...overrides };
}

// ─── Component 001 Tests ───────────────────────────────────────────────────────

describe('computeCacheKey', () => {
    it('returns key with gitHead sha for a git repo', async () => {
        // Task 1: given repo at a git commit when computeCacheKey called
        // then returns { repoPath, gitHead: sha, fileCount: n }
        const key = await computeCacheKey('/repo', ['a.ts', 'b.ts', 'c.ts']);
        expect(key.repoPath).toBe('/repo');
        expect(typeof key.gitHead).toBe('string');
        expect(key.fileCount).toBe(3);
    });

    it('returns key with empty gitHead for non-git directory', async () => {
        // Task 2: given repo with no .git when computeCacheKey called
        // then returns key with gitHead: '' without throwing
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'no-git-'));
        try {
            const key = await computeCacheKey(tmpDir, ['x.ts']);
            expect(key.gitHead).toBe('');
            expect(key.fileCount).toBe(1);
        } finally {
            fs.rmSync(tmpDir, { recursive: true });
        }
    });
});

describe('readAnalysisCache', () => {
    let tmpDir: string;

    beforeEach(() => { tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cache-test-')); });
    afterEach(() => { fs.rmSync(tmpDir, { recursive: true }); });

    it('returns undefined when no cache file exists', () => {
        // Task 3: given no .reponav/analysis-cache.json
        // when readAnalysisCache called then returns undefined
        const result = readAnalysisCache(makeKey(), 3, tmpDir);
        expect(result).toBeUndefined();
    });

    it('returns report on key match and sufficient indexTier', () => {
        // Task 4: given cache file with matching key and indexTier >= requestedTier
        // when readAnalysisCache(key, requestedTier) called then returns the stored AnalysisReport
        const key = makeKey();
        const report = makeReport({ indexTier: 3 });
        writeAnalysisCache(key, report, tmpDir);
        const result = readAnalysisCache(key, 3, tmpDir);
        expect(result).toBeDefined();
        expect(result!.workspaceRoot).toBe('/repo');
    });

    it('returns undefined on key mismatch (stale gitHead)', () => {
        // Task 5: given cache file with stale gitHead
        // when readAnalysisCache called then returns undefined
        const key = makeKey({ gitHead: 'abc123' });
        writeAnalysisCache(key, makeReport(), tmpDir);
        const staleKey = makeKey({ gitHead: 'deadbeef' });
        expect(readAnalysisCache(staleKey, 3, tmpDir)).toBeUndefined();
    });

    it('returns undefined when cached indexTier is insufficient', () => {
        // Task 6: given cache file with indexTier: 1
        // when readAnalysisCache(key, requestedTier=3) called then returns undefined
        const key = makeKey();
        writeAnalysisCache(key, makeReport({ indexTier: 1 }), tmpDir);
        expect(readAnalysisCache(key, 3, tmpDir)).toBeUndefined();
    });

    it('returns undefined and does not throw on corrupt JSON', () => {
        // Task 7: given cache file contains invalid JSON
        // when readAnalysisCache called then returns undefined without throwing
        const cacheDir = path.join(tmpDir, '.reponav');
        fs.mkdirSync(cacheDir, { recursive: true });
        fs.writeFileSync(path.join(cacheDir, 'analysis-cache.json'), '{corrupted: json:::');
        expect(() => readAnalysisCache(makeKey(), 3, tmpDir)).not.toThrow();
        expect(readAnalysisCache(makeKey(), 3, tmpDir)).toBeUndefined();
    });

    it('returns undefined on fileCount mismatch', () => {
        // Task 13: given cache written with fileCount=N
        // when readAnalysisCache called with key where fileCount=N+1 then returns undefined
        const key = makeKey({ fileCount: 5 });
        writeAnalysisCache(key, makeReport(), tmpDir);
        const newKey = makeKey({ fileCount: 6 });
        expect(readAnalysisCache(newKey, 3, tmpDir)).toBeUndefined();
    });
});

describe('writeAnalysisCache', () => {
    let tmpDir: string;

    beforeEach(() => { tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cache-test-')); });
    afterEach(() => { fs.rmSync(tmpDir, { recursive: true }); });

    it('creates .reponav dir and writes cache when directory absent', () => {
        // Task 8: given .reponav/ directory does not exist
        // when writeAnalysisCache called then .reponav/ exists and analysis-cache.json is present and parseable
        const key = makeKey();
        writeAnalysisCache(key, makeReport(), tmpDir);
        const cachePath = path.join(tmpDir, '.reponav', 'analysis-cache.json');
        expect(fs.existsSync(cachePath)).toBe(true);
        expect(() => JSON.parse(fs.readFileSync(cachePath, 'utf8'))).not.toThrow();
    });

    it('round-trips: read returns identical workspaceRoot, indexTier, hotFiles count', () => {
        // Task 9: given valid AnalysisReport and key when writeAnalysisCache
        // then readAnalysisCache with same key returns report with identical workspaceRoot, indexTier, hotFiles length
        const key = makeKey();
        const report = makeReport();
        writeAnalysisCache(key, report, tmpDir);
        const result = readAnalysisCache(key, 3, tmpDir);
        expect(result!.workspaceRoot).toBe(report.workspaceRoot);
        expect(result!.indexTier).toBe(report.indexTier);
        expect(result!.metrics.hotFiles.length).toBe(report.metrics.hotFiles.length);
    });

    it('leaves no temp file and produces valid JSON with cacheKey field after write', () => {
        // Task 10: given writeAnalysisCache called when write completes
        // then no .tmp file exists AND analysis-cache.json parses with a cacheKey field
        const key = makeKey();
        writeAnalysisCache(key, makeReport(), tmpDir);
        const cacheDir = path.join(tmpDir, '.reponav');
        const tmpFiles = fs.readdirSync(cacheDir).filter(f => f.endsWith('.tmp'));
        expect(tmpFiles).toHaveLength(0);
        const raw = JSON.parse(fs.readFileSync(path.join(cacheDir, 'analysis-cache.json'), 'utf8'));
        expect(raw).toHaveProperty('cacheKey');
    });
});

describe('coupling cache', () => {
    let tmpDir: string;

    beforeEach(() => { tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cache-test-')); });
    afterEach(() => { fs.rmSync(tmpDir, { recursive: true }); });

    const pairs: CoChangePair[] = [
        { fileA: 'a.ts', fileB: 'b.ts', support: 3, confidence: 0.9 },
    ];

    it('round-trips coupling pairs with matching key and minSupport', () => {
        // Task 11: given coupling pairs written with key + minSupport=2
        // when readCouplingCache(key, 2) called then returns same pairs
        const key = makeKey();
        writeCouplingCache(key, pairs, 2, tmpDir);
        const result = readCouplingCache(key, 2, tmpDir);
        expect(result).toBeDefined();
        expect(result!.length).toBe(1);
        expect(result![0].fileA).toBe('a.ts');
    });

    it('returns undefined on minSupport mismatch', () => {
        // Task 12: given coupling cache written with minSupport=2
        // when readCouplingCache(key, minSupport=3) called then returns undefined
        const key = makeKey();
        writeCouplingCache(key, pairs, 2, tmpDir);
        expect(readCouplingCache(key, 3, tmpDir)).toBeUndefined();
    });
});
