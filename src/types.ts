/**
 * Core type definitions for RepoNav extension host.
 *
 * Shared types (Tour, TourStep, etc.) are re-exported from shared/types.ts.
 * Extension-only types (AnalysisReport, ImportEdge, etc.) live here.
 */

// Re-export all shared types so existing imports still work
export {
    FileCategory,
    EntrySurface,
    AnalysisScope,
    CompletenessCoverage,
    AnalysisCompleteness,
    TourType,
    CodeHighlight,
    FileRelationship,
    TourStep,
    GraphNode,
    GraphEdge,
    TourGraph,
    Tour,
    AnalysisReportSummary,
    AppConfig,
    ExtensionToWebviewMessage,
    WebviewToExtensionMessage,
    TourStreamChunkMessage,
    TourStreamEndMessage,
} from '../shared/types';

import type { AnalysisCompleteness, FileCategory } from '../shared/types';
import type { FlowSequence } from './analyzers/flowDetector';

export type { FlowSequence };
export type { FlowStep, FlowAnomaly } from './analyzers/flowDetector';

// ─── Static Analysis Types (extension-only) ─────────────────────────────────

/** A resolved import edge in the dependency graph */
export interface ImportEdge {
    source: string;
    target: string;
    specifiers: string[];
    isDynamic: boolean;
    rawStatement: string;
}

/** Detected entry point with confidence */
export interface EntryPoint {
    file: string;
    type: 'main' | 'route' | 'cli' | 'config' | 'test';
    entrySurface?: import('../shared/types').EntrySurface;
    confidence: 'high' | 'medium' | 'low';
    reason: string;
}

/** Detected framework/technology */
export interface FrameworkInfo {
    name: string;
    version?: string;
    type: 'framework' | 'library' | 'runtime' | 'build-tool';
    evidence: string;
}

/** File classification */
export interface FileClassification {
    path: string;
    category: FileCategory;
    confidence: 'high' | 'medium' | 'low';
    reason: string;
}

/** Per-file metrics */
export interface FileMetrics {
    path: string;
    lines: number;
    importCount: number;
    exportCount: number;
    fanIn: number;
    fanOut: number;
}

// ─── Architecture Intelligence Types (v2.0) ────────────────────────────────

/** Architectural boundary role of a file inferred from its imports. */
export type BoundaryRole = 'persistence' | 'http' | 'messaging' | 'auth' | 'validation' | 'observability' | 'external-integration';

/** Boundary role annotation for a single file. */
export interface BoundaryRoleAnnotation {
    filePath: string;
    role: BoundaryRole;
    evidence: string;
}

/** Hint emitted when the repo's character is incompatible with the application layer model. */
export interface RepoCharacterHint {
    code: 'library-source';
    message: string;
    unknownRate: number;
}

/** A layer violation detected in the dependency graph. */
export interface LayerViolation {
    sourceFile: string;
    targetFile: string;
    sourceLayer: string;
    targetLayer: string;
    direction: 'backward' | 'skip-layer';
}

/** Blast radius result for a single symbol. */
export interface BlastRadius {
    origin: string;
    originFile: string;
    directCallers: string[];
    transitiveCallers: string[];
    score: number;
    byHop: Record<number, string[]>;
}

/** Diff-scope metadata block appended to scoped analysis. */
export interface DiffScope {
    ref: string;
    changedFiles: string[];
    analyzedFiles: string[];
}

/** A co-change pair — two files that frequently change together in git history (v2.2). */
export interface CoChangePair {
    fileA: string;
    fileB: string;
    support: number;
    confidence: number;
}

/** A symbol identified as unreachable from any live call path (v2.1). */
export interface DeadCodeCandidate {
    symbolName: string;
    filePath: string;
    lineStart: number;
    reason: string;
    confidence: number;
}

// ─── Symbol-Level Analysis Types (v1.3) ─────────────────────────────────────

/** Kind of symbol extracted from AST. */
export type SymbolKind = 'function' | 'class' | 'interface' | 'type_alias' | 'enum' | 'constant' | 'method' | 'constructor';

/** Type of edge between symbols. */
export type SymbolEdgeType = 'calls' | 'extends' | 'implements' | 'uses_type';

/** A symbol (function, class, etc.) extracted from source code. */
export interface SymbolInfo {
    name: string;
    kind: SymbolKind;
    filePath: string;
    lineStart: number;
    lineEnd: number;
    signature?: string;
    isExported: boolean;
    isEntryPoint: boolean;
    parentSymbol?: string;
}

/** A directed edge between two symbols across files. */
export interface SymbolEdge {
    sourceFile: string;
    sourceName: string;
    targetFile: string;
    targetName: string;
    edgeType: SymbolEdgeType;
    lineNumber: number;
}

