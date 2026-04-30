import { describe, it, expect, beforeEach, vi } from 'vitest';
import { analyzeTier0, analyzeTier0Preview, analyzeTier1, analyzeTier2 } from '../analyzers/index';
import { enrichAnalysisReport } from '../analyzers/symbolEnrichment';
import type { AnalysisReport } from '../types';
import type { WorkspaceAdapter } from '../WorkspaceAdapter';
import { AnalysisCache } from './AnalysisCache';
import { AnalysisOrchestrator } from './AnalysisOrchestrator';
import type { OrchestratorProgressReporter } from './AnalysisOrchestrator';

// Mock the analyzers module
vi.mock('../analyzers/index', () => ({
    analyzeTier0: vi.fn(),
    analyzeTier0Preview: vi.fn(),
    analyzeTier1: vi.fn(),
    analyzeTier2: vi.fn(),
}));

vi.mock('../analyzers/symbolEnrichment', () => ({
    enrichAnalysisReport: vi.fn(),
}));

const mockAnalyzeTier0 = vi.mocked(analyzeTier0);
const mockAnalyzeTier0Preview = vi.mocked(analyzeTier0Preview);
const mockAnalyzeTier1 = vi.mocked(analyzeTier1);
const mockAnalyzeTier2 = vi.mocked(analyzeTier2);
const mockEnrichAnalysisReport = vi.mocked(enrichAnalysisReport);

function makeReport(tier: number): AnalysisReport {
    return {
        timestamp: new Date().toISOString(),
        workspaceRoot: '/test',
        indexTier: tier as 0 | 1 | 2,
        frameworks: [],
        primaryLanguage: 'typescript',
        entryPoints: [],
        dependencyGraph: { nodes: ['a.ts'], edges: [], circularDependencies: [] },
        fileClassifications: [],
        metrics: { totalFiles: 1, totalLines: 10, fileMetrics: [], hotFiles: [], orphanFiles: [] },
        fileTree: {},
        keyFileContents: {},
    };
}

function makeWorkspace(): WorkspaceAdapter {
    return {
        getWorkspaceRoot: () => '/test/workspace',
        getConfig: () => false as any,
        readFile: async () => null,
        findFiles: async () => [],
        showInfo: () => {},
        showError: () => {},
    };
}

function makeProgress(): OrchestratorProgressReporter {
    return {
        withProgress: async (_title, task) => task((value) => {}),
    };
}

