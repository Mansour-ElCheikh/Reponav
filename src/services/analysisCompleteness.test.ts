import { describe, it, expect } from 'vitest';
import { buildAnalysisCompleteness, withAnalysisCompleteness } from './analysisCompleteness';

describe('analysisCompleteness', () => {
    const mockReport = {
        metrics: { totalFiles: 100 },
        dependencyGraph: { nodes: new Array(50), edges: new Array(20) },
    };

    it('should report "complete" coverage for fullWorkspace scope', () => {
        const result = buildAnalysisCompleteness(mockReport as any, 'fullWorkspace');
        expect(result.analysisCoverage).toBe('complete');
        expect(result.graphCoverage).toBe('complete');
        expect(result.analyzedFileCount).toBe(100);
        expect(result.graphNodeCount).toBe(50);
        expect(result.isSampled).toBe(false);
        expect(result.cappedAt).toBeUndefined();
    });

    it('should expose sampled/capped metadata for interactive scope when a prior cap exists', () => {
        const result = buildAnalysisCompleteness({
            ...mockReport,
            completeness: {
                analysisScope: 'interactive',
                analyzedFileCount: 100,
                graphNodeCount: 50,
                graphEdgeCount: 20,
                graphSampleLimit: 200,
                analysisCoverage: 'sampled',
                graphCoverage: 'sampled',
            },
        } as any, 'interactive');
        expect(result.analysisCoverage).toBe('sampled');
        expect(result.graphCoverage).toBe('sampled');
        expect(result.isSampled).toBe(true);
        expect(result.cappedAt).toBe(200);
    });

    it('should correctly attach completeness to a report object', () => {
        const report = {
            ...mockReport,
            completeness: {
                analysisScope: 'interactive',
                analyzedFileCount: 100,
                graphNodeCount: 50,
                graphEdgeCount: 20,
                graphSampleLimit: 500,
                analysisCoverage: 'sampled',
                graphCoverage: 'sampled',
            },
        } as any;
        withAnalysisCompleteness(report, 'interactive');
        expect(report.completeness).toBeDefined();
        expect(report.completeness.analysisCoverage).toBe('sampled');
        expect(report.completeness.isSampled).toBe(true);
        expect(report.completeness.cappedAt).toBe(500);
    });
});
