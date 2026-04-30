/**
 * Pure helper functions for SigmaGraph topology/layout work.
 *
 * Render-policy logic lives in sigmaRenderPolicy.ts so future graph topologies can reuse it.
 */

import type { GraphNode, Tour } from '../types';
import { NODE_COLORS } from './sigmaRenderPolicy';

/** Human-readable display labels for the node-type legend. */
export const NODE_TYPE_LABELS: Record<string, string> = {
    entry: 'Entry',
    route: 'Route',
    controller: 'Controller',
    service: 'Service',
    model: 'Model',
    component: 'Component',
    utility: 'Utility',
    config: 'Config',
    middleware: 'Middleware',
    test: 'Test',
    type: 'Type',
    libSource: 'Lib Source',
    unknown: 'Unknown',
};

/** Shared UI theme tokens for Sigma overlays and legends. */
export const THEME = {
    bg: '#1e293b',
    border: '#334155',
    textPrimary: '#e2e8f0',
    textSecondary: '#94a3b8',
    accent: '#6366f1',
};

/**
 * Returns whether the tour has any circular dependencies available for filtering.
 */
export function hasCircularEdgesInTour(tour: Tour | null | undefined): boolean {
    const snapshotCount = tour?.analysisSnapshot?.circularCount;
    if (typeof snapshotCount === 'number' && Number.isFinite(snapshotCount) && snapshotCount > 0) {
        return true;
    }
    return tour?.graph?.edges.some((edge) => Boolean(edge.isCircular)) ?? false;
}

/** Clustered graph plus position hints and original-to-display node mapping. */
export interface ClusteringResult {
    graph: Tour['graph'];
    positionHints: Map<string, { x: number; y: number }>;
    fileToOutputId: Map<string, string>;
}

/**
 * Collapse file nodes into directory cluster nodes.
 */
export function applyClientClustering(
    graph: Tour['graph'],
    expandedClusters: Set<string>,
    savedPositions: Map<string, { x: number; y: number }>,
): ClusteringResult {
    // Normalize file ids into directory groups before constructing clusters.
    const getDir = (pathLike: string) => {
        const parts = pathLike.split('/');
        return parts.length > 1 ? parts.slice(0, -1).join('/') : '.';
    };
    const clusterIdFor = (directory: string) => `cluster::${directory}`;

    const dirGroups = new Map<string, typeof graph.nodes>();
    for (const node of graph.nodes) {
        const dir = getDir(node.id);
        if (!dirGroups.has(dir)) dirGroups.set(dir, []);
        dirGroups.get(dir)!.push(node);
    }

    const newNodes: typeof graph.nodes = [];
    const fileToOutputId = new Map<string, string>();
    const positionHints = new Map<string, { x: number; y: number }>();

    for (const [dir, children] of dirGroups) {
        const clusterId = clusterIdFor(dir);
        if (expandedClusters.has(clusterId) || children.length === 1) {
            for (const child of children) {
                newNodes.push({ ...child, directory: dir });
                fileToOutputId.set(child.id, child.id);
                if (!savedPositions.has(child.id)) {
                    const clusterPos = savedPositions.get(clusterId);
                    if (clusterPos) {
                        positionHints.set(child.id, {
                            x: clusterPos.x + (Math.random() - 0.5) * 60,
                            y: clusterPos.y + (Math.random() - 0.5) * 60,
                        });
                    }
                }
            }
            continue;
        }

        const typeCounts = new Map<string, number>();
        let totalWeight = 0;
        for (const child of children) {
            typeCounts.set(child.type, (typeCounts.get(child.type) ?? 0) + 1);
            totalWeight += child.weight ?? 0;
        }
        const dominantType = [...typeCounts.entries()].sort((left, right) => right[1] - left[1])[0][0] as typeof children[0]['type'];

        newNodes.push({
            id: clusterId,
            label: dir.split('/').pop() || dir,
            type: dominantType,
            weight: totalWeight,
            isCluster: true,
            childCount: children.length,
            directory: dir,
        });

        for (const child of children) {
            fileToOutputId.set(child.id, clusterId);
        }

        if (!savedPositions.has(clusterId)) {
            const childPositions = children
                .map((child) => savedPositions.get(child.id))
                .filter((position): position is { x: number; y: number } => position != null);
            if (childPositions.length > 0) {
                const cx = childPositions.reduce((sum, position) => sum + position.x, 0) / childPositions.length;
                const cy = childPositions.reduce((sum, position) => sum + position.y, 0) / childPositions.length;
                positionHints.set(clusterId, { x: cx, y: cy });
            }
        }
    }

    const edgeMap = new Map<string, typeof graph.edges[0]>();
    for (const edge of graph.edges) {
        const src = fileToOutputId.get(edge.source) ?? edge.source;
        const tgt = fileToOutputId.get(edge.target) ?? edge.target;
        if (src === tgt) continue;

        const key = `${src}→${tgt}`;
        if (!edgeMap.has(key)) {
            edgeMap.set(key, { source: src, target: tgt, label: edge.label, isCircular: edge.isCircular });
            continue;
        }
        if (edge.isCircular) edgeMap.get(key)!.isCircular = true;
    }

    return {
        graph: { nodes: newNodes, edges: Array.from(edgeMap.values()) },
        positionHints,
        fileToOutputId,
    };
}