describe('AnalysisOrchestrator', () => {
    let cache: AnalysisCache;
    let orchestrator: AnalysisOrchestrator;
    let sendAnalysis: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        vi.clearAllMocks();
        cache = new AnalysisCache();
        orchestrator = new AnalysisOrchestrator(
            cache,
            makeWorkspace(),
            { setLanguageHint: () => {} } as any, // TreeSitterProvider — not called when mocked
            makeProgress()
        );
        sendAnalysis = vi.fn();
        mockAnalyzeTier0Preview.mockResolvedValue({
            report: makeReport(0),
            relativePaths: ['a.ts'],
        });
        mockEnrichAnalysisReport.mockResolvedValue(makeReport(2));
    });

    describe('runScoped', () => {
        it('returns cached tier 1 report without calling analyzers', async () => {
            const report = makeReport(1);
            cache.store(report, new Map(), 'interactive');

            const result = await orchestrator.runScoped('interactive', {
                notificationTitle: 'Test',
                publishTier0: true,
            }, sendAnalysis);

            expect(result.report).toBe(report);
            expect(result.tier0Ms).toBe(0);
            expect(result.tier1Ms).toBe(0);
            expect(sendAnalysis).toHaveBeenCalledWith(report);
            expect(mockAnalyzeTier0).not.toHaveBeenCalled();
            expect(mockAnalyzeTier1).not.toHaveBeenCalled();
        });

        it('runs fresh analysis when cache is empty', async () => {
            const tier0Report = makeReport(0);
            const tier1Report = makeReport(1);
            const files = new Map([['a.ts', 'code']]);

            mockAnalyzeTier0.mockResolvedValue({ report: tier0Report, files });
            mockAnalyzeTier1.mockResolvedValue(tier1Report);

            const result = await orchestrator.runScoped('interactive', {
                notificationTitle: 'Test',
                publishTier0: true,
            }, sendAnalysis);

            expect(result.report).toBe(tier1Report);
            expect(result.tier0Ms).toBeGreaterThanOrEqual(0);
            expect(result.tier1Ms).toBeGreaterThanOrEqual(0);
            expect(mockAnalyzeTier0).toHaveBeenCalledTimes(1);
            expect(mockAnalyzeTier0Preview).toHaveBeenCalledTimes(1);
            expect(mockAnalyzeTier1).toHaveBeenCalledTimes(1);
            // Should have sent preview + tier0 + tier1
            expect(sendAnalysis).toHaveBeenCalledTimes(3);
        });

        it('annotates fresh interactive reports with sampled completeness metadata', async () => {
            const tier0Report = makeReport(0);
            const tier1Report = makeReport(1);
            const files = new Map([['a.ts', 'code']]);

            mockAnalyzeTier0.mockResolvedValue({ report: tier0Report, files });
            mockAnalyzeTier1.mockResolvedValue(tier1Report);

            const result = await orchestrator.runScoped('interactive', {
                notificationTitle: 'Test',
                publishTier0: true,
            }, sendAnalysis);

            expect(result.report.completeness).toEqual({
                analysisScope: 'interactive',
                analyzedFileCount: 1,
                graphNodeCount: 1,
                graphEdgeCount: 0,
                analysisCoverage: 'sampled',
                graphCoverage: 'complete',
            });
            expect(sendAnalysis).toHaveBeenLastCalledWith(
                expect.objectContaining({
                    completeness: expect.objectContaining({
                        analysisScope: 'interactive',
                        analysisCoverage: 'sampled',
                    }),
                }),
            );
        });

        it('reuses cached tier 0 and only runs tier 1', async () => {
            const tier0Report = makeReport(0);
            const tier1Report = makeReport(1);
            const files = new Map([['a.ts', 'code']]);

            // Pre-populate tier 0 cache
            cache.store(tier0Report, files, 'interactive');

            mockAnalyzeTier1.mockResolvedValue(tier1Report);

            const result = await orchestrator.runScoped('interactive', {
                notificationTitle: 'Test',
                publishTier0: true,
            }, sendAnalysis);

            expect(result.report).toBe(tier1Report);
            expect(result.tier0Ms).toBe(0);
            expect(mockAnalyzeTier0).not.toHaveBeenCalled();
            expect(mockAnalyzeTier1).toHaveBeenCalledTimes(1);
        });

        it('annotates cached reports with scope completeness before returning them', async () => {
            const report = makeReport(1);
            cache.store(report, new Map(), 'interactive');

            const result = await orchestrator.runScoped('interactive', {
                notificationTitle: 'Test',
                publishTier0: true,
            }, sendAnalysis);

            expect(result.report.completeness).toEqual({
                analysisScope: 'interactive',
                analyzedFileCount: 1,
                graphNodeCount: 1,
                graphEdgeCount: 0,
                analysisCoverage: 'sampled',
                graphCoverage: 'complete',
            });
            expect(sendAnalysis).toHaveBeenCalledWith(
                expect.objectContaining({
                    completeness: expect.objectContaining({ analysisScope: 'interactive' }),
                }),
            );
        });

        it('reuses an in-flight interactive warmup instead of starting a duplicate tier 0 scan', async () => {
            const tier0Report = makeReport(0);
            const tier1Report = makeReport(1);
            const files = new Map([['a.ts', 'code']]);

            const releaseWarmup = vi.fn();
            cache.tier0WarmupPromise = new Promise<void>((resolve) => {
                releaseWarmup.mockImplementation(() => {
                    cache.store(tier0Report, files, 'interactive');
                    resolve();
                });
            });
            mockAnalyzeTier1.mockResolvedValue(tier1Report);

            const resultPromise = orchestrator.runScoped('interactive', {
                notificationTitle: 'Test',
                publishTier0: true,
            }, sendAnalysis);

            await Promise.resolve();

            expect(mockAnalyzeTier0Preview).not.toHaveBeenCalled();
            expect(mockAnalyzeTier0).not.toHaveBeenCalled();

            releaseWarmup();
            const result = await resultPromise;

            expect(mockAnalyzeTier0).not.toHaveBeenCalled();
            expect(mockAnalyzeTier1).toHaveBeenCalledTimes(1);
            expect(result.report).toBe(tier1Report);
        });

        it('falls back to a fresh tier 0 scan when warmup finishes without caching tier 0', async () => {
            const tier0Report = makeReport(0);
            const tier1Report = makeReport(1);
            const files = new Map([['a.ts', 'code']]);

            let releaseWarmup: (() => void) | undefined;
            cache.tier0WarmupPromise = new Promise<void>((resolve) => {
                releaseWarmup = resolve;
            });
            mockAnalyzeTier0.mockResolvedValue({ report: tier0Report, files });
            mockAnalyzeTier1.mockResolvedValue(tier1Report);

            const resultPromise = orchestrator.runScoped('interactive', {
                notificationTitle: 'Test',
                publishTier0: true,
            }, sendAnalysis);

            await Promise.resolve();

            expect(mockAnalyzeTier0Preview).not.toHaveBeenCalled();
            releaseWarmup?.();
            const result = await resultPromise;
            expect(mockAnalyzeTier0Preview).toHaveBeenCalledTimes(1);
            expect(mockAnalyzeTier0).toHaveBeenCalledTimes(1);
            expect(result.report).toBe(tier1Report);
        });
    });

    describe('ensureWarmTier0', () => {
        it('warms tier 0 when cache is empty', async () => {
            const tier0Report = makeReport(0);
            const files = new Map([['a.ts', 'code']]);
            mockAnalyzeTier0.mockResolvedValue({ report: tier0Report, files });

            await orchestrator.ensureWarmTier0(sendAnalysis);

            expect(mockAnalyzeTier0).toHaveBeenCalledTimes(1);
            expect(sendAnalysis).toHaveBeenCalledWith(tier0Report);
            // Should be stored in cache
            expect(cache.getCachedTier0('interactive')).toBeDefined();
        });

        it('skips warmup but still sends cached report when tier 0 is already cached', async () => {
            const cachedReport = makeReport(0);
            cache.store(cachedReport, new Map(), 'interactive');

            await orchestrator.ensureWarmTier0(sendAnalysis);

            expect(mockAnalyzeTier0).not.toHaveBeenCalled();
            expect(sendAnalysis).toHaveBeenCalledWith(cachedReport);
        });

        it('does not double-warm when called concurrently', async () => {
            const tier0Report = makeReport(0);
            const files = new Map([['a.ts', 'code']]);
            mockAnalyzeTier0.mockResolvedValue({ report: tier0Report, files });

            const p1 = orchestrator.ensureWarmTier0(sendAnalysis);
            const p2 = orchestrator.ensureWarmTier0(sendAnalysis);
            await Promise.all([p1, p2]);

            expect(mockAnalyzeTier0).toHaveBeenCalledTimes(1);
        });

        it('does not overwrite fresher cache entries when warmup finishes late', async () => {
            const tier0Report = makeReport(0);
            const files = new Map([['a.ts', 'code']]);
            mockAnalyzeTier0.mockResolvedValue({ report: tier0Report, files });

            const warmup = orchestrator.ensureWarmTier0(sendAnalysis);
            cache.store(makeReport(1), new Map([['a.ts', 'newer']]), 'interactive');
            await warmup;

            expect(sendAnalysis).not.toHaveBeenCalledWith(tier0Report);
            expect(cache.report?.indexTier).toBe(1);
        });
    });

    describe('runScoped with includeTier2', () => {
        it('runs tier 2 when includeTier2 is true', async () => {
            const tier0Report = makeReport(0);
            const tier1Report = makeReport(1);
            const tier2Report = { ...makeReport(2), symbols: [], symbolEdges: [] };
            const files = new Map([['a.ts', 'code']]);

            mockAnalyzeTier0.mockResolvedValue({ report: tier0Report, files });
            mockAnalyzeTier0Preview.mockResolvedValue({ report: tier0Report, relativePaths: ['a.ts'] });
            mockAnalyzeTier1.mockResolvedValue(tier1Report);
            mockAnalyzeTier2.mockResolvedValue(tier2Report);

            const result = await orchestrator.runScoped('interactive', {
                notificationTitle: 'Test',
                publishTier0: true,
                includeTier2: true,
            }, sendAnalysis);

            expect(mockAnalyzeTier2).toHaveBeenCalledTimes(1);
            expect(result.report.indexTier).toBe(2);
            expect(result.tier2Ms).toBeGreaterThanOrEqual(0);
        });

        it('returns the core tier 2 report before background enrichment finishes', async () => {
            const tier0Report = makeReport(0);
            const tier1Report = makeReport(1);
            const tier2CoreReport = { ...makeReport(2), symbols: [] };
            const files = new Map([['a.ts', 'code']]);

            let resolveEnrichment!: (value: AnalysisReport) => void;
            const enrichmentDone = new Promise<AnalysisReport>((resolve) => {
                resolveEnrichment = resolve;
            });

            mockAnalyzeTier0.mockResolvedValue({ report: tier0Report, files });
            mockAnalyzeTier0Preview.mockResolvedValue({ report: tier0Report, relativePaths: ['a.ts'] });
            mockAnalyzeTier1.mockResolvedValue(tier1Report);
            mockAnalyzeTier2.mockResolvedValue(tier2CoreReport);
            mockEnrichAnalysisReport.mockReturnValue(enrichmentDone);

            const result = await orchestrator.runScoped('interactive', {
                notificationTitle: 'Test',
                publishTier0: true,
                includeTier2: true,
            }, sendAnalysis);

            expect(result.report).toBe(tier2CoreReport);
            expect(sendAnalysis).toHaveBeenCalledWith(tier2CoreReport);
            expect(sendAnalysis).not.toHaveBeenCalledWith(expect.objectContaining({ signature: expect.anything() }));

            resolveEnrichment({ ...tier2CoreReport, symbols: [{
                name: 'helper',
                kind: 'function' as const,
                filePath: 'a.ts',
                lineStart: 1,
                lineEnd: 1,
                isExported: false,
                isEntryPoint: false,
                signature: 'helper(): number',
            }] });
            await Promise.resolve();
        });

        it('discards late background enrichment after cache invalidation', async () => {
            const tier0Report = makeReport(0);
            const tier1Report = makeReport(1);
            const tier2CoreReport = { ...makeReport(2), symbols: [] };
            const enrichedReport: AnalysisReport = {
                ...tier2CoreReport,
                symbols: [{
                    name: 'helper',
                    kind: 'function',
                    filePath: 'a.ts',
                    lineStart: 1,
                    lineEnd: 1,
                    isExported: false,
                    isEntryPoint: false,
                    signature: 'helper(): number',
                }],
            };
            const files = new Map([['a.ts', 'code']]);

            let resolveEnrichment!: (value: AnalysisReport) => void;
            const enrichmentDone = new Promise<AnalysisReport>((resolve) => {
                resolveEnrichment = resolve;
            });

            mockAnalyzeTier0.mockResolvedValue({ report: tier0Report, files });
            mockAnalyzeTier0Preview.mockResolvedValue({ report: tier0Report, relativePaths: ['a.ts'] });
            mockAnalyzeTier1.mockResolvedValue(tier1Report);
            mockAnalyzeTier2.mockResolvedValue(tier2CoreReport);
            mockEnrichAnalysisReport.mockReturnValue(enrichmentDone);

            await orchestrator.runScoped('interactive', {
                notificationTitle: 'Test',
                publishTier0: true,
                includeTier2: true,
            }, sendAnalysis);

            cache.invalidate();
            resolveEnrichment(enrichedReport);
            await Promise.resolve();

            expect(sendAnalysis).not.toHaveBeenCalledWith(enrichedReport);
        });

        it('skips tier 2 when includeTier2 is false', async () => {
            const tier0Report = makeReport(0);
            const tier1Report = makeReport(1);
            const files = new Map([['a.ts', 'code']]);

            mockAnalyzeTier0.mockResolvedValue({ report: tier0Report, files });
            mockAnalyzeTier0Preview.mockResolvedValue({ report: tier0Report, relativePaths: ['a.ts'] });
            mockAnalyzeTier1.mockResolvedValue(tier1Report);

            const result = await orchestrator.runScoped('interactive', {
                notificationTitle: 'Test',
                publishTier0: true,
            }, sendAnalysis);

            expect(mockAnalyzeTier2).not.toHaveBeenCalled();
            expect(result.report.indexTier).toBe(1);
            expect(result.tier2Ms).toBe(0);
        });
    });

    describe('scheduleRevalidation (SWR)', () => {
        it('serves stale report synchronously before any async work', async () => {
            const stale = makeReport(1);
            cache.store(stale, new Map(), 'interactive');
            cache.markStale();

            const tier1Fresh = makeReport(1);
            mockAnalyzeTier0.mockResolvedValue({ report: makeReport(0), files: new Map([['a.ts', '']]) });
            mockAnalyzeTier0Preview.mockResolvedValue({ report: makeReport(0), relativePaths: ['a.ts'] });
            mockAnalyzeTier1.mockResolvedValue(tier1Fresh);

            let firstCallArg: unknown;
            const capturingSendAnalysis = vi.fn((r) => { if (!firstCallArg) firstCallArg = r; });

            // schedule (don't await yet) — first call must happen synchronously
            const p = orchestrator.scheduleRevalidation('interactive', capturingSendAnalysis);
            // synchronous: sendAnalysis should already have been invoked once with stale
            expect(capturingSendAnalysis).toHaveBeenCalledWith(stale);
            expect(firstCallArg).toBe(stale);
            await p;
        });

        it('triggers a background runScoped after stale serve', async () => {
            cache.store(makeReport(1), new Map(), 'interactive');
            cache.markStale();

            const tier1Fresh = makeReport(1);
            mockAnalyzeTier0.mockResolvedValue({ report: makeReport(0), files: new Map([['a.ts', '']]) });
            mockAnalyzeTier0Preview.mockResolvedValue({ report: makeReport(0), relativePaths: ['a.ts'] });
            mockAnalyzeTier1.mockResolvedValue(tier1Fresh);

            await orchestrator.scheduleRevalidation('interactive', sendAnalysis);

            expect(mockAnalyzeTier1).toHaveBeenCalledTimes(1);
        });

        it('deduplicates concurrent scheduleRevalidation calls', async () => {
            cache.store(makeReport(1), new Map(), 'interactive');
            cache.markStale();

            let resolveFirst!: () => void;
            const blockingTier1 = new Promise<ReturnType<typeof makeReport>>((resolve) => {
                resolveFirst = () => resolve(makeReport(1));
            });
            mockAnalyzeTier0.mockResolvedValue({ report: makeReport(0), files: new Map([['a.ts', '']]) });
            mockAnalyzeTier0Preview.mockResolvedValue({ report: makeReport(0), relativePaths: ['a.ts'] });
            mockAnalyzeTier1.mockReturnValue(blockingTier1);

            const p1 = orchestrator.scheduleRevalidation('interactive', sendAnalysis);
            const p2 = orchestrator.scheduleRevalidation('interactive', sendAnalysis);
            resolveFirst();
            await Promise.all([p1, p2]);

            expect(mockAnalyzeTier1).toHaveBeenCalledTimes(1);
        });

        it('calls sendAnalysis again with fresh report on background completion', async () => {
            const staleReport = makeReport(1);
            const freshReport = makeReport(1);
            cache.store(staleReport, new Map(), 'interactive');
            cache.markStale();

            mockAnalyzeTier0.mockResolvedValue({ report: makeReport(0), files: new Map([['a.ts', '']]) });
            mockAnalyzeTier0Preview.mockResolvedValue({ report: makeReport(0), relativePaths: ['a.ts'] });
            mockAnalyzeTier1.mockResolvedValue(freshReport);

            await orchestrator.scheduleRevalidation('interactive', sendAnalysis);

            expect(sendAnalysis).toHaveBeenCalledTimes(4); // stale + tier0Preview + tier0 + tier1
            expect(sendAnalysis).toHaveBeenLastCalledWith(freshReport);
        });

        it('falls back to runScoped when cache is empty (not stale)', async () => {
            const tier1Report = makeReport(1);
            mockAnalyzeTier0.mockResolvedValue({ report: makeReport(0), files: new Map([['a.ts', '']]) });
            mockAnalyzeTier0Preview.mockResolvedValue({ report: makeReport(0), relativePaths: ['a.ts'] });
            mockAnalyzeTier1.mockResolvedValue(tier1Report);

            const capturedCalls: unknown[] = [];
            const trackingSend = vi.fn((r) => capturedCalls.push(r));
            await orchestrator.scheduleRevalidation('interactive', trackingSend);

            // No stale send at start — should have been called via runScoped path
            expect(mockAnalyzeTier1).toHaveBeenCalledTimes(1);
            // sendAnalysis called with fresh (not stale) data
            expect(trackingSend).toHaveBeenCalledWith(tier1Report);
        });

        it('swallows background errors without propagating', async () => {
            cache.store(makeReport(1), new Map(), 'interactive');
            cache.markStale();

            mockAnalyzeTier0.mockResolvedValue({ report: makeReport(0), files: new Map([['a.ts', '']]) });
            mockAnalyzeTier0Preview.mockResolvedValue({ report: makeReport(0), relativePaths: ['a.ts'] });
            mockAnalyzeTier1.mockRejectedValue(new Error('analysis failed'));

            await expect(orchestrator.scheduleRevalidation('interactive', sendAnalysis)).resolves.not.toThrow();
        });

        it('cache remains stale after background error', async () => {
            cache.store(makeReport(1), new Map(), 'interactive');
            cache.markStale();

            mockAnalyzeTier0.mockResolvedValue({ report: makeReport(0), files: new Map([['a.ts', '']]) });
            mockAnalyzeTier0Preview.mockResolvedValue({ report: makeReport(0), relativePaths: ['a.ts'] });
            mockAnalyzeTier1.mockRejectedValue(new Error('analysis failed'));

            await orchestrator.scheduleRevalidation('interactive', sendAnalysis);

            expect(cache.isStale).toBe(true);
        });

        it('stale report served synchronously (microtask timing)', async () => {
            const stale = makeReport(1);
            cache.store(stale, new Map(), 'interactive');
            cache.markStale();

            mockAnalyzeTier0.mockResolvedValue({ report: makeReport(0), files: new Map([['a.ts', '']]) });
            mockAnalyzeTier0Preview.mockResolvedValue({ report: makeReport(0), relativePaths: ['a.ts'] });
            mockAnalyzeTier1.mockResolvedValue(makeReport(1));

            let syncCallCount = 0;
            const trackingSend = vi.fn(() => { syncCallCount++; });
            orchestrator.scheduleRevalidation('interactive', trackingSend);
            // Before any await/microtask resolution, stale was served
            expect(syncCallCount).toBe(1);
            expect(trackingSend).toHaveBeenCalledWith(stale);
        });

        it('discards in-flight result when invalidate fires — isStale is false', async () => {
            cache.store(makeReport(1), new Map(), 'interactive');
            cache.markStale();

            let resolveBackground!: (r: ReturnType<typeof makeReport>) => void;
            const blockingTier1 = new Promise<ReturnType<typeof makeReport>>((resolve) => {
                resolveBackground = resolve;
            });
            mockAnalyzeTier0.mockResolvedValue({ report: makeReport(0), files: new Map([['a.ts', '']]) });
            mockAnalyzeTier0Preview.mockResolvedValue({ report: makeReport(0), relativePaths: ['a.ts'] });
            mockAnalyzeTier1.mockReturnValue(blockingTier1);

            const p = orchestrator.scheduleRevalidation('interactive', sendAnalysis);
            // invalidate fires while background is in-flight
            cache.invalidate();
            resolveBackground(makeReport(1));
            await p;

            // After everything settles: invalidate cleared stale flag, background couldn't re-set it (version mismatch)
            expect(cache.isStale).toBe(false);
        });

        it('discards in-flight result when invalidate fires — fresh data not cached', async () => {
            cache.store(makeReport(1), new Map(), 'interactive');
            cache.markStale();

            let resolveBackground!: (r: ReturnType<typeof makeReport>) => void;
            const blockingTier1 = new Promise<ReturnType<typeof makeReport>>((resolve) => {
                resolveBackground = resolve;
            });
            mockAnalyzeTier0.mockResolvedValue({ report: makeReport(0), files: new Map([['a.ts', '']]) });
            mockAnalyzeTier0Preview.mockResolvedValue({ report: makeReport(0), relativePaths: ['a.ts'] });
            mockAnalyzeTier1.mockReturnValue(blockingTier1);

            const p = orchestrator.scheduleRevalidation('interactive', sendAnalysis);
            cache.invalidate();
            resolveBackground(makeReport(1));
            await p;

            expect(cache.getCachedTier1('interactive')).toBeUndefined();
        });

        it('isStale is false after successful background revalidation', async () => {
            cache.store(makeReport(1), new Map(), 'interactive');
            cache.markStale();

            mockAnalyzeTier0.mockResolvedValue({ report: makeReport(0), files: new Map([['a.ts', '']]) });
            mockAnalyzeTier0Preview.mockResolvedValue({ report: makeReport(0), relativePaths: ['a.ts'] });
            mockAnalyzeTier1.mockResolvedValue(makeReport(1));

            await orchestrator.scheduleRevalidation('interactive', sendAnalysis);

            expect(cache.isStale).toBe(false);
        });
    });
});
