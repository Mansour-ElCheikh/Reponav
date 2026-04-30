/** Implemented by Antigravity (2026-04-26) */
import type { ImportEdge } from '../types';

/**
 * Community Analyzer (v1.0)
 * 
 * Identifies "Bridge Edges" in the dependency graph.
 * A bridge edge is a dependency that, if removed, significantly disconnects the graph.
 */

export interface BridgeEdge {
    source: string;
    target: string;
    betweenness: number; // Importance score
}

/**
 * Computes a simplified Edge Betweenness Centrality.
 * 
 * For each node, we perform a BFS to find shortest paths to all other nodes.
 * We count how many shortest paths pass through each edge.
 */
export function findBridgeEdges(
    nodes: string[],
    edges: ImportEdge[],
    topN: number = 20
): BridgeEdge[] {
    const adj = new Map<string, string[]>();
    for (const n of nodes) adj.set(n, []);
    for (const e of edges) {
        if (adj.has(e.source)) adj.get(e.source)!.push(e.target);
    }

    const edgeCounts = new Map<string, number>();

    // For every node as source
    for (const startNode of nodes) {
        const { paths, predecessors } = bfsShortestPaths(startNode, adj);
        
        // Count edges in shortest paths
        for (const endNode of nodes) {
            if (startNode === endNode) continue;
            const ways = predecessors.get(endNode);
            if (ways && ways.length > 0) {
                // Approximate: just trace one shortest path back
                traceBack(endNode, predecessors, edgeCounts);
            }
        }
    }

    const results: BridgeEdge[] = [];
    for (const [key, count] of edgeCounts.entries()) {
        const [source, target] = key.split('|');
        results.push({ source, target, betweenness: count });
    }

    return results.sort((a, b) => b.betweenness - a.betweenness).slice(0, topN);
}

export function bfsShortestPaths(startNode: string, adj: Map<string, string[]>) {
    const distances = new Map<string, number>();
    const predecessors = new Map<string, string[]>();
    const queue: string[] = [startNode];
    distances.set(startNode, 0);

    while (queue.length > 0) {
        const v = queue.shift()!;
        for (const w of (adj.get(v) ?? [])) {
            if (!distances.has(w)) {
                distances.set(w, distances.get(v)! + 1);
                predecessors.set(w, [v]);
                queue.push(w);
            } else if (distances.get(w) === distances.get(v)! + 1) {
                predecessors.get(w)!.push(v);
            }
        }
    }

    return { distances, predecessors };
}

export function traceBack(
    node: string,
    predecessors: Map<string, string[]>,
    edgeCounts: Map<string, number>
) {
    const preds = predecessors.get(node);
    if (!preds || preds.length === 0) return;
    
    // Simplification: pick the first predecessor to avoid exponential path tracing
    const p = preds[0];
    const key = `${p}|${node}`;
    edgeCounts.set(key, (edgeCounts.get(key) ?? 0) + 1);
    traceBack(p, predecessors, edgeCounts);
}
