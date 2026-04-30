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
        expect(result.analyzedFileCount).toBe(100);
        expect(result.graphNodeCount).toBe(50);
    });

    it('should report "sampled" coverage for changedFiles scope', () => {
        const result = buildAnalysisCompleteness(mockReport as any, 'changedFiles');
        expect(result.analysisCoverage).toBe('sampled');
    });

    it('should correctly attach completeness to a report object', () => {
        const report = { ...mockReport } as any;
        withAnalysisCompleteness(report, 'fullWorkspace');
        expect(report.completeness).toBeDefined();
        expect(report.completeness.analysisCoverage).toBe('complete');
    });
});
