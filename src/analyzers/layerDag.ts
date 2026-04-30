import type { ImportEdge, LayerViolation } from '../types';

// ─── Tarjan SCC ───────────────────────────────────────────────────────────

/** Result of Condensation DAG computation. */
export interface CondensationDag {
    /** Each element is one SCC (an array of node IDs grouped together). */
    components: string[][];
    /** Edges between SCC indices in the condensation (no cycles). */
    dagEdges: Array<{ from: number; to: number }>;
}

/**
 * Builds a condensation DAG from a directed graph using Tarjan's SCC algorithm.
 * Returns the SCCs (components) and the acyclic inter-component edges.
 */
export function buildCondensationDag(nodes: string[], edges: ImportEdge[]): CondensationDag {
    const index = new Map<string, number>();
    const lowlink = new Map<string, number>();
    const onStack = new Map<string, boolean>();
    const stack: string[] = [];
    const components: string[][] = [];
    let counter = 0;

    const adj = new Map<string, string[]>();
    for (const n of nodes) adj.set(n, []);
    for (const e of edges) {
        if (adj.has(e.source) && adj.has(e.target)) {
            adj.get(e.source)!.push(e.target);
        }
    }

    const strongConnect = (v: string) => {
        index.set(v, counter);
        lowlink.set(v, counter);
        counter++;
        stack.push(v);
        onStack.set(v, true);

        for (const w of (adj.get(v) ?? [])) {
            if (!index.has(w)) {
                strongConnect(w);
                lowlink.set(v, Math.min(lowlink.get(v)!, lowlink.get(w)!));
            } else if (onStack.get(w)) {
                lowlink.set(v, Math.min(lowlink.get(v)!, index.get(w)!));
            }
        }

        if (lowlink.get(v) === index.get(v)) {
            const scc: string[] = [];
            let w: string;
            do {
                w = stack.pop()!;
                onStack.set(w, false);
                scc.push(w);
            } while (w !== v);
            components.push(scc);
        }
    };

    for (const n of nodes) {
        if (!index.has(n)) strongConnect(n);
    }

    // Build component lookup
    const nodeToComp = new Map<string, number>();
    for (let i = 0; i < components.length; i++) {
        for (const n of components[i]) nodeToComp.set(n, i);
    }

    // Condensation edges (deduplicated)
    const dagEdgeSet = new Set<string>();
    const dagEdges: Array<{ from: number; to: number }> = [];
    for (const e of edges) {
        const from = nodeToComp.get(e.source);
        const to = nodeToComp.get(e.target);
        if (from !== undefined && to !== undefined && from !== to) {
            const key = `${from}→${to}`;
            if (!dagEdgeSet.has(key)) {
                dagEdgeSet.add(key);
                dagEdges.push({ from, to });
            }
        }
    }

    return { components, dagEdges };
}

// ─── Layer assignment ─────────────────────────────────────────────────────

/** Category → numeric layer mapping. Lower = closer to entry/presentation. */
const CATEGORY_LAYER: Record<string, number> = {
    entry: 1,
    route: 1,
    presentation: 1,
    controller: 2,
    middleware: 2,
    service: 3,
    domain: 3,
    model: 4,
    repository: 4,
    persistence: 5,
    infrastructure: 5,
    config: 0,
    utility: 0,
    test: -2,
};

/**
 * Assigns a numeric layer to each file based on its category.
 * Files with unknown category are assigned layer -1 (unknown).
 * Utility and config files get layer 0 (exempt from violation checks).
 */
export function assignLayers(
    files: string[],
    categories: Map<string, string>,
): Map<string, number> {
    const result = new Map<string, number>();
    for (const file of files) {
        const category = categories.get(file) ?? '';
        const layer = CATEGORY_LAYER[category] ?? -1;
        result.set(file, layer);
    }
    return result;
}

// ─── Violation detection ──────────────────────────────────────────────────

const SKIP_THRESHOLD = 2; // skipping ≥2 layer levels counts as a skip-layer violation

/**
 * Detects layer violations in a dependency graph given pre-computed layer assignments.
 *
 * Rules:
 * - `backward`: source layer > target layer (higher-level importing lower-level is fine,
 *   but lower-level importing higher-level is a backward violation).
 * - `skip-layer`: gap between source and target layers is ≥ SKIP_THRESHOLD.
 * - Files with layer 0 (utility/config) are exempt from all violations.
 * - Files with layer -1 (unknown) are skipped — not enough information to report.
 * - Same-layer edges (including intra-SCC cycles) are not violations.
 */
export function detectViolations(
    edges: ImportEdge[],
    layers: Map<string, number>,
): LayerViolation[] {
    const violations: LayerViolation[] = [];

    for (const edge of edges) {
        const srcLayer = layers.get(edge.source);
        const tgtLayer = layers.get(edge.target);

        // Unknown layer → skip
        if (srcLayer === undefined || tgtLayer === undefined) continue;
        // Unknown (-1) → skip
        if (srcLayer === -1 || tgtLayer === -1) continue;
        // Utility/config (layer 0) → exempt
        if (srcLayer === 0 || tgtLayer === 0) continue;
        // Same layer (also catches intra-SCC) → not a violation
        if (srcLayer === tgtLayer) continue;

        const gap = tgtLayer - srcLayer;

        if (gap < 0) {
            // Target is at a lower layer number (closer to entry) than source → backward
            violations.push({
                sourceFile: edge.source,
                targetFile: edge.target,
                sourceLayer: String(srcLayer),
                targetLayer: String(tgtLayer),
                direction: 'backward',
            });
        } else if (gap >= SKIP_THRESHOLD && srcLayer !== -2) {
            // Only flag skip-layer if source is NOT a test file (Layer -2)
            violations.push({
                sourceFile: edge.source,
                targetFile: edge.target,
                sourceLayer: String(srcLayer),
                targetLayer: String(tgtLayer),
                direction: 'skip-layer',
            });
        }
    }

    return violations;
}
