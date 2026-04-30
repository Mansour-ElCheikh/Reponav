import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as handlers from './reponavCommands';
import * as analyzers from '../analyzers/index';
import type { WorkspaceAdapter } from '../WorkspaceAdapter';

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
