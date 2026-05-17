import type { BlastRadius, ImportEdge, SymbolEdge } from '../types';

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

// Build reverse file adjacency for propagation reach calculations.
function buildFileReverseAdjacency(
    files: string[],
    edges: ImportEdge[],
): Map<string, Set<string>> {
    const reverseAdj = new Map<string, Set<string>>();
    for (const file of files) {
        reverseAdj.set(file, new Set());
    }
    for (const edge of edges) {
        if (!reverseAdj.has(edge.target)) reverseAdj.set(edge.target, new Set());
        reverseAdj.get(edge.target)!.add(edge.source);
        if (!reverseAdj.has(edge.source)) reverseAdj.set(edge.source, new Set());
    }
    return reverseAdj;
}

// BFS over a precomputed reverse adjacency map. Used by both single-file and ranked propagation reach.
function reachableCountFromReverseAdj(
    filePath: string,
    reverseAdj: Map<string, Set<string>>,
): number {
    const visited = new Set<string>([filePath]);
    const queue: string[] = [filePath];

    while (queue.length > 0) {
        const current = queue.shift()!;
        for (const dependent of reverseAdj.get(current) ?? []) {
            if (visited.has(dependent)) continue;
            visited.add(dependent);
            queue.push(dependent);
        }
    }
    return visited.size;
}

/** Compute reverse dependency reach for a file across the full analyzed file set. */
export function computeFilePropagationReach(
    filePath: string,
    files: string[],
    edges: ImportEdge[],
): number | null {
    if (files.length === 0) return null;
    if (!files.includes(filePath)) return null;

    const reverseAdj = buildFileReverseAdjacency(files, edges);
    return (reachableCountFromReverseAdj(filePath, reverseAdj) - 1) / files.length;
}

/** Rank files by reverse dependency reach so summary output can surface the broadest blast areas. */
export function rankFilePropagationReach(
    files: string[],
    edges: ImportEdge[],
    limit: number,
): Array<{ file: string; value: number }> {
    if (files.length === 0) return [];

    // Build reverse adjacency once and reuse across every file's BFS.
    // Previously this was rebuilt per file inside computeFilePropagationReach, making the rank O(N²·E).
    const reverseAdj = buildFileReverseAdjacency(files, edges);
    const denominator = files.length;

    return files
        .map((file) => ({
            file,
            value: (reachableCountFromReverseAdj(file, reverseAdj) - 1) / denominator,
        }))
        .sort((left, right) => {
            if (right.value !== left.value) return right.value - left.value;
            return left.file.localeCompare(right.file);
        })
        .slice(0, limit);
}