/**
 * Nudge overlapping nodes apart without rerunning ForceAtlas2.
 */
export function resolveNodeOverlap(
    nodes: Array<{ id: string; x: number; y: number; size: number }>,
    padding = 4,
    passes = 5,
): void {
    for (let pass = 0; pass < passes; pass++) {
        let anyOverlap = false;
        for (let index = 0; index < nodes.length; index++) {
            for (let compareIndex = index + 1; compareIndex < nodes.length; compareIndex++) {
                const a = nodes[index];
                const b = nodes[compareIndex];
                const dx = b.x - a.x;
                const dy = b.y - a.y;
                const dist = Math.sqrt(dx * dx + dy * dy) || 0.001;
                const minDist = a.size + b.size + padding;
                if (dist < minDist) {
                    anyOverlap = true;
                    const overlap = (minDist - dist) / 2;
                    const nx = dx / dist;
                    const ny = dy / dist;
                    a.x -= nx * overlap;
                    a.y -= ny * overlap;
                    b.x += nx * overlap;
                    b.y += ny * overlap;
                }
            }
        }
        if (!anyOverlap) break;
    }
}

/** Node data shape expected by drawMinimap. */
export interface MinimapNode {
    id: string;
    x: number;
    y: number;
    color: string;
    size: number;
}

/**
 * Renders a scaled-down dot map of all graph nodes onto the provided canvas.
 */
export function drawMinimap(
    canvas: HTMLCanvasElement,
    nodes: MinimapNode[],
    selectedNodeId: string | null,
): void {
    const ctx = canvas.getContext('2d');
    if (!ctx || nodes.length === 0) {
        ctx?.clearRect(0, 0, canvas.width, canvas.height);
        return;
    }

    const pad = 8;
    const w = canvas.width - pad * 2;
    const h = canvas.height - pad * 2;

    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const node of nodes) {
        if (node.x < minX) minX = node.x;
        if (node.x > maxX) maxX = node.x;
        if (node.y < minY) minY = node.y;
        if (node.y > maxY) maxY = node.y;
    }

    const rangeX = maxX - minX || 1;
    const rangeY = maxY - minY || 1;
    const scale = Math.min(w / rangeX, h / rangeY) * 0.92;
    const offX = pad + (w - rangeX * scale) / 2;
    const offY = pad + (h - rangeY * scale) / 2;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    for (const node of nodes) {
        const px = offX + (node.x - minX) * scale;
        const py = offY + (node.y - minY) * scale;
        const radius = Math.max(1.5, Math.min(node.size * 0.18, 4));
        ctx.beginPath();
        ctx.arc(px, py, radius, 0, Math.PI * 2);
        ctx.fillStyle = node.id === selectedNodeId ? '#ffffff' : node.color;
        ctx.globalAlpha = node.id === selectedNodeId ? 1 : 0.75;
        ctx.fill();
    }
    ctx.globalAlpha = 1;
}

/**
 * Builds Graphology node attributes from a GraphNode for Sigma rendering.
 */
export function buildNodeAttrs(
    node: GraphNode,
    savedPositions: Map<string, { x: number; y: number }>,
    positionHints: Map<string, { x: number; y: number }>,
) {
    const color = NODE_COLORS[node.type] ?? NODE_COLORS.unknown;
    let size = 7 + Math.min(node.weight ?? 0, 12);
    if (node.isCluster) size = 16 + Math.min(node.childCount ?? 0, 20);
    const saved = savedPositions.get(node.id);
    const hint = positionHints.get(node.id);
    const angle = Math.random() * 2 * Math.PI;
    const radius = 200 + Math.random() * 200;

    return {
        label: node.isCluster ? `${node.label}/ (${node.childCount})` : node.label,
        x: saved?.x ?? hint?.x ?? Math.cos(angle) * radius,
        y: saved?.y ?? hint?.y ?? Math.sin(angle) * radius,
        size,
        originalSize: size,
        color,
        originalColor: color,
        borderColor: color,
        borderSize: 0,
        halo: false,
        nodeType: node.type,
        isCluster: node.isCluster ?? false,
    };
}

/** Graph filter state tracked in the SigmaGraph component. */
export interface Filters {
    showTestFiles: boolean;
    showCircularOnly: boolean;
    groupDirs: boolean;
}
