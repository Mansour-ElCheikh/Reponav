import { findBridgeEdges, BridgeEdge } from './communityAnalyzer';
import { buildCondensationDag } from './layerDag';
import type { ImportEdge, CoChangePair, AnalysisReport } from '../types';

export interface SeamCandidate {
    id: string;
    score: number;
    description: string;
    sourceCluster: string[];
    targetCluster: string[];
    cutEdges: { source: string, target: string }[];
    rationale: string;
}

/**
 * Detects potential architectural seams in the codebase by identifying "cut points"
 * where a monolith or highly coupled cluster can be split.
 * A good seam has high "Edge Betweenness" (bridge) but LOW "Change Coupling".
 * 
 * @param nodes - List of all file nodes in the workspace.
 * @param importEdges - Dependency graph edges.
 * @param couplings - Historical co-change pairs from git history.
 * @returns A ranked list of seam candidates for refactoring.
 */
export function detectSeams(
    nodes: string[],
    importEdges: ImportEdge[],
    couplings: CoChangePair[]
): SeamCandidate[] {
    const bridgeEdges = findBridgeEdges(nodes, importEdges, 50);
    const dag = buildCondensationDag(nodes, importEdges);
    
    // Map of file -> SCC index
    const nodeToComp = new Map<string, number>();
    dag.components.forEach((comp, idx) => {
        comp.forEach(node => nodeToComp.set(node, idx));
    });

    // Create a map for quick coupling lookup
    const couplingMap = new Map<string, number>();
    couplings.forEach(c => {
        const key = c.fileA < c.fileB ? `${c.fileA}|${c.fileB}` : `${c.fileB}|${c.fileA}`;
        couplingMap.set(key, c.confidence);
    });

    const candidates: SeamCandidate[] = [];

    // Strategy 1: Inter-component seams (edges between SCCs)
    // We look for "bottle-necks" in the condensation DAG.
    for (const bridge of bridgeEdges) {
        const fromComp = nodeToComp.get(bridge.source);
        const toComp = nodeToComp.get(bridge.target);

        if (fromComp === undefined || toComp === undefined || fromComp === toComp) continue;

        // Calculate Coupling between these two components
        let totalCoupling = 0;
        let pairCount = 0;
        const compA = dag.components[fromComp];
        const compB = dag.components[toComp];

        for (const fileA of compA) {
            for (const fileB of compB) {
                const key = fileA < fileB ? `${fileA}|${fileB}` : `${fileB}|${fileA}`;
                const conf = couplingMap.get(key);
                if (conf !== undefined) {
                    totalCoupling += conf;
                    pairCount++;
                }
            }
        }

        const avgCoupling = pairCount > 0 ? totalCoupling / pairCount : 0;
        
        // Seam Score: High betweenness, Low coupling
        // Normalize betweenness (0-100)
        // In a graph of N nodes, max betweenness is roughly N^2/2. 
        // We'll use a more aggressive scaling for small repos.
        const normalizedBetweenness = Math.min(100, (bridge.betweenness / nodes.length) * 100);
        // Inverse coupling (1 - confidence)
        const couplingFactor = Math.max(0, 1 - avgCoupling);

        const score = Math.round(normalizedBetweenness * 0.7 + (couplingFactor * 30));

        if (score > 30) {
            candidates.push({
                id: `seam-${bridge.source}-${bridge.target}`,
                score,
                description: `Potential seam between Component ${fromComp} and Component ${toComp}`,
                sourceCluster: compA,
                targetCluster: compB,
                cutEdges: [{ source: bridge.source, target: bridge.target }],
                rationale: `High structural betweenness (${bridge.betweenness.toFixed(0)}) with low historical change coupling (${avgCoupling.toFixed(2)}). Suggests these are logically distinct modules connected by a narrow bridge.`,
            });
        }
    }

    // Deduplicate and sort
    return candidates
        .sort((a, b) => b.score - a.score)
        .slice(0, 10);
}
