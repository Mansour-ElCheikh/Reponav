import type { AnalysisCompleteness, AnalysisReport, AnalysisScope } from '../types';

type CompletenessSource = Pick<AnalysisReport, 'metrics' | 'dependencyGraph'>;

/**
 * Derive user-facing completeness metadata from a finished analysis report.
 */
export function buildAnalysisCompleteness(
    report: CompletenessSource,
    scope: AnalysisScope
): AnalysisCompleteness {
    return {
        analysisScope: scope,
        analyzedFileCount: report.metrics.totalFiles,
        graphNodeCount: report.dependencyGraph.nodes.length,
        graphEdgeCount: report.dependencyGraph.edges.length,
        analysisCoverage: scope === 'fullWorkspace' ? 'complete' : 'sampled',
        graphCoverage: 'complete',
    };
}

/**
 * Attach completeness metadata in-place so downstream callers can reuse a single contract.
 */
export function withAnalysisCompleteness<T extends CompletenessSource & {
    completeness?: AnalysisCompleteness;
}>(report: T, scope: AnalysisScope): T {
    report.completeness = buildAnalysisCompleteness(report, scope);
    return report;
}
