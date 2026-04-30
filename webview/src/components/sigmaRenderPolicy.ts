/** Node fill colors by semantic graph type. */
export const NODE_COLORS: Record<string, string> = {
    entry: '#22d3ee',
    route: '#3b82f6',
    controller: '#8b5cf6',
    service: '#eab308',
    model: '#ef4444',
    component: '#f97316',
    utility: '#22c55e',
    config: '#6366f1',
    middleware: '#ec4899',
    test: '#94a3b8',
    type: '#14b8a6',
    libSource: '#7c3aed',
    unknown: '#64748b',
};

/** Upstream selection ring color. */
export const UPSTREAM_COLOR = '#34d399';

/** Downstream selection ring color. */
export const DOWNSTREAM_COLOR = '#fb923c';

/** Step-highlight halo ring color. */
export const STEP_GLOW_COLOR = '#ffffff';

/** Circular dependency edge and ring color. */
export const CIRCULAR_COLOR = '#ef4444';

/** Default edge color when no selection state is active. */
export const BASE_EDGE_COLOR = '#94a3b448';

/** Sentinel edge color meaning the edge should be hidden in the reducer. */
export const DIM_EDGE_COLOR = '#64748b28';

/** Render-only node visual state used by Sigma reducers. */
interface NodeVisuals {
    color: string;
    borderColor: string;
    borderSize: number;
    halo: boolean;
}

/** Disjoint relationship buckets derived from raw adjacency sets for one selected node. */
export interface SelectionSets {
    upstreamOnly: Set<string>;
    downstreamOnly: Set<string>;
    circular: Set<string>;
}

/** Reducer filter flags applied to Sigma node and edge state. */
export interface FilterState {
    showTestFiles: boolean;
    showCircularOnly: boolean;
}

/**
 * Computes the base node fill color under the current selection state.
 */
export function nodeColorFor(
    nodeId: string,
    nodeType: string,
    selectedNodeId: string | null,
    upstreamNodes: Set<string>,
    downstreamNodes: Set<string>,
    activeStepFiles: Set<string>,
): string {
    const base = NODE_COLORS[nodeType] ?? NODE_COLORS.unknown;
    if (nodeId === selectedNodeId) return base;
    if (upstreamNodes.has(nodeId)) return UPSTREAM_COLOR;
    if (downstreamNodes.has(nodeId)) return DOWNSTREAM_COLOR;
    if (activeStepFiles.has(nodeId)) return base;
    if (selectedNodeId) return `${base}44`;
    return base;
}

/**
 * Computes full node visuals, keeping semantic fill color separate from structural border rings.
 */
export function nodeVisualsFor(
    nodeId: string,
    nodeType: string,
    selectedNodeId: string | null,
    upstreamNodes: Set<string>,
    downstreamNodes: Set<string>,
    activeStepFiles: Set<string>,
    circularNodes?: Set<string>,
): NodeVisuals {
    const base = NODE_COLORS[nodeType] ?? NODE_COLORS.unknown;
    const isStepActive = activeStepFiles.has(nodeId);

    let borderColor = base;
    let borderSize = 0;
    let halo = false;

    if (nodeId === selectedNodeId) {
        borderColor = '#ffffff';
        borderSize = 0.2;
    } else if (circularNodes?.has(nodeId)) {
        borderColor = CIRCULAR_COLOR;
        borderSize = 0.15;
    } else if (upstreamNodes.has(nodeId)) {
        borderColor = UPSTREAM_COLOR;
        borderSize = 0.15;
    } else if (downstreamNodes.has(nodeId)) {
        borderColor = DOWNSTREAM_COLOR;
        borderSize = 0.15;
    }

    if (isStepActive) {
        halo = true;
        if (borderSize === 0) {
            borderColor = STEP_GLOW_COLOR;
            borderSize = 0.1;
        }
    }

    const isHighlighted = upstreamNodes.has(nodeId) || downstreamNodes.has(nodeId) || circularNodes?.has(nodeId);
    const dimmed = selectedNodeId != null && nodeId !== selectedNodeId && !isHighlighted && !isStepActive;
    const color = dimmed ? `${base}44` : base;

    return { color, borderColor, borderSize, halo };
}

/**
 * Splits raw adjacency sets for the selected node into upstream, downstream, and circular buckets.
 */
export function computeSelectionSets(
    upstreamMap: Map<string, Set<string>>,
    downstreamMap: Map<string, Set<string>>,
    selectedNodeId: string | null,
    circularNeighborMap?: Map<string, Set<string>>,
): SelectionSets {
    const empty: SelectionSets = { upstreamOnly: new Set(), downstreamOnly: new Set(), circular: new Set() };
    if (!selectedNodeId) return empty;

    const rawUp = upstreamMap.get(selectedNodeId) ?? new Set<string>();
    const rawDown = downstreamMap.get(selectedNodeId) ?? new Set<string>();

    const upstreamOnly = new Set<string>();
    const downstreamOnly = new Set<string>();
    const circular = new Set<string>();

    if (circularNeighborMap) {
        const circularNeighbors = circularNeighborMap.get(selectedNodeId) ?? new Set<string>();
        for (const id of circularNeighbors) circular.add(id);
        for (const id of rawUp) {
            if (!circular.has(id)) upstreamOnly.add(id);
        }
        for (const id of rawDown) {
            if (!circular.has(id)) downstreamOnly.add(id);
        }
    } else {
        for (const id of rawUp) {
            if (rawDown.has(id)) circular.add(id);
            else upstreamOnly.add(id);
        }
        for (const id of rawDown) {
            if (!rawUp.has(id)) downstreamOnly.add(id);
        }
    }

    return { upstreamOnly, downstreamOnly, circular };
}

