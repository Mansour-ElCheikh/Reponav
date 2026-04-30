/**
 * Analyzer Facade
 *
 * Orchestrates static analysis tiers and re-exports public API.
 * Delegates file selection and reading to extracted helper modules.
 *
 * NOTE: This file has NO vscode imports — it depends only on WorkspaceAdapter.
 */

/** Implemented/Hardened by Antigravity (2026-04-26) */
import * as fs from 'fs';
import { AnalysisReport, SymbolKind, CoChangePair } from '../types';
/** Implemented/Hardened by Antigravity (2026-04-26) */
import type { ImportEdge } from '../types';
import { WorkspaceAdapter, ProgressReporter } from '../WorkspaceAdapter';
import { AnalysisProvider } from './AnalysisProvider';
import { classifyBoundaryRoles } from './boundaryRoleClassifier';
import { boundaryRoleLookup } from './boundaryRoleLookup';
import { enrichWithBoundarySignals } from './boundarySignalEnricher';
import { mineChangeCoupling, getGitLog } from './changeCouplingAnalyzer';
/** Implemented/Hardened by Antigravity (2026-04-26) */
import { computeBlastRadius } from './blastRadiusAnalyzer';
import { computeDeadCode } from './deadCodeClassifier';
import { detectEntryPoints } from './entryPointDetector';
import { classifyFiles } from './fileClassifier';
import { readWorkspaceFiles, buildFileTree, extractKeyFileContents, readPreviewFiles } from './fileReading';
import { normalizeAnalysisOptions, collectCandidatePaths } from './fileSelection';
import { detectFlows } from './flowDetector';
import { detectFrameworks, detectPrimaryLanguage } from './frameworkDetector';
import { enrichWithGraphStructure } from './graphStructuralClassifier';
import { assignLayers, detectViolations } from './layerDag';
import { buildCondensationDag } from './layerDag';
import { collectMetrics } from './metricsCollector';
import { detectRepoCharacter } from './repoCharacterDetector';
import { buildTier1PromptFileContents } from './reportFormatting';
import type { SymbolEnricher } from './symbolEnrichment';
import { TreeSitterProvider } from './TreeSitterProvider';
/** Implemented/Hardened by Antigravity (2026-04-26) */
import { SemanticBridge } from './semanticBridge';
import { SchemaAnalyzer } from './schemaAnalyzer';
import { FederationAnalyzer } from './federationAnalyzer';
import { TemporalAnalyzer } from './temporalAnalyzer';

// Re-export public types and functions from extracted modules
export type { AnalysisScope, AnalysisOptions } from './fileSelection';
export { formatReportForAI, type ReportFormat } from './reportFormatting';

// ─── Tier 0 — File Tree + Manifests (<500ms) ────────────────────────────────

/**
 * Tier 0 analysis: Reads file tree, extracts manifests, detects frameworks.
 * Returns a partial AnalysisReport that can be immediately displayed.
 *
 * Target: <500ms — user never waits for this.
 */
export async function analyzeTier0(
    adapter: WorkspaceAdapter,
    progress?: ProgressReporter,
    options?: import('./fileSelection').AnalysisOptions
): Promise<{ report: AnalysisReport; files: Map<string, string> }> {
    const resolvedOptions = normalizeAnalysisOptions(adapter, options);
    const workspaceRoot = adapter.getWorkspaceRoot() ?? '';

    // Step 1: Read files
    progress?.report({ message: 'Reading workspace files...', increment: 0 });
    const files = await readWorkspaceFiles(adapter, resolvedOptions);
    progress?.report({ message: `Found ${files.size} files`, increment: 20 });

    // Step 2: Detect frameworks (fast — just scans manifests)
    progress?.report({ message: 'Detecting tech stack...', increment: 10 });
    const frameworks = await detectFrameworks(files);
    const primaryLanguage = detectPrimaryLanguage([...files.keys()]);

    // Step 3: Build file tree + extract key files
    const fileTree = buildFileTree([...files.keys()]);
    const keyFileContents = extractKeyFileContents(files);

    const report: AnalysisReport = {
        timestamp: new Date().toISOString(),
        workspaceRoot,
        indexTier: 0,
        frameworks,
        primaryLanguage,
        entryPoints: [],
        dependencyGraph: {
            nodes: [...files.keys()],
            edges: [],
            circularDependencies: [],
        },
        fileClassifications: [],
        metrics: {
            totalFiles: files.size,
            totalLines: 0,
            fileMetrics: [],
            hotFiles: [],
            orphanFiles: [],
        },
        fileTree,
        keyFileContents,
    };

    return { report, files };
}

