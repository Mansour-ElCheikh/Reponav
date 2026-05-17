/**
 * Shared type definitions for RepoNav.
 *
 * This file is the single source of truth for types used by both
 * the extension host (src/) and the webview (webview/src/).
 * Do NOT duplicate these types elsewhere.
 */

// ─── File Category ──────────────────────────────────────────────────────────

export type FileCategory =
    | 'entry' | 'route' | 'controller' | 'service' | 'model'
    | 'component' | 'utility' | 'config' | 'middleware' | 'test'
    | 'style' | 'asset' | 'migration' | 'type' | 'libSource'
    | 'e2e' | 'example' | 'fixture' | 'archive'
    | 'unknown';

export type EntrySurface = 'runtime' | 'tooling';

export type AnalysisScope = 'interactive' | 'fullWorkspace' | 'diff';

export type CompletenessCoverage = 'complete' | 'sampled';

/** User-facing metadata that explains how complete an analysis or graph view is. */
export interface AnalysisCompleteness {
    analysisScope: AnalysisScope;
    analyzedFileCount: number;
    graphNodeCount: number;
    graphEdgeCount: number;
    graphSampleLimit?: number;
    analysisCoverage: CompletenessCoverage;
    graphCoverage: CompletenessCoverage;
    isSampled?: boolean;
    cappedAt?: number;
}

// ─── Tour Types ─────────────────────────────────────────────────────────────

export type TourType =
    | 'overview' | 'data-flow' | 'onboarding'
    | 'dependency-audit' | 'api-surface' | 'custom';

export interface CodeHighlight {
    file: string;
    lines: number[];
}

export interface FileRelationship {
    from: string;
    to: string;
    type: 'imports' | 'calls' | 'extends' | 'implements' | 'uses' | 'configures' | 'validates' | 'transforms' | 'persists';
}

export interface TourStep {
    order: number;
    title: string;
    what_it_does: string;
    why_it_matters: string;
    watch_out: string;
    files: string[];
    highlights: CodeHighlight[];
    relationships: FileRelationship[];
}

export interface GraphNode {
    id: string;
    label: string;
    type: FileCategory;
    weight?: number;
    /** When true, this node represents a directory cluster rather than a single file. */
    isCluster?: boolean;
    /** Number of child nodes inside this cluster (only set when isCluster is true). */
    childCount?: number;
    /** Parent directory path this node belongs to (set on both cluster nodes and their children). */
    directory?: string;
}

export interface GraphEdge {
    source: string;
    target: string;
    label: string;
    isCircular?: boolean;
}

export interface TourGraph {
    nodes: GraphNode[];
    edges: GraphEdge[];
}

export interface Tour {
    id: string;
    query: string;
    tourType: TourType;
    steps: TourStep[];
    graph: TourGraph;
    analysisSnapshot: {
        frameworks: string[];
        entryPoints: string[];
        /** Tooling/operational launch surfaces kept separate from runtime entry points. */
        launchSurfaces?: string[];
        totalFiles: number;
        totalEdges: number;
        /** Number of circular dependency cycles detected. 0 when none found. */
        circularCount: number;
        /** Explains whether the accompanying graph is complete or sampled. */
        completeness?: AnalysisCompleteness;
    };
    createdAt: string;
    /** Whether this tour was generated with real AI narration (vs structural fallback). */
    aiGenerated?: boolean;
}

// ─── Analysis Report (subset needed by webview) ─────────────────────────────

export interface AnalysisReportSummary {
    indexTier?: 0 | 1 | 2 | 3 | 4 | 5 | 6;
    frameworks: Array<{ name: string; version?: string; type: string }>;
    /** Explains whether the analysis and graph are complete or sampled. */
    completeness?: AnalysisCompleteness;
    /** Runtime entry points only. Tooling launch surfaces are exposed separately. */
    entryPoints?: string[];
    /** Tooling/operational launch surfaces kept separate from runtime entry points. */
    launchSurfaces?: string[];
    metrics: {
        totalFiles: number;
        totalLines: number;
    };
    dependencyGraph: {
        edges: Array<{ source: string; target: string }>;
        /** Number of circular dependency cycles detected. Present for Tier 1+ reports. */
        circularDependencies?: number;
    };
    /** File paths of symbols flagged as dead code. Present for Tier 2+ reports. */
    deadCodeFiles?: string[];
    /** Number of co-change pairs mined from git history. Present for Tier 2+ reports. */
    changeCouplingCount?: number;
    /** Human-readable hints about repo character (e.g. library-source warning). */
    analysisHints?: string[];
    /** Number of flow sequences traced from entry points. Present for Tier 2+ reports. */
    flowCount?: number;
    /** Flow sequences from entry points to terminal nodes. Present for Tier 2+ reports. */
    flows?: FlowSequence[];
    /** Number of tooling/operational flows hidden from the default shared flow view. */
    toolingFlowCount?: number;
    /** Entry points for tooling/operational flows hidden from the default shared flow view. */
    toolingEntryPoints?: string[];
}

/** One hop in a flow trace — a single file visited during the DFS. */
export interface FlowStep {
    filePath: string;
    fileCategory: FileCategory;
    layer: number;
    symbolName?: string;
}

/** An edge in the flow trace that violates the expected layer ordering. */
export interface FlowAnomaly {
    fromFile: string;
    toFile: string;
    direction: 'backward' | 'skip-layer';
}

/** A traced execution sequence from an entry point to a terminal node. */
export interface FlowSequence {
    id: string;
    entryPoint: string;
    entrySurface?: EntrySurface;
    steps: FlowStep[];
    anomalies: FlowAnomaly[];
    depthCapped?: boolean;
}

export interface AppConfig {
    demoMode: boolean;
}

// ─── WebView Message Protocol ───────────────────────────────────────────────

export type TourStreamChunkMessage =
    | { type: 'tour.stream_chunk'; payload: { type: 'graph'; data: Tour } }
    | { type: 'tour.stream_chunk'; payload: { type: 'step'; data: TourStep } };

export type TourStreamEndMessage = { type: 'tour.stream_end' };

export type ExtensionToWebviewMessage =
    | { type: 'tourGenerated'; tour: Tour }
    | { type: 'analysisComplete'; report: AnalysisReportSummary }
    | { type: 'tourGenerating'; status: string }
    | { type: 'error'; message: string }
    | { type: 'openFile'; path: string; line?: number }
    | { type: 'gitStatus'; branch?: string; changes: Array<{ path: string; status: string }> }
    | { type: 'appConfig'; config: AppConfig }
    | { type: 'savedTours'; tours: Array<{ id: string; query: string; tourType: string; stepCount: number; createdAt: string }> }
    | { type: 'analyzerReply'; text: string }
    | { type: 'analyzerError'; message: string }
    | TourStreamChunkMessage
    | TourStreamEndMessage;

export type WebviewToExtensionMessage =
    | { type: 'requestTour'; query: string; tourType: TourType }
    | { type: 'openFile'; path: string; line?: number }
    | { type: 'openSettings' }
    | { type: 'chatAboutStep'; stepIndex: number; question: string }
    | { type: 'requestAnalysis' }
    | { type: 'loadTour'; tourId: string }
    | { type: 'deleteTour'; tourId: string }
    | { type: 'ready' }
    | { type: 'webviewLog'; level: 'debug' | 'error'; message: string; data?: Record<string, unknown> }
    | { type: 'analyzerQuery'; text: string }
    | { type: 'reponavHelp' };