/**
 * Computes edge styling based on selection state and circular filtering.
 */
export function edgeColorFor(
    source: string,
    target: string,
    isCircular: boolean | undefined,
    selectedNodeId: string | null,
    showCircularOnly = false,
): { color: string; size: number } {
    if (showCircularOnly) {
        return { color: CIRCULAR_COLOR, size: 2.5 };
    }
    if (selectedNodeId) {
        const isConnected = source === selectedNodeId || target === selectedNodeId;
        if (isConnected && isCircular) return { color: CIRCULAR_COLOR, size: 3 };
        if (target === selectedNodeId) return { color: UPSTREAM_COLOR, size: 3 };
        if (source === selectedNodeId) return { color: DOWNSTREAM_COLOR, size: 3 };
        return { color: DIM_EDGE_COLOR, size: 0.5 };
    }
    return { color: BASE_EDGE_COLOR, size: 1.5 };
}

/**
 * Computes the final Sigma node reducer state in one pass.
 */
export function buildNodeReducerState(
    nodeId: string,
    data: Record<string, unknown>,
    filters: FilterState,
    selectedNodeId: string | null,
    upstreamNodes: Set<string>,
    downstreamNodes: Set<string>,
    activeStepFiles: Set<string>,
    circularNodeIds?: Set<string>,
    highlightedType?: string | null,
): Record<string, unknown> {
    const result: Record<string, unknown> = { ...data };
    const nodeType = data.nodeType as string;

    if (!filters.showTestFiles && nodeType === 'test') {
        result.hidden = true;
        return result;
    }

    if (filters.showCircularOnly && circularNodeIds && !circularNodeIds.has(nodeId)) {
        result.hidden = true;
        return result;
    }

    const visuals = nodeVisualsFor(nodeId, nodeType, selectedNodeId, upstreamNodes, downstreamNodes, activeStepFiles, circularNodeIds);
    const base = (data.originalSize as number) ?? (data.size as number);
    const isHighlightedNode = upstreamNodes.has(nodeId) || downstreamNodes.has(nodeId) || circularNodeIds?.has(nodeId);
    const size = nodeId === selectedNodeId
        ? Math.max(base, 14)
        : isHighlightedNode
            ? Math.max(base, 10)
            : visuals.halo ? Math.max(base, 10) : base;

    result.color = visuals.color;
    result.borderColor = visuals.borderColor;
    result.borderSize = visuals.borderSize;
    result.halo = visuals.halo;
    result.size = size;
    if (visuals.halo) result.zIndex = 1;

    if (highlightedType) {
        const rawColor = NODE_COLORS[nodeType] ?? '#64748b';
        if (nodeType !== highlightedType) {
            result.color = `${rawColor}33`;
            result.borderSize = 0;
            result.halo = false;
            result.size = base;
            result.zIndex = 0;
        } else {
            result.color = rawColor;
            result.borderColor = '#ffffff';
            result.borderSize = 0.15;
            result.size = Math.max(base * 1.3, 12);
            result.zIndex = 2;
        }
    }

    return result;
}

/**
 * Computes the final Sigma edge reducer state in one pass.
 */
export function buildEdgeReducerState(
    data: Record<string, unknown>,
    source: string,
    target: string,
    filters: FilterState,
    hiddenNodes: Set<string>,
    selectedNodeId: string | null,
    highlightedType?: string | null,
    nodeTypeMap?: Map<string, string>,
): Record<string, unknown> {
    const result: Record<string, unknown> = { ...data };

    if (hiddenNodes.has(source) || hiddenNodes.has(target)) {
        result.hidden = true;
        return result;
    }

    if (filters.showCircularOnly && !data.isCircular) {
        result.hidden = true;
        return result;
    }

    const { color, size } = edgeColorFor(source, target, data.isCircular as boolean | undefined, selectedNodeId, filters.showCircularOnly);
    if (color === DIM_EDGE_COLOR) {
        result.hidden = true;
        return result;
    }
    result.color = color;
    result.size = size;

    if (highlightedType && nodeTypeMap) {
        const srcType = nodeTypeMap.get(source);
        const tgtType = nodeTypeMap.get(target);
        if (srcType !== highlightedType || tgtType !== highlightedType) {
            result.color = `${DIM_EDGE_COLOR}55`;
            result.size = 0.5;
        }
    }

    return result;
}