/**
 * Tier 0 preview: cheap metadata-first summary for immediate UI feedback.
 * Reads only manifest/config files needed to detect stack and populate summary cards.
 */
export async function analyzeTier0Preview(
    adapter: WorkspaceAdapter,
    options?: import('./fileSelection').AnalysisOptions
): Promise<{ report: AnalysisReport; relativePaths: string[] }> {
    const resolvedOptions = normalizeAnalysisOptions(adapter, options);
    const workspaceRoot = adapter.getWorkspaceRoot() ?? '';
    const relativePaths = await collectCandidatePaths(adapter, resolvedOptions);
    const previewFiles = await readPreviewFiles(adapter, workspaceRoot, relativePaths);
    const frameworks = await detectFrameworks(previewFiles);
    const primaryLanguage = detectPrimaryLanguage(relativePaths);
    const fileTree = buildFileTree(relativePaths);
    const keyFileContents = extractKeyFileContents(previewFiles);

    return {
        report: {
            timestamp: new Date().toISOString(),
            workspaceRoot,
            indexTier: 0,
            frameworks,
            primaryLanguage,
            entryPoints: [],
            dependencyGraph: {
                nodes: relativePaths,
                edges: [],
                circularDependencies: [],
            },
            fileClassifications: [],
            metrics: {
                totalFiles: relativePaths.length,
                totalLines: 0,
                fileMetrics: [],
                hotFiles: [],
                orphanFiles: [],
            },
            fileTree,
            keyFileContents,
        },
        relativePaths,
    };
}

// ─── Tier 1 — Structural Graph (1-3s) ───────────────────────────────────────

/**
 * Tier 1 analysis: Tree-sitter imports, entry points, file classification, metrics.
 * Returns a complete AnalysisReport ready for tour generation.
 *
 * Target: 1-3s — runs immediately after Tier 0.
 */
export async function analyzeTier1(
    adapter: WorkspaceAdapter,
    files: Map<string, string>,
    tier0Report: AnalysisReport,
    progress?: ProgressReporter,
    provider?: AnalysisProvider,
    options?: import('./fileSelection').AnalysisOptions
): Promise<AnalysisReport> {
    const workspaceRoot = adapter.getWorkspaceRoot() ?? '';

    // Step 1: Analyze imports (tree-sitter — the heaviest step)
    progress?.report({ message: 'Analyzing dependencies (Tree-sitter)...', increment: 20 });
    const analysisProvider = provider ?? new TreeSitterProvider();
    const importResult = await analysisProvider.analyzeImports(workspaceRoot, files, {
        onProgress: (value) => {
            progress?.report({ message: value.message, increment: 0 });
        },
    });

    // Step 2: Detect entry points
    progress?.report({ message: 'Detecting entry points...', increment: 10 });
    const entryPoints = await detectEntryPoints(files);

    // Step 3: Classify files
    progress?.report({ message: 'Classifying files...', increment: 10 });
    const fileClassifications = await classifyFiles(files);

    // Step 4: Collect metrics
    progress?.report({ message: 'Computing metrics...', increment: 10 });
    const metrics = await collectMetrics(files, importResult.edges);

    progress?.report({ message: 'Analysis complete!', increment: 20 });

    const boundaryRoles = classifyBoundaryRoles(importResult.edges, boundaryRoleLookup);

    // Pass 3: upgrade remaining unknowns using import-edge boundary role signals
    const pass3Classifications = enrichWithBoundarySignals(fileClassifications, importResult.edges, boundaryRoleLookup);

    // Pass 4: upgrade remaining unknowns using import-graph structural heuristics
    const enrichedClassifications = enrichWithGraphStructure(pass3Classifications, importResult.edges);

    // Build layer map from file classifications
    const categoryMap = new Map<string, string>();
    for (const fc of enrichedClassifications) categoryMap.set(fc.path, fc.category);
    const layerMap = assignLayers([...files.keys()], categoryMap);
    const layerViolations = detectViolations(importResult.edges, layerMap);

    return {
        ...tier0Report,
        indexTier: 1,
        entryPoints,
        dependencyGraph: {
            nodes: [...files.keys()],
            edges: importResult.edges,
            circularDependencies: importResult.circularDependencies,
        },
        fileClassifications: enrichedClassifications,
        metrics,
        keyFileContents: buildTier1PromptFileContents(files, entryPoints, fileClassifications, metrics),
        boundaryRoles: boundaryRoles.length > 0 ? boundaryRoles : undefined,
        layerViolations: layerViolations.length > 0 ? layerViolations : undefined,
        analysisHints: (() => {
            const hint = detectRepoCharacter(files, enrichedClassifications);
            return hint ? [hint] : undefined;
        })(),
    };
}

