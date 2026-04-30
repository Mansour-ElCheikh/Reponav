/**
 * sigmaEdgeRenderers — pure graphology edge utilities for SigmaGraph.
 *
 * Extracted functions for building import/coupling edges and adjacency maps.
 * No Sigma, no VS Code, no React — testable in node environment.
 */
import Graph from 'graphology';
import { BASE_EDGE_COLOR, CIRCULAR_COLOR } from './sigmaRenderPolicy';

// ─── Types ────────────────────────────────────────────────────────────────────

/** Minimal shape for a co-change pair as used by edge rendering. */
export interface CouplingEdge {
    fileA: string;
    fileB: string;
}

/** Tour edge shape as expected by addImportEdges. */
interface TourEdgeLike {
    source: string;
    target: string;
    isCircular?: boolean;
}

// ─── Constants ────────────────────────────────────────────────────────────────

/** Color for co-change dashed edges — distinct from import and blast-radius edges. */
export const CO_CHANGE_EDGE_COLOR = '#888888';

/** Color for normal STEP_IN_PROCESS flow edges — blue (arrow, distinct from gray import edges). */
export const FLOW_COLOR = '#4488ff';

/** Color for anomaly STEP_IN_PROCESS flow edges — orange. */
export const FLOW_ANOMALY_COLOR = '#ff8844';

