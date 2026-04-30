import type { AnalysisReport, TourType } from '../types';

export interface TourTypeQuickPickOption {
    label: string;
    description: string;
    type: TourType;
}

/** Built-in quick-pick choices exposed by the generate-tour command. */
export const TOUR_TYPE_QUICK_PICK_OPTIONS: TourTypeQuickPickOption[] = [
    { label: '🗺️ Architecture Overview', description: 'High-level overview of the codebase', type: 'overview' },
    { label: '🔄 Data Flow Trace', description: 'Follow data from input to output', type: 'data-flow' },
    { label: '👋 New Developer Onboarding', description: 'Your first day on this codebase', type: 'onboarding' },
    { label: '🔍 Dependency Audit', description: 'Circular deps, coupling, tech debt', type: 'dependency-audit' },
    { label: '🌐 API Surface', description: 'Map external endpoints and interfaces', type: 'api-surface' },
    { label: '💬 Custom Question', description: 'Ask anything about the codebase', type: 'custom' },
];

/** Creates the command handler that prompts for a tour type and launches generation. */
export function createGenerateTourHandler(deps: {
    promptForTourType: () => Promise<TourTypeQuickPickOption | undefined>;
    promptForCustomQuery: () => Promise<string | undefined>;
    generateAndShowTour: (query: string, tourType: TourType) => Promise<void>;
}): () => Promise<void> {
    return async () => {
        const selected = await deps.promptForTourType();
        if (!selected) return;

        let query = selected.description;
        if (selected.type === 'custom') {
            const input = await deps.promptForCustomQuery();
            if (!input) return;
            query = input;
        }

        await deps.generateAndShowTour(query, selected.type);
    };
}

/** Summarizes a completed analysis run for user-facing prompts. */
export function buildAnalysisCompleteMessage(report: AnalysisReport): string {
    const scopeLabel = report.completeness
        ? `Scope: ${report.completeness.analysisScope} ${report.completeness.graphCoverage} overview`
        : undefined;
    const runtimeEntryCount = report.entryPoints.filter((entryPoint) => (entryPoint.entrySurface ?? 'runtime') === 'runtime').length;
    const launchSurfaceCount = report.entryPoints.length - runtimeEntryCount;

    return [
        '📊 Analysis Complete',
        `Files: ${report.metrics.totalFiles}`,
        `Lines: ${report.metrics.totalLines.toLocaleString()}`,
        `Dependencies: ${report.dependencyGraph.edges.length} edges`,
        `Frameworks: ${report.frameworks.map((framework) => framework.name).join(', ') || 'None detected'}`,
        `Entry Points: ${runtimeEntryCount}`,
        launchSurfaceCount > 0 ? `Launch Surfaces: ${launchSurfaceCount}` : undefined,
        scopeLabel,
        report.dependencyGraph.circularDependencies.length > 0
            ? `⚠️ Circular Deps: ${report.dependencyGraph.circularDependencies.length}`
            : '✅ No circular dependencies',
    ].filter(Boolean).join(' | ');
}

/** Factory for the clearCache command handler. */
export function createClearCacheHandler(deps: {
    getWorkspaceRoot: () => string | undefined;
    showNoWorkspaceError: () => void;
    deleteDbFile: (dbPath: string) => Promise<void>;
    invalidateMemoryCache: () => void;
    showConfirmation: (message: string) => void;
}): () => Promise<void> {
    return async () => {
        const root = deps.getWorkspaceRoot();
        if (!root) {
            deps.showNoWorkspaceError();
            return;
        }

        const dbPath = `${root}/.reponav/index.db`;
        await deps.deleteDbFile(dbPath);
        deps.invalidateMemoryCache();
        deps.showConfirmation('RepoNav: Cache cleared. Next analysis will rebuild from scratch.');
    };
}

/** Creates the command handler that runs analysis and offers tour generation. */
export function createAnalyzeWorkspaceHandler(deps: {
    getWorkspaceRoot: () => string | undefined;
    showNoWorkspaceError: () => void;
    runAnalysis: () => Promise<AnalysisReport>;
    promptAfterAnalysis: (message: string) => Promise<string | undefined>;
    executeGenerateTour: () => void | Promise<void>;
}): () => Promise<void> {
    return async () => {
        if (!deps.getWorkspaceRoot()) {
            deps.showNoWorkspaceError();
            return;
        }

        const report = await deps.runAnalysis();
        const message = buildAnalysisCompleteMessage(report);
        const action = await deps.promptAfterAnalysis(message);

        if (action === 'Generate Tour') {
            await deps.executeGenerateTour();
        }
    };
}
