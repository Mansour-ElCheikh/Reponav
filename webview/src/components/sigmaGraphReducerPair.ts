import { applyDeadCodeAttributes } from './sigmaDeadCodeOverlay';
import {
    buildEdgeReducerState,
    buildNodeReducerState,
    type FilterState,
} from './sigmaRenderPolicy';
import {
    getCouplingEdgeReducerState,
    shouldSuppressImportEdgeForFlowPair,
} from './sigmaEdgeRenderers';

/** Parameters required to assemble the coupled Sigma node and edge reducers. */
export interface BuildSigmaReducerPairParams {
    filterState: FilterState;
    selectedNodeId: string | null;
    activeSubFilter: 'upstream' | 'downstream' | 'circular' | null;
    highlightedType: string | null;
    activeStepFiles: Set<string>;
    upstreamNodes: Set<string>;
    downstreamNodes: Set<string>;
    circularNodes?: Set<string>;
    selectionCircularNodes: Set<string>;
    deadCodeFileSet?: ReadonlySet<string>;
    showCouplingEdges: boolean;
    showFlowEdges: boolean;
    flowPairKeys: Set<string>;
    nodeTypeMap: Map<string, string>;
}

/** Paired reducers returned for installation on the live Sigma renderer. */
export interface SigmaReducerPair {
    nodeReducer: (node: string, data: Record<string, unknown>) => Record<string, unknown>;
    edgeReducer: (edge: string, data: Record<string, unknown>, source: string, target: string) => Record<string, unknown>;
}

/**
 * Builds the coupled Sigma reducer pair so node hiding, flow suppression, dead-code dimming,
 * coupling overrides, and legend subfilters share one consistent snapshot.
 */
export function buildSigmaReducerPair({
    filterState,
    selectedNodeId,
    activeSubFilter,
    highlightedType,
    activeStepFiles,
    upstreamNodes,
    downstreamNodes,
    circularNodes,
    selectionCircularNodes,
    deadCodeFileSet,
    showCouplingEdges,
    showFlowEdges,
    flowPairKeys,
    nodeTypeMap,
}: BuildSigmaReducerPairParams): SigmaReducerPair {
    const hiddenNodes = new Set<string>();
    const mergedCircular = selectionCircularNodes.size > 0 || (circularNodes?.size ?? 0) > 0
        ? new Set([...(circularNodes ?? []), ...selectionCircularNodes])
        : undefined;

    const nodeReducer = (node: string, data: Record<string, unknown>): Record<string, unknown> => {
        const state = buildNodeReducerState(
            node,
            data,
            filterState,
            selectedNodeId,
            upstreamNodes,
            downstreamNodes,
            activeStepFiles,
            mergedCircular,
            highlightedType,
        );
        if (state.hidden) hiddenNodes.add(node);
        else hiddenNodes.delete(node);

        if (activeSubFilter && selectedNodeId && node !== selectedNodeId) {
            const matchingSet = activeSubFilter === 'upstream'
                ? upstreamNodes
                : activeSubFilter === 'downstream'
                    ? downstreamNodes
                    : selectionCircularNodes;
            if (!matchingSet.has(node)) {
                const base = (data.color as string) ?? '#64748b';
                const bareColor = base.length === 9 ? base.slice(0, 7) : base.length === 5 ? base.slice(0, 4) : base;
                return { ...data, ...state, color: `${bareColor}22`, borderSize: 0 };
            }
        }

        const filePath = (data.label ?? node) as string;
        const deadAttrs = deadCodeFileSet ? applyDeadCodeAttributes(node, filePath, deadCodeFileSet) : null;
        if (deadAttrs) {
            return {
                ...data,
                ...state,
                color: deadAttrs.color,
                size: ((state.size ?? data.size ?? 7) as number) * deadAttrs.sizeMultiplier,
            };
        }

        return { ...data, ...state };
    };

    const edgeReducer = (
        _edge: string,
        data: Record<string, unknown>,
        source: string,
        target: string,
    ): Record<string, unknown> => {
        const couplingOverride = getCouplingEdgeReducerState(data, showCouplingEdges, selectedNodeId, source, target);
        if (couplingOverride !== null) return { ...data, ...couplingOverride };

        if (shouldSuppressImportEdgeForFlowPair(data, source, target, showFlowEdges, flowPairKeys)) {
            return { ...data, hidden: true };
        }

        const state = buildEdgeReducerState(
            data,
            source,
            target,
            filterState,
            hiddenNodes,
            selectedNodeId,
            highlightedType,
            nodeTypeMap,
        );

        if (activeSubFilter && selectedNodeId) {
            const matchingSet = activeSubFilter === 'upstream'
                ? upstreamNodes
                : activeSubFilter === 'downstream'
                    ? downstreamNodes
                    : selectionCircularNodes;
            const isMatching = matchingSet.has(source) || matchingSet.has(target);
            if (!isMatching) return { ...data, ...state, hidden: true };
        }

        return { ...data, ...state };
    };

    return { nodeReducer, edgeReducer };
}