// ─── Tier 2 — Symbol-Level Analysis (1-3s) ───────────────────────────────────

/**
 * Tier 2 analysis: Symbol extraction + cross-file edge tracing.
 * Adds symbol-level data to an existing Tier 1 report.
 *
 * Target: 1-3s — runs after Tier 1.
 */
export async function analyzeTier2(
    adapter: WorkspaceAdapter,
    files: Map<string, string>,
    tier1Report: AnalysisReport,
    progress?: ProgressReporter,
    provider?: AnalysisProvider,
    _symbolEnricher?: SymbolEnricher
): Promise<AnalysisReport> {
    progress?.report({ message: 'Extracting symbols...', increment: 10 });
    const analysisProvider = provider ?? new TreeSitterProvider();
    const tsProvider = analysisProvider as TreeSitterProvider;

    const { symbols, edges } = await tsProvider.analyzeSymbols(
        adapter.getWorkspaceRoot() ?? '',
        files,
        tier1Report.dependencyGraph.edges
    );

    const mergedSymbols = symbols.map((symbol) => ({
        ...symbol,
        isEntryPoint: symbol.isEntryPoint || tier1Report.entryPoints.some((entryPoint) => entryPoint.file === symbol.filePath),
    }));

    progress?.report({ message: `Found ${mergedSymbols.length} symbols, ${edges.length} edges`, increment: 10 });

    // Compute metrics by kind
    const symbolsByKind = {} as Record<SymbolKind, number>;
    for (const sym of mergedSymbols) {
        symbolsByKind[sym.kind] = (symbolsByKind[sym.kind] ?? 0) + 1;
    }

    // Compute dead code from symbol + edge + boundary data
    const boundaryRoles = tier1Report.boundaryRoles ?? [];
    const deadCode = computeDeadCode(mergedSymbols, edges, boundaryRoles);

    // Mine change coupling from git history (optional — fails gracefully on non-git repos)
    let changeCoupling: CoChangePair[] | undefined;
    try {
        const rawLog = getGitLog(adapter.getWorkspaceRoot() ?? '');
        changeCoupling = mineChangeCoupling(rawLog);
    } catch {
        // Not a git repo or git unavailable — omit field
    }

    // Build condensation DAG from Tier 1 dependency graph and detect flow sequences.
    const nodes = tier1Report.dependencyGraph.nodes;
    const importEdges = tier1Report.dependencyGraph.edges;
    const dag = buildCondensationDag(nodes, importEdges);
    const categoryMap = new Map<string, string>();
    for (const fc of tier1Report.fileClassifications) categoryMap.set(fc.path, fc.category);
    const flowLayers = assignLayers(nodes, categoryMap);
    // Omit flows field entirely when DAG has no components (empty/unanalyzable workspace).
    const flows = dag.components.length > 0
        ? detectFlows(tier1Report.fileClassifications, dag, flowLayers)
        : undefined;

    return {
        ...tier1Report,
        indexTier: 2,
        symbols: mergedSymbols,
        symbolEdges: edges,
        symbolMetrics: {
            totalSymbols: mergedSymbols.length,
            totalSymbolEdges: edges.length,
            symbolsByKind,
            deadCodeCount: deadCode.length,
        },
        deadCode,
        ...(changeCoupling !== undefined ? { changeCoupling } : {}),
        ...(flows !== undefined ? { flows } : {}),
    };
}

// ─── Tier 3 — Semantic Fusion (1-5s) ──────────────────────────────────────────

/**
 * Tier 3 analysis: LSP Semantic Fusion.
 * Fuses compiler/linter diagnostics and verified semantic signals into the report.
 * 
 * Target: 1-5s — runs after Tier 2.
 */
