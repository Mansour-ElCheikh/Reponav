import type { AnalysisCompleteness, AnalysisReport, AnalysisScope } from '../types';

type CompletenessSource = Pick<AnalysisReport, 'metrics' | 'dependencyGraph' | 'completeness'>;

/**
 * Derive user-facing completeness metadata from a finished analysis report.
 */
export function buildAnalysisCompleteness(
    report: CompletenessSource,
    scope: AnalysisScope
): AnalysisCompleteness {
    const inherited = report.completeness;
    const analysisCoverage = inherited?.analysisCoverage ?? (scope === 'fullWorkspace' ? 'complete' : 'sampled');
    const graphCoverage = inherited?.graphCoverage ?? (scope === 'fullWorkspace' ? 'complete' : 'sampled');
    const graphSampleLimit = inherited?.graphSampleLimit;
    const cappedAt = inherited?.cappedAt ?? graphSampleLimit;
    const isSampled = inherited?.isSampled ?? (analysisCoverage === 'sampled' || graphCoverage === 'sampled');

    return {
        analysisScope: scope,
        analyzedFileCount: report.metrics.totalFiles,
        graphNodeCount: report.dependencyGraph.nodes.length,
        graphEdgeCount: report.dependencyGraph.edges.length,
        ...(graphSampleLimit !== undefined ? { graphSampleLimit } : {}),
        analysisCoverage,
        graphCoverage,
        isSampled,
        ...(cappedAt !== undefined ? { cappedAt } : {}),
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
