/**
 * Deterministic graph builder — converts AnalysisReport to a graph-only Tour without LLM.
 *
 * Used by the "Show Graph" command to render the full dependency graph instantly,
 * without waiting for AI narration.
 */

import { partitionEntryPointsBySurface } from '../analyzers/entrySurface';
import { applyDirectoryClustering } from './graphDirectoryClustering';
import { Tour, TourGraph, GraphNode, GraphEdge, FileCategory } from '../types';
import type { AnalysisCompleteness, AnalysisReport, SymbolInfo, SymbolEdge } from '../types';

/** Default cap for the number of nodes in the deterministic graph. */
const DEFAULT_MAX_NODES = 200;
const SYMBOL_NODE_SEPARATOR = '::symbol::';

export interface DeterministicTourOptions {
    maxNodes?: number;
    graphMode?: 'file' | 'symbol';
    /** When true, group file nodes by their immediate parent directory into cluster nodes. */
    groupByDirectory?: boolean;
    /** Set of directory cluster IDs that have been expanded by the user (show children instead of cluster). */
    expandedClusters?: Set<string>;
}

/**
 * Build a Tour from the AnalysisReport's dependency graph. No LLM call, no narration.
 * Limits to top-N nodes by fan-in to keep the graph readable.
 * Entry points are always included regardless of fan-in.
 */
export function buildDeterministicTour(
    report: AnalysisReport,
    options: number | DeterministicTourOptions = DEFAULT_MAX_NODES,
): Tour {
    const resolvedOptions = typeof options === 'number'
        ? { maxNodes: options, graphMode: 'file' as const, groupByDirectory: false, expandedClusters: new Set<string>() }
        : {
            maxNodes: options.maxNodes ?? DEFAULT_MAX_NODES,
            graphMode: options.graphMode ?? 'file',
            groupByDirectory: options.groupByDirectory ?? false,
            expandedClusters: options.expandedClusters ?? new Set<string>(),
        };

    if (resolvedOptions.graphMode === 'symbol' && report.symbols && report.symbols.length > 0) {
        return buildSymbolDeterministicTour(report, resolvedOptions.maxNodes);
    }

    const fileTour = buildFileDeterministicTour(report, resolvedOptions.maxNodes);

    if (resolvedOptions.groupByDirectory) {
        return applyDirectoryClustering(fileTour, resolvedOptions.expandedClusters ?? new Set());
    }

    return fileTour;
}

export function buildFileDeterministicTour(
    report: AnalysisReport,
    maxNodes: number,
): Tour {
    const { runtimeEntryPoints, launchSurfaces } = partitionEntryPointsBySurface(report.entryPoints);
    const classificationMap = new Map<string, FileCategory>();
    for (const c of report.fileClassifications) {
        classificationMap.set(c.path, c.category);
    }

    const fanInMap = new Map<string, number>();
    for (const m of report.metrics.fileMetrics) {
        fanInMap.set(m.path, m.fanIn);
    }

    // Select top-N nodes: entry points always included, rest ranked by fan-in
    const entryPointPaths = new Set(report.entryPoints.map(e => e.file));
    const allNodes = report.dependencyGraph.nodes;
    const selectedNodes = selectTopNodes(allNodes, fanInMap, entryPointPaths, maxNodes);
    const selectedSet = new Set(selectedNodes);

    // Build a set of edges involved in circular dependencies for marking.
    // For each cycle returned by detectCycles(), add all consecutive pairs including wraparound.
    // This correctly marks both directions of a 2-node cycle (a→b AND b→a are both cycle edges)
    // without adding false positives: only edges where BOTH directions form cycles get both added.
    const circularPairs = new Set<string>();
    for (const cycle of report.dependencyGraph.circularDependencies) {
        for (let i = 0; i < cycle.length; i++) {
            const from = cycle[i];
            const to = cycle[(i + 1) % cycle.length];
            circularPairs.add(`${from}->${to}`);
        }
    }

    // Guarantee that both endpoints of every detected cycle are included in the selected set,
    // so the cycle edges actually appear in the rendered graph even if they have low fan-in.
    const cycleNodes = new Set<string>();
    for (const cycle of report.dependencyGraph.circularDependencies) {
        for (const node of cycle) cycleNodes.add(node);
    }
    const augmentedSet = new Set(selectedSet);
    for (const node of cycleNodes) {
        if (allNodes.includes(node)) augmentedSet.add(node);
    }

    console.info(
        '[RepoNav][circular-debug]',
        `cycles=${report.dependencyGraph.circularDependencies.length}`,
        `circularPairs=${circularPairs.size}`,
        `cycleNodes=${cycleNodes.size}`,
        `selectedNodes=${selectedSet.size}`,
        `augmentedNodes=${augmentedSet.size}`,
    );

    const nodes: GraphNode[] = [...augmentedSet].map(filePath => ({
        id: filePath,
        label: filePath.split('/').pop() || filePath,
        type: classificationMap.get(filePath) ?? 'unknown',
        weight: fanInMap.get(filePath) ?? 0,
    }));

    // Only include edges where both source and target are in the augmented set
    const edges: GraphEdge[] = report.dependencyGraph.edges
        .filter(edge => augmentedSet.has(edge.source) && augmentedSet.has(edge.target))
        .map(edge => ({
            source: edge.source,
            target: edge.target,
            label: 'imports',
            isCircular: circularPairs.has(`${edge.source}->${edge.target}`) || undefined,
        }));

    console.info(
        '[RepoNav][circular-debug]',
        `edgesTotal=${report.dependencyGraph.edges.length}`,
        `edgesInGraph=${edges.length}`,
        `edgesMarkedCircular=${edges.filter(e => e.isCircular).length}`,
    );

    const graph: TourGraph = { nodes, edges };

    return {
        id: `graph-${Date.now()}`,
        query: 'Dependency Graph',
        tourType: 'dependency-audit',
        steps: [],
        graph,
        analysisSnapshot: {
            frameworks: report.frameworks.map(f => f.name),
            entryPoints: runtimeEntryPoints,
            ...(launchSurfaces.length > 0 ? { launchSurfaces } : {}),
            totalFiles: report.dependencyGraph.nodes.length,
            totalEdges: report.dependencyGraph.edges.length,
            circularCount: report.dependencyGraph.circularDependencies.length,
            completeness: buildGraphCompleteness(report, nodes.length, edges.length, maxNodes, allNodes.length),
        },
        createdAt: new Date().toISOString(),
    };
}

