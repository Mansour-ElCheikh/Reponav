import * as path from 'path';
import type { EntrySurface, FileCategory, FileClassification } from '../types';
import { inferEntrySurface } from './entrySurface';
import type { CondensationDag } from './layerDag';

// ─── Types ────────────────────────────────────────────────────────────────

/** One hop in a flow trace — a single file visited during the DFS. */
export interface FlowStep {
    filePath: string;
    fileCategory: FileCategory;
    layer: number;
    symbolName?: string;
}

/** An edge in the flow trace that violates the expected layer ordering. */
export interface FlowAnomaly {
    fromFile: string;
    toFile: string;
    direction: 'backward' | 'skip-layer';
}

/** A traced execution sequence from an entry point to a terminal node. */
export interface FlowSequence {
    id: string;
    entryPoint: string;
    entrySurface?: EntrySurface;
    steps: FlowStep[];
    anomalies: FlowAnomaly[];
    /** Set when DFS hit the depth cap of MAX_DEPTH. */
    depthCapped?: boolean;
}

// ─── Constants ────────────────────────────────────────────────────────────

// Categories that anchor a flow trace (outermost layer of an app call path).
const FLOW_ENTRY_CATEGORIES = new Set<string>(['entry', 'route', 'controller']);

const FLOW_EXCLUDED_EXTENSIONS = new Set(['.md', '.json', '.yaml', '.yml', '.toml']);

const MODEL_TERMINAL_LAYER = 4;
const PERSISTENCE_TERMINAL_LAYER = 5;

// Layer numbers at which we stop recursing (leaf nodes in the layer model).
const TERMINAL_LAYERS = new Set<number>([MODEL_TERMINAL_LAYER, PERSISTENCE_TERMINAL_LAYER]);

// Minimum layer gap to classify a forward edge as a skip-layer violation in a flow trace.
// Uses 3 (not 2) because service → persistence (gap=2) is a common valid pattern;
// only a 3+ gap (e.g. controller → persistence directly) is anomalous.
const SKIP_THRESHOLD = 3;

// Maximum DFS depth to prevent runaway traversal on pathological graphs.
const MAX_DEPTH = 20;

// ─── Public API ───────────────────────────────────────────────────────────

/**
 * Returns the file paths of all files whose category marks them as flow entry points
 * (entry, route, controller). These are the starting nodes for flow traces.
 */
export function findEntryPoints(classifications: FileClassification[]): string[] {
    return classifications
    .filter(c => FLOW_ENTRY_CATEGORIES.has(c.category))
    .filter(c => !FLOW_EXCLUDED_EXTENSIONS.has(path.extname(c.path).toLowerCase()))
        .map(c => c.path);
}

/**
 * Traces a single flow sequence starting from `entryPoint` through the condensation DAG.
 * Follows forward-direction edges in layer order, stopping at terminal layer nodes.
 * Records FlowAnomaly entries for backward or skip-layer edges encountered during traversal.
 */
