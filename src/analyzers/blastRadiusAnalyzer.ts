import type { BlastRadius, SymbolEdge } from '../types';

/** Weight map for edge types used in blast-radius scoring. */
const EDGE_WEIGHTS: Record<SymbolEdge['edgeType'], number> = {
    calls: 1.0,
    extends: 1.5,
    implements: 1.2,
    uses_type: 0.5,
};

/**
 * Computes the blast radius of a symbol using BFS over the reverse call graph.
 *
 * Each caller is represented as `filePath:symbolName` to disambiguate
 * same-name symbols across files.
 *
 * Score is the sum of edge weights for all direct callers (hop 1 only),
 * giving a measure of how widely used the symbol is at first depth.
 */
export type AdjacencyMap = Map<string, Array<{ key: string; edgeType: SymbolEdge['edgeType'] }>>;

/** Pre-builds the reverse adjacency map for blast-radius computation. */
export function buildReverseAdjacency(edges: SymbolEdge[]): AdjacencyMap {
    const reverseAdj = new Map<string, Array<{ key: string; edgeType: SymbolEdge['edgeType'] }>>();
    for (const edge of edges) {
        const calleeKey = `${edge.targetFile}:${edge.targetName}`;
        const callerKey = `${edge.sourceFile}:${edge.sourceName}`;
        if (!reverseAdj.has(calleeKey)) reverseAdj.set(calleeKey, []);
        reverseAdj.get(calleeKey)!.push({ key: callerKey, edgeType: edge.edgeType });
    }
    return reverseAdj;
}

/**
 * Computes the blast radius of a symbol using BFS over the reverse call graph.
 */
export function computeBlastRadius(
    symbolName: string,
    filePath: string,
    edges: SymbolEdge[],
): BlastRadius {
    const reverseAdj = buildReverseAdjacency(edges);
    return computeBlastRadiusWithMap(symbolName, filePath, reverseAdj);
}

/**
 * Optimized version of blast-radius computation using a pre-built adjacency map.
 */
export function computeBlastRadiusWithMap(
    symbolName: string,
    filePath: string,
    reverseAdj: AdjacencyMap,
): BlastRadius {
    const targetKey = `${filePath}:${symbolName}`;

    // BFS from target symbol
    const visited = new Set<string>([targetKey]);
    const byHop: Record<number, string[]> = {};
    let queue: Array<{ key: string; hop: number }> = [{ key: targetKey, hop: 0 }];
    const directCallers: string[] = [];
    const transitiveCallers: string[] = [];
    let score = 0;

    while (queue.length > 0) {
        const next: Array<{ key: string; hop: number }> = [];
        for (const { key, hop } of queue) {
            const callers = reverseAdj.get(key) ?? [];
            for (const { key: callerKey, edgeType } of callers) {
                if (visited.has(callerKey)) continue;
                visited.add(callerKey);
                const callerHop = hop + 1;
                if (!byHop[callerHop]) byHop[callerHop] = [];
                byHop[callerHop].push(callerKey);
                if (callerHop === 1) {
                    directCallers.push(callerKey);
                    score += EDGE_WEIGHTS[edgeType] ?? 1.0;
                } else {
                    transitiveCallers.push(callerKey);
                }
                next.push({ key: callerKey, hop: callerHop });
            }
        }
        queue = next;
    }

    return {
        origin: symbolName,
        originFile: filePath,
        directCallers,
        transitiveCallers,
        score,
        byHop,
    };
}