/** Complete analysis report — this is what gets sent to the AI */
export interface AnalysisReport {
    timestamp: string;
    workspaceRoot: string;
    indexTier: 0 | 1 | 2 | 3 | 4 | 5 | 6;
    frameworks: FrameworkInfo[];
    primaryLanguage: string;
    entryPoints: EntryPoint[];
    dependencyGraph: {
        nodes: string[];
        edges: ImportEdge[];
        circularDependencies: string[][];
    };
    fileClassifications: FileClassification[];
    metrics: {
        totalFiles: number;
        totalLines: number;
        fileMetrics: FileMetrics[];
        hotFiles: FileMetrics[];
        orphanFiles: string[];
    };
    fileTree: Record<string, unknown>;
    keyFileContents: Record<string, string>;
    /** Symbol-level data — populated at Tier 2 (v1.3). */
    symbols?: SymbolInfo[];
    symbolEdges?: SymbolEdge[];
    symbolMetrics?: {
        totalSymbols: number;
        totalSymbolEdges: number;
        symbolsByKind: Record<SymbolKind, number>;
        deadCodeCount: number;
    };
    /** Boundary role annotations per file — populated at Tier 1+ (v2.0). */
    boundaryRoles?: BoundaryRoleAnnotation[];
    /** Layer violations detected in the dependency graph — populated at Tier 1+ (v2.0). */
    layerViolations?: LayerViolation[];
    /** Blast radius for a queried symbol — populated on demand (v2.0). */
    blastRadius?: BlastRadius;
    /** Diff-scope metadata — populated only when --diff flag is used (v2.0). */
    diffScope?: DiffScope;
    /** Dead code candidates — populated at Tier 2 (v2.1). */
    deadCode?: DeadCodeCandidate[];
    /** Co-change pairs mined from git history — populated at Tier 2 (v2.2). */
    changeCoupling?: CoChangePair[];
    /** Hints about repo character (e.g. library source warning) — populated at Tier 1+. */
    analysisHints?: RepoCharacterHint[];
    /** Process/flow sequences traced from entry points through the layer DAG — populated at Tier 2 (v2.3). */
    flows?: FlowSequence[];
    /** Recommended architectural seams for decoupling — populated at Tier 2+ (v2.4). */
    seams?: SeamCandidate[];
    /** Compiler or linter diagnostics (errors/warnings) — populated at Tier 3 (v3.0). */
    diagnostics?: Diagnostic[];
    /** Verified semantic signals from the language host — populated at Tier 3 (v3.0). */
    lspSignals?: LspSignal[];
    /** Database entities extracted from schemas — populated at Tier 4 (v4.0). */
    entities?: DataEntity[];
    /** Federated sister repositories and cross-repo edges — populated at Tier 5 (v5.0). */
    federation?: {
        repos: FederatedRepo[];
        edges: CrossRepoEdge[];
    };
    /** Temporal intelligence based on git history — populated at Tier 6 (v6.0). */
    temporal?: TemporalIntelligence;
    /** User-facing metadata that explains whether analysis and graph outputs are complete or sampled. */
    completeness?: AnalysisCompleteness;
}

/** A compiler or linter diagnostic (v3.0). */
export interface Diagnostic {
    filePath: string;
    line: number;
    column: number;
    severity: 'error' | 'warning' | 'info';
    message: string;
    code?: string | number;
    source?: string;
}

/** Semantic signal verified by the language host (v3.0). */
export interface LspSignal {
    type: 'verified_call' | 'verified_usage' | 'unused_symbol';
    sourceFile: string;
    sourceSymbol?: string;
    targetFile: string;
    targetSymbol?: string;
    confidence: number;
}

/** A recommended architectural seam for decoupling (v2.4). */
export interface SeamCandidate {
    id: string;
    score: number;
    description: string;
    sourceCluster: string[];
    targetCluster: string[];
    cutEdges: { source: string; target: string }[];
    rationale: string;
}

/** A database entity (table, model) extracted from ORM schemas (v4.0). */
export interface DataEntity {
    name: string;
    fields: Array<{ name: string; type: string; isPrimary?: boolean; isNullable?: boolean }>;
    relations: Array<{ target: string; type: 'one-to-one' | 'one-to-many' | 'many-to-one' | 'many-to-many' }>;
    sourceFile: string;
}

/** A sister repository in a federated workspace (v5.0). */
export interface FederatedRepo {
    name: string;
    path: string;
    type: 'npm' | 'python' | 'go' | 'unknown';
}

/** A dependency edge between repositories (v5.0). */
export interface CrossRepoEdge {
    sourceRepo: string;
    sourceFile: string;
    targetRepo: string;
    targetFile?: string; // Optional if only repo-level resolution is possible
    type: 'import' | 'rpc' | 'event';
}

/** File churn metric: how often a file changes (v6.0). */
export interface FileChurn {
    filePath: string;
    commitCount: number;
    lastChangedAt: string;
    complexityScore: number; // Correlation between size/symbols and churn
    riskScore: number; // High churn + High complexity = High risk
}

/** Knowledge distribution map based on git authorship (v6.0). */
export interface KnowledgeMap {
    filePath: string;
    owners: Array<{ name: string; email: string; commitCount: number; percentage: number }>;
}

/** Overall repository stability metrics based on temporal patterns (v6.0). */
export interface TemporalIntelligence {
    hotspots: FileChurn[];
    knowledge: KnowledgeMap[];
    averageChurn: number;
    mostUnstableFiles: string[];
}
