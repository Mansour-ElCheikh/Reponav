import type { AnalysisScope } from '../analyzers/index';
import { enrichAnalysisReport } from '../analyzers/symbolEnrichment';
import type { SymbolEnricher } from '../analyzers/symbolEnrichment';
import type { AnalysisReport, SymbolInfo } from '../types';
import { withAnalysisCompleteness } from './analysisCompleteness';

const MAX_PRIORITIZED_HOT_FILES = 25;

interface HydrateEnrichmentOptions {
    scope: AnalysisScope;
    files: Map<string, string>;
    report: AnalysisReport;
    sendAnalysis: (report: AnalysisReport) => void;
    symbolEnricher?: SymbolEnricher;
    workspaceVersionAtStart: number;
    getWorkspaceVersion: () => number;
    getCachedSymbols: (filePath: string, contentHash: string) => SymbolInfo[] | undefined;
    storeCachedSymbols: (filePath: string, contentHash: string, symbols: SymbolInfo[]) => void;
    storeReport: (report: AnalysisReport, files: Map<string, string>, scope: AnalysisScope) => void;
}

/**
 * Normalize scope/completeness metadata before reports cross the webview boundary.
 */
export function withCompleteness(report: AnalysisReport, scope: AnalysisScope): AnalysisReport {
    return withAnalysisCompleteness(report, scope);
}

/**
 * Prioritize entry-point and hottest files for best-effort background symbol enrichment.
 */
export function prioritizeEnrichmentPaths(report: AnalysisReport): string[] {
    const prioritized = new Set<string>();

    for (const entryPoint of report.entryPoints) {
        prioritized.add(entryPoint.file);
    }

    for (const hotFile of report.metrics.fileMetrics.slice(0, MAX_PRIORITIZED_HOT_FILES)) {
        prioritized.add(hotFile.path);
    }

    return [...prioritized];
}

/**
 * Apply host-only symbol enrichment in the background without delaying deterministic Tier 2.
 */
export async function hydrateEnrichmentInBackground(options: HydrateEnrichmentOptions): Promise<void> {
    if (!options.symbolEnricher) {
        return;
    }

    const enrichedReport = withCompleteness(
        await enrichAnalysisReport(options.report, options.files, options.symbolEnricher, {
            maxConcurrency: 8,
            priorityPaths: prioritizeEnrichmentPaths(options.report),
            getCachedSymbols: options.getCachedSymbols,
            storeCachedSymbols: options.storeCachedSymbols,
        }),
        options.scope,
    );

    if (options.getWorkspaceVersion() !== options.workspaceVersionAtStart) {
        return;
    }

    options.storeReport(enrichedReport, options.files, options.scope);
    options.sendAnalysis(enrichedReport);
}
