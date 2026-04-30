import type Graph from 'graphology';
import forceAtlas2 from 'graphology-layout-forceatlas2';
import { BASE_EDGE_COLOR, CIRCULAR_COLOR } from './sigmaRenderPolicy';
import {
    applyClientClustering, resolveNodeOverlap, buildNodeAttrs,
} from './sigmaGraphHelpers';
import type { GraphData } from '../types';

export interface GroupingLayoutResult {
    fileToDisplayNode: Map<string, string>;
}

/**
 * Applies in-place graph mutation for directory grouping (Effect C).
 * Mutates `g` to reflect the current groupDirs setting, then runs a short layout
 * pass for any newly-added nodes only. Called from SigmaGraph Effect C.
 */
export function applyGroupingLayout(
    g: Graph,
    baseGraph: GraphData,
    groupDirs: boolean,
    expandedClusters: Set<string>,
    savedPositions: Map<string, { x: number; y: number }>,
): GroupingLayoutResult {
    // Save positions before mutation
    g.forEachNode((id, attrs) => {
        savedPositions.set(id, { x: attrs.x as number, y: attrs.y as number });
    });

    let fileToDisplayNode = new Map<string, string>();

    if (groupDirs) {
        const { graph: clusteredGraph, positionHints, fileToOutputId } = applyClientClustering(
            baseGraph, expandedClusters, savedPositions,
        );
        fileToDisplayNode = fileToOutputId;
        const targetNodeIds = new Set(clusteredGraph.nodes.map((n) => n.id));
        const targetEdgeKeys = new Set(clusteredGraph.edges.map((e) => `${e.source}→${e.target}`));

        for (const id of g.nodes()) {
            if (!targetNodeIds.has(id)) g.dropNode(id);
        }
        for (const node of clusteredGraph.nodes) {
            if (!g.hasNode(node.id)) {
                g.addNode(node.id, buildNodeAttrs(node, savedPositions, positionHints));
            }
        }
        for (const edgeKey of g.edges()) {
            if (!targetEdgeKeys.has(edgeKey)) g.dropEdge(edgeKey);
        }
        for (const edge of clusteredGraph.edges) {
            const key = `${edge.source}→${edge.target}`;
            if (!g.hasEdge(key) && g.hasNode(edge.source) && g.hasNode(edge.target)) {
                g.addEdgeWithKey(key, edge.source, edge.target, {
                    color: edge.isCircular ? CIRCULAR_COLOR : BASE_EDGE_COLOR,
                    size: edge.isCircular ? 2.5 : 1.5,
                    isCircular: edge.isCircular ?? false,
                });
            }
        }
    } else {
        const targetNodeIds = new Set(baseGraph.nodes.map((n) => n.id));
        const targetEdgeKeys = new Set(baseGraph.edges.map((e) => `${e.source}→${e.target}`));
        const emptyHints = new Map<string, { x: number; y: number }>();
        fileToDisplayNode = new Map(baseGraph.nodes.map((n) => [n.id, n.id]));

        for (const id of g.nodes()) {
            if (!targetNodeIds.has(id)) g.dropNode(id);
        }
        for (const node of baseGraph.nodes) {
            if (!g.hasNode(node.id)) {
                g.addNode(node.id, buildNodeAttrs(node, savedPositions, emptyHints));
            }
        }
        for (const edgeKey of g.edges()) {
            if (!targetEdgeKeys.has(edgeKey)) g.dropEdge(edgeKey);
        }
        const nodeSet = new Set(g.nodes());
        for (const edge of baseGraph.edges) {
            const key = `${edge.source}→${edge.target}`;
            if (!g.hasEdge(key) && nodeSet.has(edge.source) && nodeSet.has(edge.target)) {
                g.addEdgeWithKey(key, edge.source, edge.target, {
                    color: edge.isCircular ? CIRCULAR_COLOR : BASE_EDGE_COLOR,
                    size: edge.isCircular ? 2.5 : 1.5,
                    isCircular: edge.isCircular ?? false,
                });
            }
        }
    }

    // Short layout pass for newly added nodes only
    const unpositioned = g.nodes().filter((id) => !savedPositions.has(id));
    if (unpositioned.length > 0) {
        for (const nodeId of unpositioned) {
            const neighbors = g.neighbors(nodeId);
            const positioned = neighbors.filter((n) => savedPositions.has(n));
            if (positioned.length > 0) {
                let avgX = 0, avgY = 0;
                for (const n of positioned) { const p = savedPositions.get(n)!; avgX += p.x; avgY += p.y; }
                avgX /= positioned.length; avgY /= positioned.length;
                g.mergeNodeAttributes(nodeId, {
                    x: avgX + (Math.random() - 0.5) * 50,
                    y: avgY + (Math.random() - 0.5) * 50,
                });
            }
        }
        const gIter = g.order <= 300 ? 40 : 25;
        const inferred = forceAtlas2.inferSettings(g) as Record<string, unknown>;
        const scalingRatio = typeof inferred['scalingRatio'] === 'number' ? (inferred['scalingRatio'] as number) : 1;
        const gravity = typeof inferred['gravity'] === 'number' ? (inferred['gravity'] as number) : 1;
        const slowDown = typeof inferred['slowDown'] === 'number' ? (inferred['slowDown'] as number) : 1;
        forceAtlas2.assign(g, {
            iterations: gIter,
            settings: {
                ...inferred,
                adjustSizes: false,
                scalingRatio: Math.max(scalingRatio * 1.35, 4),
                gravity: Math.min(Math.max(gravity * 0.7, 0.05), 0.5),
                slowDown: Math.max(slowDown, 1.2),
            },
        });
        const nodeData2 = g.nodes().map((id) => {
            const a = g.getNodeAttributes(id);
            return { id, x: a.x as number, y: a.y as number, size: a.size as number };
        });
        resolveNodeOverlap(nodeData2);
        for (const { id, x, y } of nodeData2) g.mergeNodeAttributes(id, { x, y });
    }

    return { fileToDisplayNode };
}
