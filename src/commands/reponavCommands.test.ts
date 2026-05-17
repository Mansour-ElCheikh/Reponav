import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as handlers from './reponavCommands';
import * as analyzers from '../analyzers/index';
import type { WorkspaceAdapter } from '../WorkspaceAdapter';
import type { AnalysisReport } from '../types';

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

describe('reponavCommands handlers', () => {
    const mockAdapter = {
        getWorkspaceRoot: vi.fn().mockReturnValue('/repo'),
        findFiles: vi.fn().mockResolvedValue([]),
        readFile: vi.fn().mockResolvedValue(null),
        getConfig: vi.fn(),
        showInfo: vi.fn(),
        showError: vi.fn(),
    } as unknown as WorkspaceAdapter;
    const mockTreeSitter = {} as any;

    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('buildSummaryPayload', () => {
        function makeSummaryReport(): AnalysisReport {
            return {
                timestamp: new Date().toISOString(),
                workspaceRoot: '/repo',
                indexTier: 6,
                frameworks: [{ name: 'React', type: 'framework', evidence: 'pkg' }],
                primaryLanguage: 'typescript',
                entryPoints: [
                    { file: 'src/main.ts', type: 'main', entrySurface: 'runtime', confidence: 'high', reason: 'bootstrap' },
                    { file: 'bin/reponav.ts', type: 'cli', entrySurface: 'tooling', confidence: 'high', reason: 'cli' },
                ],
                dependencyGraph: {
                    nodes: ['src/main.ts', 'src/app.ts', 'src/lib.ts', 'bin/reponav.ts'],
                    edges: [
                        { source: 'src/app.ts', target: 'src/lib.ts', specifiers: [], isDynamic: false, rawStatement: '' },
                        { source: 'src/main.ts', target: 'src/app.ts', specifiers: [], isDynamic: false, rawStatement: '' },
                        { source: 'bin/reponav.ts', target: 'src/lib.ts', specifiers: [], isDynamic: false, rawStatement: '' },
                    ],
                    circularDependencies: [],
                },
                fileClassifications: [],
                metrics: {
                    totalFiles: 4,
                    totalLines: 100,
                    fileMetrics: [
                        { path: 'src/main.ts', lines: 10, importCount: 1, exportCount: 1, fanIn: 0, fanOut: 1, instability: 1 },
                        { path: 'src/app.ts', lines: 20, importCount: 1, exportCount: 1, fanIn: 1, fanOut: 1, instability: 0.5 },
                        { path: 'src/lib.ts', lines: 30, importCount: 0, exportCount: 1, fanIn: 2, fanOut: 0, instability: 0 },
                        { path: 'bin/reponav.ts', lines: 12, importCount: 1, exportCount: 1, fanIn: 0, fanOut: 1, instability: 1 },
                    ],
                    hotFiles: [
                        { path: 'src/lib.ts', lines: 30, importCount: 0, exportCount: 1, fanIn: 2, fanOut: 0, instability: 0 },
                    ],
                    orphanFiles: ['src/orphan.ts'],
                },
                temporal: {
                    averageChurn: 1,
                    mostUnstableFiles: ['src/app.ts'],
                    hotspots: [
                        { filePath: 'src/lib.ts', commitCount: 5, lastChangedAt: '2026-05-02T00:00:00.000Z', complexityScore: 2, riskScore: 4 },
                        { filePath: 'src/app.ts', commitCount: 3, lastChangedAt: '2026-01-10T00:00:00.000Z', complexityScore: 2, riskScore: 2 },
                    ],
                    knowledge: [
                        {
                            filePath: 'src/app.ts',
                            owners: [
                                { name: 'Alice', email: 'alice@example.com', commitCount: 5, percentage: 83 },
                                { name: 'Bob', email: 'bob@example.com', commitCount: 1, percentage: 17 },
                            ],
                        },
                        {
                            filePath: 'src/lib.ts',
                            owners: [
                                { name: 'Carol', email: 'carol@example.com', commitCount: 2, percentage: 100 },
                            ],
                        },
                    ],
                },
                completeness: {
                    analysisScope: 'fullWorkspace',
                    analyzedFileCount: 4,
                    graphNodeCount: 4,
                    graphEdgeCount: 3,
                    analysisCoverage: 'complete',
                    graphCoverage: 'complete',
                    isSampled: false,
                },
                fileTree: {},
                keyFileContents: {},
            };
        }

        it('adds runtime roots, launch surfaces, and family-grouped signals without dropping legacy fields', () => {
            const payload = handlers.buildSummaryPayload(makeSummaryReport()) as Record<string, any>;

            expect(payload.entryPoints).toHaveLength(2);
            expect(payload.hotFiles).toHaveLength(1);
            expect(payload.orphanCount).toBe(1);
            expect(payload.circularDeps).toBe(0);
            expect(payload.runtimeRoots).toEqual(['src/main.ts']);
            expect(payload.launchSurfaces).toEqual(['bin/reponav.ts']);
            expect(payload.architecture).toEqual(expect.arrayContaining([
                expect.objectContaining({ id: 'instability', family: 'architecture', kind: 'derived', basis: 'fullWorkspace' }),
                expect.objectContaining({ id: 'propagation-reach', family: 'architecture', kind: 'derived', basis: 'fullWorkspace' }),
            ]));
            expect(payload.risk).toEqual(expect.arrayContaining([
                expect.objectContaining({ id: 'temporal-hotspots', family: 'risk', kind: 'fact' }),
                expect.objectContaining({ id: 'ownership-concentration', family: 'risk', kind: 'derived' }),
                expect.objectContaining({ id: 'dangerous-hotspots', family: 'risk', kind: 'derived' }),
            ]));
            expect(payload.confidence).toEqual(expect.arrayContaining([
                expect.objectContaining({ id: 'analysis-completeness', family: 'confidence', kind: 'fact' }),
            ]));
        });

        it('carries sampled and capped truth into grouped signal envelopes', () => {
            const report = makeSummaryReport();
            report.completeness = {
                ...report.completeness!,
                analysisScope: 'interactive',
                analysisCoverage: 'sampled',
                graphCoverage: 'sampled',
                isSampled: true,
                cappedAt: 200,
            };

            const payload = handlers.buildSummaryPayload(report) as Record<string, any>;
            const architectureSignal = payload.architecture[0];
            const confidenceSignal = payload.confidence[0];

            expect(architectureSignal).toEqual(expect.objectContaining({
                basis: 'interactive',
                sampled: true,
                cappedAt: 200,
            }));
            expect(confidenceSignal.data).toEqual(expect.objectContaining({
                analysisScope: 'interactive',
                isSampled: true,
                cappedAt: 200,
            }));
        });

        it('surfaces ownership concentration and dangerous hotspots truthfully', () => {
            const payload = handlers.buildSummaryPayload(makeSummaryReport()) as Record<string, any>;
            const ownership = payload.risk.find((signal: Record<string, any>) => signal.id === 'ownership-concentration');
            const dangerous = payload.risk.find((signal: Record<string, any>) => signal.id === 'dangerous-hotspots');

            expect(ownership.data.thresholdPercentage).toBe(75);
            // Non-sparse concentration must surface.
            expect(ownership.data.ranked).toEqual(expect.arrayContaining([
                expect.objectContaining({
                    file: 'src/app.ts',
                    dominantPercentage: 83,
                    totalCommits: 6,
                    sparseHistory: false,
                    flagged: true,
                }),
            ]));
            // Sparse-history rows are excluded — basis (≥4 commits) does not support a concentration claim.
            expect(ownership.data.ranked.find((r: { file: string }) => r.file === 'src/lib.ts')).toBeUndefined();

            expect(dangerous.data.formula).toBe('score = recencyWeightedChurn * fanIn');
            expect(dangerous.data.structuralCentralityMetric).toBe('fanIn');
            expect(dangerous.data).not.toHaveProperty('weights');
            expect(dangerous.data.ranked[0]).toEqual(expect.objectContaining({
                file: 'src/lib.ts',
                fanIn: 2,
            }));
        });

        it('rejects duplicate signal ids across families', () => {
            expect(() => handlers.validateSummarySignalContract([
                { id: 'instability', family: 'architecture', kind: 'derived' },
                { id: 'instability', family: 'risk', kind: 'fact' },
            ] as any)).toThrow(/instability/);
        });

        it('rejects unlabeled signal definitions', () => {
            expect(() => handlers.validateSummarySignalContract([
                { id: 'unlabeled-signal', family: 'architecture' },
            ] as any)).toThrow(/Invalid summary signal definition/);
        });
    });

    describe('runAnalyze', () => {
        it('should orchestrate analysis up to the requested tier', async () => {
            const mockReport = { metrics: { totalFiles: 5 }, dependencyGraph: { nodes: [], edges: [] } };
            const mockTier0 = { report: mockReport, files: new Map() };
            vi.mocked(analyzers.analyzeTier0).mockResolvedValue(mockTier0 as any);
            vi.mocked(analyzers.analyzeTier1).mockResolvedValue(mockReport as any);
            vi.mocked(analyzers.analyzeTier2).mockResolvedValue(mockReport as any);

            const result = await handlers.runAnalyze('/repo', 'json', 2, mockAdapter, mockTreeSitter);

            expect(result.exitCode).toBe(0);
            expect(analyzers.analyzeTier0).toHaveBeenCalled();
            expect(analyzers.analyzeTier1).toHaveBeenCalled();
            expect(analyzers.analyzeTier2).toHaveBeenCalled();
            expect(analyzers.analyzeTier3).not.toHaveBeenCalled();
        });

        it('should support TOON format output', async () => {
             const mockTier0 = { 
                report: { 
                    frameworks: [], 
                    primaryLanguage: 'TS', 
                    entryPoints: [], 
                    dependencyGraph: { nodes: [], edges: [], circularDependencies: [] }, 
                    metrics: { totalFiles: 0, totalLines: 0, hotFiles: [], fileMetrics: [] }, 
                    fileClassifications: [], 
                    keyFileContents: {} 
                }, 
                files: new Map() 
            };
             vi.mocked(analyzers.analyzeTier0).mockResolvedValue(mockTier0 as any);

             const result = await handlers.runAnalyze('/repo', 'toon', 0, mockAdapter, mockTreeSitter);
             expect(result.output).toContain('@stats');
        });
    });

    describe('runCheck', () => {
        it('should exit 1 if violation thresholds are breached', async () => {
            const mockReport = {
                layerViolations: new Array(10),
                deadCode: [],
                symbols: [],
                symbolEdges: [],
                metrics: { totalFiles: 1 },
                dependencyGraph: { nodes: [], edges: [] }
            };
            vi.mocked(analyzers.analyzeTier0).mockResolvedValue({ report: mockReport, files: new Map() } as any);
            vi.mocked(analyzers.analyzeTier1).mockResolvedValue(mockReport as any);
            vi.mocked(analyzers.analyzeTier2).mockResolvedValue(mockReport as any);
            vi.mocked(analyzers.analyzeTier3).mockResolvedValue(mockReport as any);

            const result = await handlers.runCheck('/repo', 5, 100, 100, mockAdapter, mockTreeSitter);

            expect(result.exitCode).toBe(1);
            expect(result.output).toContain('layer-violations: 10 > max 5');
        });

        it('should exit 0 if all metrics are within bounds', async () => {
            const mockReport = {
                layerViolations: [],
                deadCode: [],
                symbols: [],
                symbolEdges: [],
                metrics: { totalFiles: 1 },
                dependencyGraph: { nodes: [], edges: [] }
            };
            vi.mocked(analyzers.analyzeTier0).mockResolvedValue({ report: mockReport, files: new Map() } as any);
            vi.mocked(analyzers.analyzeTier1).mockResolvedValue(mockReport as any);
            vi.mocked(analyzers.analyzeTier2).mockResolvedValue(mockReport as any);
            vi.mocked(analyzers.analyzeTier3).mockResolvedValue(mockReport as any);

            const result = await handlers.runCheck('/repo', 10, 10, 10, mockAdapter, mockTreeSitter);
            expect(result.exitCode).toBe(0);
        });
    });
});