// Normalize path-like IDs so flow step paths can match graph node IDs across
// different path formats (e.g. "./src/a.ts" vs "src/a.ts", backslashes on Windows).
function normalizePathLike(value: string): string {
    return value.replace(/\\/g, '/').replace(/^\.\//, '');
}

function buildNormalizedDisplayMap(fileToDisplayNode?: Map<string, string>): Map<string, string> | undefined {
    if (!fileToDisplayNode) return undefined;
    const normalized = new Map<string, string>();
    for (const [filePath, nodeId] of fileToDisplayNode.entries()) {
        normalized.set(normalizePathLike(filePath), nodeId);
    }
    return normalized;
}

// Resolve against pre-normalized maps so batch helpers do not rebuild the same
// display-node lookup table on every flow/coupling pair.
function resolveFlowNodeIdFromMaps(
    pathLike: string,
    normalizedNodeId: Map<string, string>,
    normalizedDisplayMap?: Map<string, string>,
): string | undefined {
    const normalized = normalizePathLike(pathLike);
    const directDisplay = normalizedDisplayMap?.get(normalized);
    if (directDisplay) return directDisplay;

    if (normalizedDisplayMap) {
        const displayCandidates = new Set<string>();
        for (const [fileNorm, nodeId] of normalizedDisplayMap.entries()) {
            if (normalized.endsWith(`/${fileNorm}`) || fileNorm.endsWith(`/${normalized}`)) {
                displayCandidates.add(nodeId);
            }
        }
        if (displayCandidates.size === 1) return [...displayCandidates][0];
    }

    const direct = normalizedNodeId.get(normalized);
    if (direct) return direct;

    const candidates: string[] = [];
    for (const [nodeNorm, nodeId] of normalizedNodeId.entries()) {
        if (normalized.endsWith(`/${nodeNorm}`) || nodeNorm.endsWith(`/${normalized}`)) {
            candidates.push(nodeId);
        }
    }
    return candidates.length === 1 ? candidates[0] : undefined;
}

/**
 * Resolves a flow step path to a graph node id.
 * Direct normalized match is preferred; suffix fallback handles absolute/relative paths.
 * Returns undefined when no unique match exists.
 */
export function resolveFlowNodeId(
    pathLike: string,
    normalizedNodeId: Map<string, string>,
    fileToDisplayNode?: Map<string, string>,
): string | undefined {
    const normalizedDisplayMap = buildNormalizedDisplayMap(fileToDisplayNode);
    return resolveFlowNodeIdFromMaps(pathLike, normalizedNodeId, normalizedDisplayMap);
}

// ─── Edge building ────────────────────────────────────────────────────────────

/**
 * Adds import/dependency edges from a tour to a graphology Graph.
 * Skips edges whose source or target is absent from nodeSet.
 */
export function addImportEdges(
    g: Graph,
    edges: TourEdgeLike[],
    nodeSet: Set<string>
): void {
    for (const edge of edges) {
        if (!nodeSet.has(edge.source) || !nodeSet.has(edge.target)) continue;
        const edgeKey = `${edge.source}→${edge.target}`;
        if (!g.hasEdge(edgeKey)) {
            g.addEdgeWithKey(edgeKey, edge.source, edge.target, {
                color: edge.isCircular ? CIRCULAR_COLOR : BASE_EDGE_COLOR,
                size: edge.isCircular ? 2.5 : 1.5,
                isCircular: edge.isCircular ?? false,
                isCoupling: false,
            });
        }
    }
}

/**
 * Adds co-change coupling edges (dashed gray) to a graphology Graph.
 * Skips edges whose endpoints are absent from nodeSet.
 */
export function addCouplingEdges(
    g: Graph,
    pairs: CouplingEdge[],
    nodeSet: Set<string>,
    fileToDisplayNode?: Map<string, string>,
): void {
    const normalizedNodeId = new Map<string, string>();
    for (const id of nodeSet) normalizedNodeId.set(normalizePathLike(id), id);
    const normalizedDisplayMap = buildNormalizedDisplayMap(fileToDisplayNode);

    for (const pair of pairs) {
        const fileA = resolveFlowNodeIdFromMaps(pair.fileA, normalizedNodeId, normalizedDisplayMap);
        const fileB = resolveFlowNodeIdFromMaps(pair.fileB, normalizedNodeId, normalizedDisplayMap);
        if (!fileA || !fileB || fileA === fileB) continue;
        const key = `coupling:${fileA}↔${fileB}`;
        if (!g.hasEdge(key)) {
            g.addEdgeWithKey(key, fileA, fileB, {
                color: CO_CHANGE_EDGE_COLOR,
                size: 1.0,
                type: 'dashed',
                isCoupling: true,
                zIndex: -1,
            });
        }
    }
}

// ─── Adjacency maps ───────────────────────────────────────────────────────────

/**
 * Builds upstream and downstream adjacency maps from an edge list.
 * upstreamMap[target] = set of sources that import target.
 * downstreamMap[source] = set of targets imported by source.
 */
export function buildAdjacencyMaps(
    edges: Array<{ source: string; target: string }>
): { upstreamMap: Map<string, Set<string>>; downstreamMap: Map<string, Set<string>> } {
    const up = new Map<string, Set<string>>();
    const down = new Map<string, Set<string>>();
    for (const edge of edges) {
        if (!down.has(edge.source)) down.set(edge.source, new Set());
        down.get(edge.source)!.add(edge.target);
        if (!up.has(edge.target)) up.set(edge.target, new Set());
        up.get(edge.target)!.add(edge.source);
    }
    return { upstreamMap: up, downstreamMap: down };
}

// ─── Edge reducer helper ──────────────────────────────────────────────────────

/**
 * Returns edge reducer override attrs for co-change edges based on toggle + selection state.
 * Returns null for non-coupling edges (caller should apply no override).
 * Returns `{ hidden: true }` when showCoupling is false or when a node is selected
 * and the coupling edge does not connect to it.
 * Returns `{ zIndex: -1 }` when visible to keep coupling edges behind import edges.
 */
export function getCouplingEdgeReducerState(
    edgeAttrs: Record<string, unknown>,
    showCoupling: boolean,
    selectedNodeId?: string | null,
    source?: string,
    target?: string,
): Record<string, unknown> | null {
    if (!edgeAttrs['isCoupling']) return null;
    if (!showCoupling) return { hidden: true };
    // When a node is selected, hide coupling edges that don't connect to it
    if (selectedNodeId && source && target) {
        if (source !== selectedNodeId && target !== selectedNodeId) {
            return { hidden: true };
        }
    }
    return { zIndex: -1 };
}

// ─── Flow edge helpers ────────────────────────────────────────────────────────

/** Minimal shape of a flow sequence needed by addFlowEdges. */
interface FlowSequenceLike {
    entryPoint: string;
    steps: Array<{ filePath: string }>;
    anomalies: Array<{ fromFile: string; toFile: string }>;
}

/**
 * Adds STEP_IN_PROCESS flow edges for each FlowSequence to a graphology Graph.
 * All flow edges render as blue arrows. Anomaly detection is a backend concern —
 * orange differentiation is deferred to a future epic to avoid noise with multi:true.
 * Silently skips steps whose files are absent from nodeSet.
 */
export function addFlowEdges(
    g: Graph,
    flows: FlowSequenceLike[],
    nodeSet: Set<string>,
    fileToDisplayNode?: Map<string, string>,
): void {
    const normalizedNodeId = new Map<string, string>();
    for (const id of nodeSet) normalizedNodeId.set(normalizePathLike(id), id);
    const normalizedDisplayMap = buildNormalizedDisplayMap(fileToDisplayNode);

    for (const seq of flows) {
        for (let i = 0; i < seq.steps.length - 1; i++) {
            const rawFrom = seq.steps[i].filePath;
            const rawTo = seq.steps[i + 1].filePath;
            const from = resolveFlowNodeIdFromMaps(rawFrom, normalizedNodeId, normalizedDisplayMap);
            const to = resolveFlowNodeIdFromMaps(rawTo, normalizedNodeId, normalizedDisplayMap);
            if (!from || !to || from === to) continue;
            const key = `flow:${seq.entryPoint}:${from}→${to}`;
            if (g.hasEdge(key)) continue;
            try {
                g.addEdgeWithKey(key, from, to, {
                    color: FLOW_COLOR,
                    size: 2.0,
                    isFlowEdge: true,
                    zIndex: -1,
                });
            } catch {
                // multi:false graph rejects parallel edges — silently skip
            }
        }
    }
}

/**
 * Builds the visible source→target pair keys produced by the current flow sequences.
 * Used to suppress duplicate import edges when the same relationship already has
 * a dedicated flow edge on screen.
 */
export function buildVisibleFlowPairKeys(
    flows: FlowSequenceLike[],
    nodeSet: Set<string>,
    fileToDisplayNode?: Map<string, string>,
): Set<string> {
    const normalizedNodeId = new Map<string, string>();
    for (const id of nodeSet) normalizedNodeId.set(normalizePathLike(id), id);
    const normalizedDisplayMap = buildNormalizedDisplayMap(fileToDisplayNode);

    const pairKeys = new Set<string>();
    for (const seq of flows) {
        for (let i = 0; i < seq.steps.length - 1; i++) {
            const from = resolveFlowNodeIdFromMaps(seq.steps[i].filePath, normalizedNodeId, normalizedDisplayMap);
            const to = resolveFlowNodeIdFromMaps(seq.steps[i + 1].filePath, normalizedNodeId, normalizedDisplayMap);
            if (!from || !to || from === to) continue;
            pairKeys.add(`${from}→${to}`);
        }
    }
    return pairKeys;
}

/**
 * Returns true when an import edge should be hidden because a visible flow edge
 * exists on the same source→target pair.
 */
export function shouldSuppressImportEdgeForFlowPair(
    edgeAttrs: Record<string, unknown>,
    source: string,
    target: string,
    showFlowEdges: boolean,
    flowPairKeys: Set<string>,
): boolean {
    if (!showFlowEdges) return false;
    if (edgeAttrs['isFlowEdge'] || edgeAttrs['isCoupling']) return false;
    return flowPairKeys.has(`${source}→${target}`);
}

/**
 * Returns edge reducer override for flow edges based on toggle + selection state.
 * Returns null for non-flow edges (caller applies no override).
 * Returns { hidden: true } when showFlowEdges is false or when a node is selected
 * and the flow edge does not connect to it (prevents blue lines from dominating).
 * Returns { zIndex: 2 } when visible so flow edges stay readable above imports.
 */
export function getFlowEdgeReducerState(
    edgeAttrs: Record<string, unknown>,
    showFlowEdges: boolean,
    selectedNodeId?: string | null,
    source?: string,
    target?: string,
): Record<string, unknown> | null {
    if (!edgeAttrs['isFlowEdge']) return null;
    if (!showFlowEdges) return { hidden: true };
    // When a node is selected, hide flow edges that don't connect to it
    if (selectedNodeId && source && target) {
        if (source !== selectedNodeId && target !== selectedNodeId) {
            return { hidden: true };
        }
    }
    return { zIndex: 2 };
}