export function traceFlow(
    entryPoint: string,
    dag: CondensationDag,
    layers: Map<string, number>,
    categories?: Map<string, FileCategory>,
): FlowSequence {
    // Build node → component index lookup
    const nodeToComp = new Map<string, number>();
    for (let i = 0; i < dag.components.length; i++) {
        for (const n of dag.components[i]) nodeToComp.set(n, i);
    }

    // Build adjacency list: component index → reachable component indices
    const adj = new Map<number, number[]>();
    for (const e of dag.dagEdges) {
        if (!adj.has(e.from)) adj.set(e.from, []);
        adj.get(e.from)!.push(e.to);
    }

    // Derive a representative layer for a component (min positive layer among its files).
    const compLayer = (idx: number): number => {
        const positiveLayers = dag.components[idx]
            .map(f => layers.get(f) ?? -1)
            .filter(l => l > 0);
        if (positiveLayers.length === 0) return layers.get(dag.components[idx][0]) ?? -1;
        return Math.min(...positiveLayers);
    };

    const startComp = nodeToComp.get(entryPoint);
    if (startComp === undefined) {
        return {
            id: entryPoint,
            entryPoint,
            entrySurface: inferEntrySurface(entryPoint),
            steps: [],
            anomalies: [],
        };
    }

    const steps: FlowStep[] = [];
    const anomalies: FlowAnomaly[] = [];
    let depthCapped = false;
    const visited = new Set<number>();

    // DFS through the condensation DAG.
    const dfs = (compIdx: number, depth: number): void => {
        if (depth >= MAX_DEPTH) { depthCapped = true; return; }
        if (visited.has(compIdx)) return;
        visited.add(compIdx);

        const lay = compLayer(compIdx);
        // Flatten SCC component into per-file steps.
        for (const file of dag.components[compIdx]) {
            steps.push({
                filePath: file,
                fileCategory: categories?.get(file) ?? 'unknown',
                layer: lay,
            });
        }

        // Terminal layer — record the step but do not follow outgoing edges.
        if (TERMINAL_LAYERS.has(lay)) return;

        for (const nextComp of (adj.get(compIdx) ?? [])) {
            const nextLay = compLayer(nextComp);
            const gap = nextLay - lay;
            // Representative file for each SCC (first file in component).
            const fromFile = dag.components[compIdx][0] ?? '';
            const toFile = dag.components[nextComp][0] ?? '';

            // Check for layer-ordering anomalies on every edge regardless of visit state.
            if (gap < 0) {
                anomalies.push({ fromFile, toFile, direction: 'backward' });
            } else if (gap >= SKIP_THRESHOLD) {
                anomalies.push({ fromFile, toFile, direction: 'skip-layer' });
            }

            if (!visited.has(nextComp)) {
                dfs(nextComp, depth + 1);
            }
        }
    };

    dfs(startComp, 0);

    const result: FlowSequence = {
        id: entryPoint,
        entryPoint,
        entrySurface: inferEntrySurface(entryPoint),
        steps,
        anomalies,
    };
    if (depthCapped) result.depthCapped = true;
    return result;
}

/**
 * Merges FlowSequence objects that share the same entry point, deduplicating steps.
 * Sequences from different entry points remain separate.
 * This avoids N×M explosion when multiple traces visit the same shared service layer.
 */
export function mergeSequences(sequences: FlowSequence[]): FlowSequence[] {
    // Group by entry point
    const byEntry = new Map<string, FlowSequence[]>();
    for (const seq of sequences) {
        if (!byEntry.has(seq.entryPoint)) byEntry.set(seq.entryPoint, []);
        byEntry.get(seq.entryPoint)!.push(seq);
    }

    const result: FlowSequence[] = [];
    for (const group of byEntry.values()) {
        if (group.length === 1) { result.push(group[0]); continue; }

        // Merge all sequences from the same entry into one, deduplicating steps by filePath.
        const base = group[0];
        const seenFiles = new Set(base.steps.map(s => s.filePath));
        const mergedSteps = [...base.steps];
        const mergedAnomalies = [...base.anomalies];
        let depthCapped = base.depthCapped ?? false;

        for (const seq of group.slice(1)) {
            depthCapped = depthCapped || (seq.depthCapped ?? false);
            for (const step of seq.steps) {
                if (!seenFiles.has(step.filePath)) {
                    mergedSteps.push(step);
                    seenFiles.add(step.filePath);
                }
            }
            mergedAnomalies.push(...seq.anomalies);
        }

        const merged: FlowSequence = {
            id: base.id,
            entryPoint: base.entryPoint,
            entrySurface: base.entrySurface,
            steps: mergedSteps,
            anomalies: mergedAnomalies,
        };
        if (depthCapped) merged.depthCapped = true;
        result.push(merged);
    }
    return result;
}

/**
 * Top-level flow detection: finds all entry points from file classifications,
 * traces a FlowSequence from each through the condensation DAG, then merges
 * sequences sharing the same entry point. Returns empty array when no entry points exist.
 */
export function detectFlows(
    classifications: FileClassification[],
    dag: CondensationDag,
    layers: Map<string, number>,
): FlowSequence[] {
    const entryPaths = preferRuntimeAnchors(findEntryPoints(classifications));
    if (entryPaths.length === 0) return [];
    const categoryMap = new Map<string, FileCategory>(
        classifications.map(c => [c.path, c.category])
    );
    const sequences = entryPaths.map(ep => traceFlow(ep, dag, layers, categoryMap));
    return mergeSequences(sequences);
}

// When both runtime and tooling launch surfaces exist, anchor shared flow output on runtime paths.
function preferRuntimeAnchors(entryPaths: string[]): string[] {
    const runtimePaths = entryPaths.filter((entryPath) => inferEntrySurface(entryPath) === 'runtime');
    return runtimePaths.length > 0 ? runtimePaths : entryPaths;
}