export async function analyzeTier3(
    adapter: WorkspaceAdapter,
    _files: Map<string, string>,
    tier2Report: AnalysisReport,
    progress?: ProgressReporter
): Promise<AnalysisReport> {
    progress?.report({ message: 'Fusing semantic signals (LSP)...', increment: 10 });
    
    const bridge = new SemanticBridge();
    const workspaceRoot = adapter.getWorkspaceRoot() ?? '';
    
    // Step 1: Capture compiler diagnostics
    const diagnostics = await bridge.runTscDiagnostics(workspaceRoot);
    
    // Step 2: Fuse and enrich report
    const enrichedReport = bridge.fuseDiagnostics(tier2Report, diagnostics);
    
    progress?.report({ message: `Fused ${diagnostics.length} diagnostics`, increment: 10 });
    
    return {
        ...enrichedReport,
        indexTier: 3,
    };
}

// ─── Tier 4 — ORM Extraction (100-500ms) ──────────────────────────────────────

/**
 * Tier 4 analysis: ORM Schema Extraction.
 * Extracts data models and relationships from Prisma/TypeORM schemas.
 * 
 * Target: 100-500ms — fast regex-based extraction.
 */
export async function analyzeTier4(
    _adapter: WorkspaceAdapter,
    files: Map<string, string>,
    tier3Report: AnalysisReport,
    progress?: ProgressReporter
): Promise<AnalysisReport> {
    progress?.report({ message: 'Extracting data models (ORM)...', increment: 10 });
    
    const analyzer = new SchemaAnalyzer();
    const entities = await analyzer.analyze(files);
    
    progress?.report({ message: `Extracted ${entities.length} entities`, increment: 10 });
    
    return {
        ...tier3Report,
        indexTier: 4,
        entities: entities.length > 0 ? entities : undefined,
    };
}

// ─── Tier 5 — Multi-Repo Federation (500-1000ms) ──────────────────────────────

/**
 * Tier 5 analysis: Multi-Repo Federation.
 * Detects sister repositories and cross-repo dependency edges.
 */
export async function analyzeTier5(
    _adapter: WorkspaceAdapter,
    tier4Report: AnalysisReport,
    progress?: ProgressReporter
): Promise<AnalysisReport> {
    progress?.report({ message: 'Federating workspace (multi-repo)...', increment: 10 });
    
    const analyzer = new FederationAnalyzer();
    const sisters = await analyzer.detectSisterRepos(tier4Report.workspaceRoot);
    const crossRepoEdges = await analyzer.buildCrossRepoEdges(tier4Report, sisters);
    
    progress?.report({ message: `Detected ${sisters.length} sister repos`, increment: 10 });
    
    return {
        ...tier4Report,
        indexTier: 5,
        federation: sisters.length > 0 ? {
            repos: sisters,
            edges: crossRepoEdges,
        } : undefined,
    };
}

// ─── Tier 6 — Temporal Intelligence (1-5s) ──────────────────────────────────

/**
 * Tier 6 analysis: Temporal Intelligence.
 * Mines git history to identify code hotspots, ownership, and stability trends.
 */
export async function analyzeTier6(
    adapter: WorkspaceAdapter,
    tier5Report: AnalysisReport,
    progress?: ProgressReporter
): Promise<AnalysisReport> {
    progress?.report({ message: 'Analyzing git history (Temporal)...', increment: 10 });
    
    const analyzer = new TemporalAnalyzer(tier5Report.workspaceRoot);
    const temporal = await analyzer.analyze(tier5Report.metrics.fileMetrics);
    
    progress?.report({ message: `Identified ${temporal.hotspots.length} hotspots`, increment: 10 });
    
    return {
        ...tier5Report,
        indexTier: 6,
        temporal,
    };
}

// ─── Convenience Wrapper ────────────────────────────────────────────────────

/**
 * Run all analysis tiers and return the complete report.
 */
export async function analyzeWorkspace(
    adapter: WorkspaceAdapter,
    progress?: ProgressReporter,
    options?: import('./fileSelection').AnalysisOptions,
    provider?: AnalysisProvider
): Promise<AnalysisReport> {
    try {
        const resolvedOptions = normalizeAnalysisOptions(adapter, options);
        const { report: tier0, files } = await analyzeTier0(adapter, progress, options);
        return await analyzeTier1(adapter, files, tier0, progress, provider, resolvedOptions);
    } catch (error) {
        console.error('analyzeWorkspace failed with error:', error);
        if (error instanceof Error && error.stack) {
            console.error('Stack trace:', error.stack);
        }
        throw error;
    }
}