export function buildSymbolDeterministicTour(
    report: AnalysisReport,
    maxNodes: number,
): Tour {
    const symbols = report.symbols ?? [];
    const symbolEdges = report.symbolEdges ?? [];
    const { runtimeEntryPoints, launchSurfaces } = partitionEntryPointsBySurface(report.entryPoints);
    const classificationMap = new Map(report.fileClassifications.map((classification) => [classification.path, classification.category]));
    const entryPointFiles = new Set(report.entryPoints.map((entryPoint) => entryPoint.file));
    const symbolNodeLookup = new Map(symbols.map((symbol) => [`${symbol.filePath}::${symbol.name}`, buildSymbolNodeId(symbol.filePath, symbol.name, symbol.parentSymbol)]));
    const incomingEdgeMap = new Map<string, number>();

    for (const edge of symbolEdges) {
        const targetId = symbolNodeLookup.get(`${edge.targetFile}::${edge.targetName}`)
            ?? buildSymbolNodeId(edge.targetFile, edge.targetName);
        incomingEdgeMap.set(targetId, (incomingEdgeMap.get(targetId) ?? 0) + 1);
    }

    const selectedSymbols = selectTopSymbols(symbols, incomingEdgeMap, entryPointFiles, maxNodes);
    const selectedIds = new Set(selectedSymbols.map((symbol) => buildSymbolNodeId(symbol.filePath, symbol.name, symbol.parentSymbol)));

    const nodes: GraphNode[] = selectedSymbols.map((symbol) => ({
        id: buildSymbolNodeId(symbol.filePath, symbol.name, symbol.parentSymbol),
        label: formatSymbolLabel(symbol),
        type: classificationMap.get(symbol.filePath) ?? 'unknown',
        weight: incomingEdgeMap.get(buildSymbolNodeId(symbol.filePath, symbol.name, symbol.parentSymbol)) ?? 0,
    }));

    const edges: GraphEdge[] = symbolEdges
        .map((edge) => ({
            source: symbolNodeLookup.get(`${edge.sourceFile}::${edge.sourceName}`)
                ?? buildSymbolNodeId(edge.sourceFile, edge.sourceName),
            target: symbolNodeLookup.get(`${edge.targetFile}::${edge.targetName}`)
                ?? buildSymbolNodeId(edge.targetFile, edge.targetName),
            label: mapSymbolEdgeLabel(edge),
        }))
        .filter((edge) => selectedIds.has(edge.source) && selectedIds.has(edge.target));

    const graph: TourGraph = { nodes, edges };

    return {
        id: `graph-${Date.now()}`,
        query: 'Symbol Graph',
        tourType: 'dependency-audit',
        steps: [],
        graph,
        analysisSnapshot: {
            frameworks: report.frameworks.map((framework) => framework.name),
            entryPoints: runtimeEntryPoints,
            ...(launchSurfaces.length > 0 ? { launchSurfaces } : {}),
            totalFiles: report.symbolMetrics?.totalSymbols ?? symbols.length,
            totalEdges: report.symbolMetrics?.totalSymbolEdges ?? symbolEdges.length,
            circularCount: report.dependencyGraph.circularDependencies.length,
            completeness: buildGraphCompleteness(
                report,
                nodes.length,
                edges.length,
                maxNodes,
                report.symbolMetrics?.totalSymbols ?? symbols.length,
            ),
        },
        createdAt: new Date().toISOString(),
    };
}

