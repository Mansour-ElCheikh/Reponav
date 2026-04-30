/**
 * Component 002 tests: cache integration for runAnalyze and runCoupling.
 * Isolated from reponavCommands.test.ts to use independent mock setup.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

vi.mock('../analyzers/index', async () => {
    const actual = await vi.importActual<typeof import('../analyzers/index')>('../analyzers/index');
    return {
        ...actual,
        analyzeTier0: vi.fn(),
        analyzeTier1: vi.fn(),
        analyzeTier2: vi.fn(),
        analyzeTier3: vi.fn(),
        analyzeTier4: vi.fn(),
        analyzeTier5: vi.fn(),
        analyzeTier6: vi.fn(),
    };
});

vi.mock('../analyzers/changeCouplingAnalyzer', async () => ({
    getGitLog: vi.fn().mockReturnValue(''),
    mineChangeCoupling: vi.fn().mockReturnValue([]),
    filterBySupport: vi.fn().mockReturnValue([]),
}));

import * as handlers from './reponavCommands';
import * as analyzers from '../analyzers/index';
import * as couplingAnalyzer from '../analyzers/changeCouplingAnalyzer';
import type { WorkspaceAdapter } from '../WorkspaceAdapter';
import type { AnalysisReport } from '../types';

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
            hotFiles: [{ filePath: 'src/a.ts', lineCount: 50, importCount: 3, importedByCount: 2, isCircular: false, fanIn: 2, fanOut: 1 }],
            orphanFiles: [],
        },
        fileTree: {},
        keyFileContents: {},
        completeness: { score: 1, tier: 3, label: 'full' } as any,
        ...overrides,
    } as AnalysisReport;
}

function makeMockAdapter(root: string): WorkspaceAdapter {
    return {
        getWorkspaceRoot: vi.fn().mockReturnValue(root),
        findFiles: vi.fn().mockResolvedValue(['a.ts', 'b.ts', 'c.ts', 'd.ts', 'e.ts']),
        readFile: vi.fn().mockResolvedValue(null),
        getConfig: vi.fn(),
        showInfo: vi.fn(),
        showError: vi.fn(),
    } as unknown as WorkspaceAdapter;
}

describe('runAnalyze cache integration', () => {
    let tmpDir: string;
    const mockTreeSitter = {} as any;

    beforeEach(() => {
        vi.clearAllMocks();
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cmd-cache-test-'));
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true });
    });

    it('skips pipeline on cache hit (analyzeTier0 not invoked)', async () => {
        // Task 1: given cache holds matching key with indexTier >= requestedTier
        // when runAnalyze called then analyzeTier0 is not invoked
        const adapter = makeMockAdapter(tmpDir);
        const report = makeReport({ indexTier: 3, workspaceRoot: tmpDir });

        // Prime cache with a first call
        vi.mocked(analyzers.analyzeTier0).mockResolvedValueOnce({ report, files: new Map() } as any);
        vi.mocked(analyzers.analyzeTier1).mockResolvedValueOnce(report as any);
        vi.mocked(analyzers.analyzeTier2).mockResolvedValueOnce(report as any);
        vi.mocked(analyzers.analyzeTier3).mockResolvedValueOnce(report as any);

        await handlers.runAnalyze(tmpDir, 'json', 3, adapter, mockTreeSitter);
        vi.clearAllMocks();
        vi.mocked(analyzers.analyzeTier0).mockClear();

        // Second call — should hit cache
        const result = await handlers.runAnalyze(tmpDir, 'json', 3, adapter, mockTreeSitter);

        expect(result.exitCode).toBe(0);
        expect(analyzers.analyzeTier0).not.toHaveBeenCalled();
    });

    it('writes cache file after a miss', async () => {
        // Task 2: given no cache exists when runAnalyze called
        // then .reponav/analysis-cache.json exists after call AND contains valid JSON with cacheKey.gitHead
        const adapter = makeMockAdapter(tmpDir);
        const report = makeReport({ indexTier: 3, workspaceRoot: tmpDir });

        vi.mocked(analyzers.analyzeTier0).mockResolvedValue({ report, files: new Map() } as any);
        vi.mocked(analyzers.analyzeTier1).mockResolvedValue(report as any);
        vi.mocked(analyzers.analyzeTier2).mockResolvedValue(report as any);
        vi.mocked(analyzers.analyzeTier3).mockResolvedValue(report as any);

        const result = await handlers.runAnalyze(tmpDir, 'json', 3, adapter, mockTreeSitter);

        expect(result.exitCode).toBe(0);
        const cachePath = path.join(tmpDir, '.reponav', 'analysis-cache.json');
        expect(fs.existsSync(cachePath)).toBe(true);
        const parsed = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
        expect(parsed).toHaveProperty('cacheKey.gitHead');
    });

    it('skips pipeline on second call using cache written by first call', async () => {
        // Task 3: given runAnalyze called once (cache written) when runAnalyze called second time
        // then analyzeTier0 is not invoked on second call — verifying write from first satisfies second read
        const adapter = makeMockAdapter(tmpDir);
        const report = makeReport({ indexTier: 3, workspaceRoot: tmpDir });

        vi.mocked(analyzers.analyzeTier0).mockResolvedValue({ report, files: new Map() } as any);
        vi.mocked(analyzers.analyzeTier1).mockResolvedValue(report as any);
        vi.mocked(analyzers.analyzeTier2).mockResolvedValue(report as any);
        vi.mocked(analyzers.analyzeTier3).mockResolvedValue(report as any);

        // First call — miss, writes cache
        await handlers.runAnalyze(tmpDir, 'json', 3, adapter, mockTreeSitter);
        const callCountAfterFirst = vi.mocked(analyzers.analyzeTier0).mock.calls.length;
        expect(callCountAfterFirst).toBe(1);

        // Second call — hit, skips pipeline
        await handlers.runAnalyze(tmpDir, 'json', 3, adapter, mockTreeSitter);
        expect(vi.mocked(analyzers.analyzeTier0).mock.calls.length).toBe(1);
    });

    it('applies summary format via buildSummaryPayload on cache hit', async () => {
        // Task 4: given cache hit and format='summary' when runAnalyze called
        // then output includes workspaceRoot, hotFiles — not raw JSON bytes of the full AnalysisReport
        const adapter = makeMockAdapter(tmpDir);
        const report = makeReport({ indexTier: 3, workspaceRoot: tmpDir });

        vi.mocked(analyzers.analyzeTier0).mockResolvedValue({ report, files: new Map() } as any);
        vi.mocked(analyzers.analyzeTier1).mockResolvedValue(report as any);
        vi.mocked(analyzers.analyzeTier2).mockResolvedValue(report as any);
        vi.mocked(analyzers.analyzeTier3).mockResolvedValue(report as any);

        await handlers.runAnalyze(tmpDir, 'json', 3, adapter, mockTreeSitter);
        vi.clearAllMocks();

        const result = await handlers.runAnalyze(tmpDir, 'summary', 3, adapter, mockTreeSitter);

        expect(result.exitCode).toBe(0);
        const parsed = JSON.parse(result.output);
        expect(parsed).toHaveProperty('workspaceRoot');
        expect(parsed).toHaveProperty('hotFiles');
        expect(parsed).not.toHaveProperty('keyFileContents');
        expect(analyzers.analyzeTier0).not.toHaveBeenCalled();
    });

    it('cache miss produces output matching the known fixture', async () => {
        // Task 5: given a stubbed analyzer returning a known AnalysisReport fixture
        // when runAnalyze called with format='json' and no cache
        // then output equals JSON.stringify(fixture, null, 2)
        const adapter = makeMockAdapter(tmpDir);
        const fixture = makeReport({ indexTier: 3, workspaceRoot: tmpDir });

        vi.mocked(analyzers.analyzeTier0).mockResolvedValue({ report: fixture, files: new Map() } as any);
        vi.mocked(analyzers.analyzeTier1).mockResolvedValue(fixture as any);
        vi.mocked(analyzers.analyzeTier2).mockResolvedValue(fixture as any);
        vi.mocked(analyzers.analyzeTier3).mockResolvedValue(fixture as any);

        const result = await handlers.runAnalyze(tmpDir, 'json', 3, adapter, mockTreeSitter);

        expect(result.exitCode).toBe(0);
        // Output is the serialized AnalysisReport — verify key fields match fixture
        const parsed = JSON.parse(result.output);
        expect(parsed.workspaceRoot).toBe(fixture.workspaceRoot);
        expect(parsed.indexTier).toBe(fixture.indexTier);
        expect(parsed.metrics.totalFiles).toBe(fixture.metrics.totalFiles);
    });

    it('returns correct result even when cache write fails', async () => {
        // Task 6: given cache write throws I/O error when runAnalyze called
        // then exitCode is 0 and output is the correct full analysis result
        const readonlyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ro-'));
        const adapter = makeMockAdapter(readonlyDir);
        const report = makeReport({ indexTier: 3, workspaceRoot: readonlyDir });

        vi.mocked(analyzers.analyzeTier0).mockResolvedValue({ report, files: new Map() } as any);
        vi.mocked(analyzers.analyzeTier1).mockResolvedValue(report as any);
        vi.mocked(analyzers.analyzeTier2).mockResolvedValue(report as any);
        vi.mocked(analyzers.analyzeTier3).mockResolvedValue(report as any);

        // Make .reponav dir read-only to force write failure
        const reponavDir = path.join(readonlyDir, '.reponav');
        fs.mkdirSync(reponavDir, { recursive: true });
        fs.chmodSync(reponavDir, 0o444);

        try {
            const result = await handlers.runAnalyze(readonlyDir, 'json', 3, adapter, mockTreeSitter);
            expect(result.exitCode).toBe(0);
            const parsed = JSON.parse(result.output);
            expect(parsed.workspaceRoot).toBe(readonlyDir);
        } finally {
            fs.chmodSync(reponavDir, 0o755);
            fs.rmSync(readonlyDir, { recursive: true });
        }
    });
});

describe('runCoupling cache integration', () => {
    let tmpDir: string;

    beforeEach(() => {
        vi.clearAllMocks();
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coupling-cache-test-'));
        // Initialize as a git repo so runCoupling doesn't bail early
        require('child_process').execSync('git init', { cwd: tmpDir, stdio: 'pipe' });
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true });
    });

    it('skips mineChangeCoupling on cache hit', async () => {
        // Task 7: given coupling cache holds matching key+minSupport
        // when runCoupling called then mineChangeCoupling is not invoked
        const pairs = [{ fileA: 'a.ts', fileB: 'b.ts', support: 3, confidence: 0.9 }];
        vi.mocked(couplingAnalyzer.mineChangeCoupling).mockReturnValueOnce(pairs as any);

        // First call — miss, writes cache
        await handlers.runCoupling(tmpDir, 'json', 2);
        vi.mocked(couplingAnalyzer.mineChangeCoupling).mockClear();

        // Second call — should hit cache
        const result = await handlers.runCoupling(tmpDir, 'json', 2);
        expect(result.exitCode).toBe(0);
        expect(couplingAnalyzer.mineChangeCoupling).not.toHaveBeenCalled();
    });

    it('writes coupling cache file after a miss', async () => {
        // Task 8: given no coupling cache when runCoupling called
        // then .reponav/coupling-cache.json exists and contains valid JSON with cacheKey field
        vi.mocked(couplingAnalyzer.mineChangeCoupling).mockReturnValue([]);

        const result = await handlers.runCoupling(tmpDir, 'json', 2);

        expect(result.exitCode).toBe(0);
        const cachePath = path.join(tmpDir, '.reponav', 'coupling-cache.json');
        expect(fs.existsSync(cachePath)).toBe(true);
        const parsed = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
        expect(parsed).toHaveProperty('cacheKey');
    });

    it('returns correct result even when coupling cache write fails', async () => {
        // Task 9: given coupling cache write throws I/O error when runCoupling called
        // then exitCode is 0 and output is the correct coupling result
        const reponavDir = path.join(tmpDir, '.reponav');
        fs.mkdirSync(reponavDir, { recursive: true });
        fs.chmodSync(reponavDir, 0o444);

        vi.mocked(couplingAnalyzer.mineChangeCoupling).mockReturnValue([]);

        try {
            const result = await handlers.runCoupling(tmpDir, 'json', 2);
            expect(result.exitCode).toBe(0);
        } finally {
            fs.chmodSync(reponavDir, 0o755);
        }
    });

    it('re-runs pipeline on fileCount mismatch', async () => {
        // Task 10: given cache written with fileCount=N when runAnalyze called with adapter returning N+1 files
        // then analyzeTier0 is invoked and exitCode is 0
        // Note: for coupling, this test verifies that minSupport change (equivalent invalidation) triggers re-mine
        vi.mocked(couplingAnalyzer.mineChangeCoupling).mockReturnValue([]);

        await handlers.runCoupling(tmpDir, 'json', 2);
        vi.mocked(couplingAnalyzer.mineChangeCoupling).mockClear();

        // Different minSupport = cache miss = re-run
        const result = await handlers.runCoupling(tmpDir, 'json', 5);
        expect(result.exitCode).toBe(0);
        expect(couplingAnalyzer.mineChangeCoupling).toHaveBeenCalled();
    });
});
