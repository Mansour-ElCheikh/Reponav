import { describe, expect, it, vi } from 'vitest';
import { enrichAnalysisReport } from '../analyzers/symbolEnrichment';
import type { AnalysisReport } from '../types';
import { hydrateEnrichmentInBackground, prioritizeEnrichmentPaths, withCompleteness } from './analysisReportHydration';

vi.mock('../analyzers/symbolEnrichment', () => ({
    enrichAnalysisReport: vi.fn(),
}));

const mockEnrichAnalysisReport = vi.mocked(enrichAnalysisReport);

function makeReport(): AnalysisReport {
    return {
        timestamp: new Date().toISOString(),
        workspaceRoot: '/test',
        indexTier: 2,
        frameworks: [],
        primaryLanguage: 'typescript',
        entryPoints: [{ file: 'src/index.ts', type: 'main', confidence: 'high', reason: 'entry' }],
        dependencyGraph: { nodes: ['src/index.ts'], edges: [], circularDependencies: [] },
        fileClassifications: [],
        metrics: {
            totalFiles: 30,
            totalLines: 100,
            fileMetrics: Array.from({ length: 30 }, (_, index) => ({
                path: index === 0 ? 'src/index.ts' : `src/file-${index}.ts`,
                lines: 1,
                importCount: 0,
                exportCount: 0,
                fanIn: 0,
                fanOut: 0,
            })),
            hotFiles: [],
            orphanFiles: [],
        },
        fileTree: {},
        keyFileContents: {},
    };
}

describe('analysisReportHydration', () => {
    it('prioritizes entry points, dedupes them, and caps hot files at 25', () => {
        const prioritized = prioritizeEnrichmentPaths(makeReport());

        expect(prioritized[0]).toBe('src/index.ts');
        expect(new Set(prioritized).size).toBe(prioritized.length);
        expect(prioritized).toHaveLength(25);
        expect(prioritized).toContain('src/file-24.ts');
        expect(prioritized).not.toContain('src/file-25.ts');
    });

    it('publishes an enriched report when the workspace version is unchanged', async () => {
        const report = makeReport();
        const files = new Map([['src/index.ts', 'code']]);
        const enriched = { ...report, symbols: [] };
        const sendAnalysis = vi.fn();
        const storeReport = vi.fn();

        mockEnrichAnalysisReport.mockResolvedValue(enriched);

        await hydrateEnrichmentInBackground({
            scope: 'interactive',
            files,
            report,
            sendAnalysis,
            symbolEnricher: { enrichSymbol: vi.fn() } as any,
            workspaceVersionAtStart: 4,
            getWorkspaceVersion: () => 4,
            getCachedSymbols: vi.fn(),
            storeCachedSymbols: vi.fn(),
            storeReport,
        });

        expect(storeReport).toHaveBeenCalledWith(withCompleteness(enriched, 'interactive'), files, 'interactive');
        expect(sendAnalysis).toHaveBeenCalledWith(withCompleteness(enriched, 'interactive'));
    });
});