// Derive user-facing graph completeness from the selected graph versus the analyzed dataset.
function buildGraphCompleteness(
    report: AnalysisReport,
    graphNodeCount: number,
    graphEdgeCount: number,
    graphSampleLimit: number,
    analyzedNodeCount: number,
): AnalysisCompleteness {
    const base = report.completeness;

    return {
        analysisScope: base?.analysisScope ?? 'fullWorkspace',
        analyzedFileCount: base?.analyzedFileCount ?? analyzedNodeCount,
        graphNodeCount,
        graphEdgeCount,
        graphSampleLimit,
        analysisCoverage: base?.analysisCoverage ?? 'complete',
        graphCoverage: graphNodeCount < analyzedNodeCount ? 'sampled' : 'complete',
    };
}

/**
 * Select the most structurally important nodes, up to maxNodes.
 * Entry points are always included. Remaining slots filled by fan-in rank.
 */
function selectTopNodes(
    allNodes: string[],
    fanInMap: Map<string, number>,
    entryPoints: Set<string>,
    maxNodes: number,
): string[] {
    if (allNodes.length <= maxNodes) return allNodes;

    // Always include entry points
    const selected: string[] = allNodes.filter(n => entryPoints.has(n));
    const selectedSet = new Set(selected);

    // Rank remaining by fan-in (most depended-on first)
    const remaining = allNodes
        .filter(n => !selectedSet.has(n))
        .sort((a, b) => (fanInMap.get(b) ?? 0) - (fanInMap.get(a) ?? 0));

    for (const node of remaining) {
        if (selected.length >= maxNodes) break;
        selected.push(node);
    }

    return selected;
}

function selectTopSymbols(
    symbols: SymbolInfo[],
    incomingEdgeMap: Map<string, number>,
    entryPointFiles: Set<string>,
    maxNodes: number,
): SymbolInfo[] {
    if (symbols.length <= maxNodes) return symbols;

    const selected = symbols
        .filter((symbol) => symbol.isEntryPoint || entryPointFiles.has(symbol.filePath))
        .slice(0, maxNodes);
    const selectedIds = new Set(selected.map((symbol) => buildSymbolNodeId(symbol.filePath, symbol.name, symbol.parentSymbol)));

    const remaining = symbols
        .filter((symbol) => !selectedIds.has(buildSymbolNodeId(symbol.filePath, symbol.name, symbol.parentSymbol)))
        .sort((a, b) => {
            const incomingDiff = (incomingEdgeMap.get(buildSymbolNodeId(b.filePath, b.name, b.parentSymbol)) ?? 0)
                - (incomingEdgeMap.get(buildSymbolNodeId(a.filePath, a.name, a.parentSymbol)) ?? 0);
            if (incomingDiff !== 0) return incomingDiff;
            if (a.isExported !== b.isExported) return a.isExported ? -1 : 1;
            return a.name.localeCompare(b.name);
        });

    for (const symbol of remaining) {
        if (selected.length >= maxNodes) break;
        selected.push(symbol);
    }

    return selected;
}

export function buildSymbolNodeId(filePath: string, symbolName: string, parentSymbol?: string): string {
    return `${filePath}${SYMBOL_NODE_SEPARATOR}${parentSymbol ? `${parentSymbol}.` : ''}${symbolName}`;
}

export function formatSymbolLabel(symbol: SymbolInfo): string {
    return symbol.parentSymbol ? `${symbol.parentSymbol}.${symbol.name}` : symbol.name;
}

export function mapSymbolEdgeLabel(edge: SymbolEdge): string {
    switch (edge.edgeType) {
        case 'calls':
            return 'calls';
        case 'extends':
            return 'extends';
        case 'implements':
            return 'implements';
        case 'uses_type':
            return 'uses';
        default:
            return 'uses';
    }
}
