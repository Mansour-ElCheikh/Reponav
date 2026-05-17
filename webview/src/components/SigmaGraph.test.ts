/**
 * Tests for SigmaGraph pure helper functions.
 *
 * The WebGL renderer (Sigma) is not testable in Node, but the extracted
 * pure functions — color computation, clustering, edge coloring — are.
 */

import { describe, it, expect } from 'vitest';

import {
    hasCircularEdgesInTour,
    applyClientClustering,
} from './sigmaGraphHelpers';
import {
    BASE_EDGE_COLOR,
    CIRCULAR_COLOR,
    DIM_EDGE_COLOR,
    DOWNSTREAM_COLOR,
    NODE_COLORS,
    STEP_GLOW_COLOR,
    UPSTREAM_COLOR,
    buildEdgeReducerState,
    buildNodeReducerState,
    computeSelectionSets,
    edgeColorFor,
    nodeColorFor,
    nodeVisualsFor,
} from './sigmaRenderPolicy';
import type { Tour } from '../types';

// ─── nodeColorFor ─────────────────────────────────────────────────────────────

describe('nodeColorFor', () => {
    const empty = new Set<string>();

    it('returns category color when no selection is active', () => {
        const color = nodeColorFor('src/app.ts', 'service', null, empty, empty, empty);
        expect(color).toBe(NODE_COLORS.service);
    });

    it('returns category color for the selected node itself', () => {
        const color = nodeColorFor('src/app.ts', 'entry', 'src/app.ts', empty, empty, empty);
        expect(color).toBe(NODE_COLORS.entry);
    });

    it('returns UPSTREAM_COLOR for upstream nodes', () => {
        const upstream = new Set(['src/dep.ts']);
        const color = nodeColorFor('src/dep.ts', 'utility', 'src/app.ts', upstream, empty, empty);
        expect(color).toBe(UPSTREAM_COLOR);
    });

    it('returns DOWNSTREAM_COLOR for downstream nodes', () => {
        const downstream = new Set(['src/child.ts']);
        const color = nodeColorFor('src/child.ts', 'model', 'src/app.ts', empty, downstream, empty);
        expect(color).toBe(DOWNSTREAM_COLOR);
    });

    it('dims unrelated nodes when selection is active', () => {
        const color = nodeColorFor('src/other.ts', 'config', 'src/app.ts', empty, empty, empty);
        expect(color).toMatch(/44$/); // ends with 44 = dimmed
    });

    it('does not dim step-active nodes even when selection is active', () => {
        const stepFiles = new Set(['src/step.ts']);
        const color = nodeColorFor('src/step.ts', 'route', 'src/app.ts', empty, empty, stepFiles);
        expect(color).toBe(NODE_COLORS.route); // full opacity, not dimmed
    });

    it('returns full category color for step-active nodes with no selection', () => {
        const stepFiles = new Set(['src/step.ts']);
        const color = nodeColorFor('src/step.ts', 'component', null, empty, empty, stepFiles);
        expect(color).toBe(NODE_COLORS.component);
    });
});

// ─── nodeVisualsFor ───────────────────────────────────────────────────────────

describe('nodeVisualsFor', () => {
    const empty = new Set<string>();

    it('returns category fill with no border when no selection or step', () => {
        const v = nodeVisualsFor('a.ts', 'route', null, empty, empty, empty);
        expect(v.color).toBe(NODE_COLORS.route);
        expect(v.borderSize).toBe(0);
        expect(v.halo).toBe(false);
    });

    it('returns white border ring for selected node, fill stays category', () => {
        const v = nodeVisualsFor('a.ts', 'model', 'a.ts', empty, empty, empty);
        expect(v.color).toBe(NODE_COLORS.model);
        expect(v.borderColor).toBe('#ffffff');
        expect(v.borderSize).toBe(0.2);
    });

    it('returns green border ring for upstream, fill stays category', () => {
        const upstream = new Set(['dep.ts']);
        const v = nodeVisualsFor('dep.ts', 'utility', 'app.ts', upstream, empty, empty);
        expect(v.color).toBe(NODE_COLORS.utility); // NOT upstream green
        expect(v.borderColor).toBe(UPSTREAM_COLOR);
        expect(v.borderSize).toBe(0.15);
    });

    it('returns orange border ring for downstream, fill stays category', () => {
        const downstream = new Set(['child.ts']);
        const v = nodeVisualsFor('child.ts', 'service', 'app.ts', empty, downstream, empty);
        expect(v.color).toBe(NODE_COLORS.service); // NOT downstream orange
        expect(v.borderColor).toBe(DOWNSTREAM_COLOR);
        expect(v.borderSize).toBe(0.15);
    });

    it('returns circular border ring when node is in circularNodes set', () => {
        const circular = new Set(['node.ts']);
        const v = nodeVisualsFor('node.ts', 'service', 'app.ts', empty, empty, empty, circular);
        expect(v.color).toBe(NODE_COLORS.service); // fill stays category
        expect(v.borderColor).toBe(CIRCULAR_COLOR);
        expect(v.borderSize).toBe(0.15);
    });

    it('circular node is NOT dimmed even though it is not in upstream/downstream', () => {
        const circular = new Set(['node.ts']);
        const v = nodeVisualsFor('node.ts', 'service', 'app.ts', empty, empty, empty, circular);
        expect(v.color).not.toMatch(/44$/); // not dimmed
    });

    it('dims unrelated nodes when selection is active', () => {
        const v = nodeVisualsFor('other.ts', 'config', 'app.ts', empty, empty, empty);
        expect(v.color).toMatch(/44$/);
        expect(v.borderSize).toBe(0);
    });

    it('returns halo=true and white border for step-active nodes (no structural selection)', () => {
        const stepFiles = new Set(['step.ts']);
        const v = nodeVisualsFor('step.ts', 'route', null, empty, empty, stepFiles);
        expect(v.halo).toBe(true);
        expect(v.borderColor).toBe(STEP_GLOW_COLOR);
        expect(v.borderSize).toBe(0.1);
        expect(v.color).toBe(NODE_COLORS.route); // not dimmed
    });

    it('preserves structural ring but adds halo when node is both upstream and step-active', () => {
        const upstream = new Set(['dep.ts']);
        const stepFiles = new Set(['dep.ts']);
        const v = nodeVisualsFor('dep.ts', 'utility', 'app.ts', upstream, empty, stepFiles);
        expect(v.halo).toBe(true);
        expect(v.borderColor).toBe(UPSTREAM_COLOR); // structural ring wins
        expect(v.borderSize).toBe(0.15);
    });

    it('does not dim step-active nodes even with active selection', () => {
        const stepFiles = new Set(['step.ts']);
        const v = nodeVisualsFor('step.ts', 'route', 'other.ts', empty, empty, stepFiles);
        expect(v.color).toBe(NODE_COLORS.route); // not dimmed
        expect(v.halo).toBe(true);
    });
});

// ─── edgeColorFor ─────────────────────────────────────────────────────────────

describe('edgeColorFor', () => {
    it('returns BASE_EDGE_COLOR for circular edges in default state (no red by default)', () => {
        const { color, size } = edgeColorFor('a.ts', 'b.ts', true, null);
        expect(color).toBe(BASE_EDGE_COLOR);
        expect(size).toBe(1.5);
    });

    it('circular connected edge (target=selected) gets CIRCULAR_COLOR — red wins over direction to avoid overlap', () => {
        const { color, size } = edgeColorFor('dep.ts', 'selected.ts', true, 'selected.ts');
        expect(color).toBe(CIRCULAR_COLOR);
        expect(size).toBe(3);
    });

    it('circular connected edge (source=selected) gets CIRCULAR_COLOR — red wins over direction to avoid overlap', () => {
        const { color, size } = edgeColorFor('selected.ts', 'dep.ts', true, 'selected.ts');
        expect(color).toBe(CIRCULAR_COLOR);
        expect(size).toBe(3);
    });

    it('returns CIRCULAR_COLOR when showCircularOnly is true (filter mode)', () => {
        const { color, size } = edgeColorFor('a.ts', 'b.ts', true, null, true);
        expect(color).toBe(CIRCULAR_COLOR);
        expect(size).toBe(2.5);
    });

    it('showCircularOnly overrides selection directional coloring', () => {
        // When the circular filter is active, even selected-node edges paint red.
        const { color } = edgeColorFor('dep.ts', 'selected.ts', true, 'selected.ts', true);
        expect(color).toBe(CIRCULAR_COLOR);
    });

    it('returns UPSTREAM_COLOR when non-circular edge targets selected node', () => {
        const { color, size } = edgeColorFor('dep.ts', 'selected.ts', false, 'selected.ts');
        expect(color).toBe(UPSTREAM_COLOR);
        expect(size).toBe(3);
    });

    it('returns DOWNSTREAM_COLOR when non-circular edge sources from selected node', () => {
        const { color, size } = edgeColorFor('selected.ts', 'child.ts', false, 'selected.ts');
        expect(color).toBe(DOWNSTREAM_COLOR);
        expect(size).toBe(3);
    });

    it('returns DIM_EDGE_COLOR sentinel for unrelated edges when selection is active', () => {
        const { color, size } = edgeColorFor('a.ts', 'b.ts', false, 'selected.ts');
        expect(color).toBe(DIM_EDGE_COLOR); // sentinel — buildEdgeReducerState converts this to hidden:true
        expect(size).toBe(0.5);
    });

    it('returns BASE_EDGE_COLOR when no selection is active', () => {
        const { color, size } = edgeColorFor('a.ts', 'b.ts', false, null);
        expect(color).toBe(BASE_EDGE_COLOR);
        expect(size).toBe(1.5);
    });
});

// ─── applyClientClustering ────────────────────────────────────────────────────

describe('applyClientClustering', () => {
    const graph = {
        nodes: [
            { id: 'src/a.ts', label: 'a.ts', type: 'entry' as const },
            { id: 'src/b.ts', label: 'b.ts', type: 'service' as const },
            { id: 'lib/c.ts', label: 'c.ts', type: 'utility' as const },
        ],
        edges: [
            { source: 'src/a.ts', target: 'lib/c.ts', label: 'imports' },
            { source: 'src/a.ts', target: 'src/b.ts', label: 'imports' },
        ],
    };
    const emptyPositions = new Map<string, { x: number; y: number }>();

    it('collapses multi-file directories into cluster nodes', () => {
        const result = applyClientClustering(graph, new Set(), emptyPositions);
        const clusterNode = result.graph.nodes.find(n => n.id === 'cluster::src');
        expect(clusterNode).toBeDefined();
        expect(clusterNode!.isCluster).toBe(true);
        expect(clusterNode!.childCount).toBe(2);
    });

    it('keeps single-file directories as plain nodes', () => {
        const result = applyClientClustering(graph, new Set(), emptyPositions);
        const libNode = result.graph.nodes.find(n => n.id === 'lib/c.ts');
        expect(libNode).toBeDefined();
        expect(libNode!.isCluster).toBeUndefined();
    });

    it('drops intra-cluster edges', () => {
        const result = applyClientClustering(graph, new Set(), emptyPositions);
        // src/a.ts → src/b.ts becomes cluster::src → cluster::src = self-loop = dropped
        const selfLoops = result.graph.edges.filter(e => e.source === e.target);
        expect(selfLoops).toHaveLength(0);
    });

    it('preserves inter-cluster edges', () => {
        const result = applyClientClustering(graph, new Set(), emptyPositions);
        const crossEdge = result.graph.edges.find(e => e.source === 'cluster::src' && e.target === 'lib/c.ts');
        expect(crossEdge).toBeDefined();
    });

    it('expands cluster when in expandedClusters set', () => {
        const result = applyClientClustering(graph, new Set(['cluster::src']), emptyPositions);
        const srcNodes = result.graph.nodes.filter(n => n.id.startsWith('src/'));
        expect(srcNodes).toHaveLength(2); // individual files, not cluster
        expect(srcNodes.every(n => !n.isCluster)).toBe(true);
    });

    it('provides position hints for cluster nodes from child positions', () => {
        const positions = new Map([
            ['src/a.ts', { x: 100, y: 200 }],
            ['src/b.ts', { x: 300, y: 400 }],
        ]);
        const result = applyClientClustering(graph, new Set(), positions);
        const hint = result.positionHints.get('cluster::src');
        expect(hint).toBeDefined();
        expect(hint!.x).toBe(200); // centroid
        expect(hint!.y).toBe(300);
    });

    it('provides position hints for expanded children from cluster position', () => {
        const positions = new Map([
            ['cluster::src', { x: 150, y: 250 }],
        ]);
        const result = applyClientClustering(graph, new Set(['cluster::src']), positions);
        // Children that don't have their own saved position get hints from the cluster
        const hintA = result.positionHints.get('src/a.ts');
        const hintB = result.positionHints.get('src/b.ts');
        expect(hintA).toBeDefined();
        expect(hintB).toBeDefined();
        // Close to cluster position (with jitter)
        expect(Math.abs(hintA!.x - 150)).toBeLessThan(40);
        expect(Math.abs(hintA!.y - 250)).toBeLessThan(40);
    });
});

// ─── buildNodeReducerState ────────────────────────────────────────────────────

describe('buildNodeReducerState', () => {
    const empty = new Set<string>();
    const baseData = { color: NODE_COLORS.route, size: 10, nodeType: 'route', originalSize: 10, halo: false, borderColor: NODE_COLORS.route, borderSize: 0 };

    it('hides test nodes when showTestFiles is false', () => {
        const testData = { ...baseData, nodeType: 'test', color: NODE_COLORS.test };
        const result = buildNodeReducerState('test.ts', testData, { showTestFiles: false, showCircularOnly: false }, null, empty, empty, empty);
        expect(result.hidden).toBe(true);
    });

    it('shows test nodes when showTestFiles is true', () => {
        const testData = { ...baseData, nodeType: 'test', color: NODE_COLORS.test };
        const result = buildNodeReducerState('test.ts', testData, { showTestFiles: true, showCircularOnly: false }, null, empty, empty, empty);
        expect(result.hidden).not.toBe(true);
    });

    it('applies visuals (border ring) for upstream nodes', () => {
        const upstream = new Set(['dep.ts']);
        const result = buildNodeReducerState('dep.ts', baseData, { showTestFiles: true, showCircularOnly: false }, 'app.ts', upstream, empty, empty);
        expect(result.borderColor).toBe(UPSTREAM_COLOR);
        expect(result.borderSize).toBe(0.15);
        expect(result.color).toBe(NODE_COLORS.route); // fill stays category
    });

    it('applies glow for step-active nodes', () => {
        const stepFiles = new Set(['step.ts']);
        const result = buildNodeReducerState('step.ts', baseData, { showTestFiles: true, showCircularOnly: false }, null, empty, empty, stepFiles);
        expect(result.halo).toBe(true);
        expect(result.zIndex).toBe(1);
    });

    it('dims unrelated nodes when selection is active', () => {
        const result = buildNodeReducerState('other.ts', baseData, { showTestFiles: true, showCircularOnly: false }, 'selected.ts', empty, empty, empty);
        expect(result.color).toMatch(/44$/);
    });

    it('dims nodes that do not match the highlighted type', () => {
        const configData = { ...baseData, nodeType: 'config', color: NODE_COLORS.config ?? '#999' };
        const result = buildNodeReducerState('config.ts', configData, { showTestFiles: true, showCircularOnly: false }, null, empty, empty, empty, undefined, 'route');
        expect(result.color).toMatch(/33$/);
    });

    it('leaves matching nodes at full opacity and enlarges them when type is highlighted', () => {
        const result = buildNodeReducerState('route.ts', baseData, { showTestFiles: true, showCircularOnly: false }, null, empty, empty, empty, undefined, 'route');
        expect(result.color).not.toMatch(/33$/);
        expect(result.hidden).not.toBe(true);
        expect(result.size as number).toBeGreaterThan(baseData.size);
    });
});

// ─── buildEdgeReducerState ────────────────────────────────────────────────────

describe('buildEdgeReducerState', () => {
    const baseEdge = { color: BASE_EDGE_COLOR, size: 1.5, isCircular: false };

    it('hides non-circular edges when showCircularOnly is true', () => {
        const result = buildEdgeReducerState(baseEdge, 'a.ts', 'b.ts', { showTestFiles: true, showCircularOnly: true }, new Set(), null);
        expect(result.hidden).toBe(true);
    });

    it('shows circular edges when showCircularOnly is true', () => {
        const circEdge = { ...baseEdge, isCircular: true, color: CIRCULAR_COLOR };
        const result = buildEdgeReducerState(circEdge, 'a.ts', 'b.ts', { showTestFiles: true, showCircularOnly: true }, new Set(), null);
        expect(result.hidden).not.toBe(true);
    });

    it('hides edges touching hidden nodes', () => {
        const hiddenNodes = new Set(['a.ts']);
        const result = buildEdgeReducerState(baseEdge, 'a.ts', 'b.ts', { showTestFiles: true, showCircularOnly: false }, hiddenNodes, null);
        expect(result.hidden).toBe(true);
    });

    it('applies selection colors for upstream edge', () => {
        const result = buildEdgeReducerState(baseEdge, 'dep.ts', 'selected.ts', { showTestFiles: true, showCircularOnly: false }, new Set(), 'selected.ts');
        expect(result.color).toBe(UPSTREAM_COLOR);
        expect(result.size).toBe(3);
    });

    it('hides unrelated edges when selection active', () => {
        const result = buildEdgeReducerState(baseEdge, 'a.ts', 'b.ts', { showTestFiles: true, showCircularOnly: false }, new Set(), 'selected.ts');
        expect(result.hidden).toBe(true);
    });

    it('dims edges involving non-matching node types when type filter is active', () => {
        const nodeTypeMap = new Map([['a.ts', 'route'], ['b.ts', 'service']]);
        const result = buildEdgeReducerState(baseEdge, 'a.ts', 'b.ts', { showTestFiles: true, showCircularOnly: false }, new Set(), null, 'route', nodeTypeMap);
        expect(result.color).toMatch(/55$/);
        expect(result.size).toBe(0.5);
    });

    it('keeps full edge style when both endpoints match type filter', () => {
        const nodeTypeMap = new Map([['a.ts', 'route'], ['b.ts', 'route']]);
        const result = buildEdgeReducerState(baseEdge, 'a.ts', 'b.ts', { showTestFiles: true, showCircularOnly: false }, new Set(), null, 'route', nodeTypeMap);
        expect(result.color).not.toMatch(/55$/);
        expect(result.size).not.toBe(0.5);
    });
});

// ─── hasCircularEdgesInTour ────────────────────────────────────────────────

describe('hasCircularEdgesInTour', () => {
    function makeTour(circularCount: number, edgeIsCircular?: boolean): Tour {
        return {
            id: 't',
            query: 'q',
            tourType: 'overview',
            createdAt: new Date().toISOString(),
            steps: [],
            analysisSnapshot: {
                frameworks: [],
                entryPoints: [],
                totalFiles: 2,
                totalEdges: 1,
                circularCount,
            },
            graph: {
                nodes: [
                    { id: 'a.ts', label: 'a.ts', type: 'unknown' },
                    { id: 'b.ts', label: 'b.ts', type: 'unknown' },
                ],
                edges: [{ source: 'a.ts', target: 'b.ts', label: 'imports', isCircular: edgeIsCircular }],
            },
        };
    }

    it('returns true when analysisSnapshot.circularCount is positive', () => {
        expect(hasCircularEdgesInTour(makeTour(2, false))).toBe(true);
    });

    it('returns false when circularCount is zero and no edge is marked circular', () => {
        expect(hasCircularEdgesInTour(makeTour(0, false))).toBe(false);
    });

    it('falls back to edge flags when circularCount is stale zero', () => {
        expect(hasCircularEdgesInTour(makeTour(0, true))).toBe(true);
    });
});

// ─── computeSelectionSets ─────────────────────────────────────────────────────

describe('computeSelectionSets', () => {
    function makeUpDown(edges: Array<{ source: string; target: string }>) {
        const up = new Map<string, Set<string>>();
        const down = new Map<string, Set<string>>();
        for (const { source, target } of edges) {
            if (!down.has(source)) down.set(source, new Set());
            down.get(source)!.add(target);
            if (!up.has(target)) up.set(target, new Set());
            up.get(target)!.add(source);
        }
        return { upstreamMap: up, downstreamMap: down };
    }

    it('returns empty sets when selectedNodeId is null', () => {
        const { upstreamMap, downstreamMap } = makeUpDown([{ source: 'a.ts', target: 'x.ts' }]);
        const result = computeSelectionSets(upstreamMap, downstreamMap, null);
        expect(result.upstreamOnly.size).toBe(0);
        expect(result.downstreamOnly.size).toBe(0);
        expect(result.circular.size).toBe(0);
    });

    it('upstream-only: A→X and B→X → upstreamOnly={A,B}, others empty', () => {
        const { upstreamMap, downstreamMap } = makeUpDown([
            { source: 'A.ts', target: 'X.ts' },
            { source: 'B.ts', target: 'X.ts' },
        ]);
        const result = computeSelectionSets(upstreamMap, downstreamMap, 'X.ts');
        expect(result.upstreamOnly).toEqual(new Set(['A.ts', 'B.ts']));
        expect(result.downstreamOnly.size).toBe(0);
        expect(result.circular.size).toBe(0);
    });

    it('bidirectional: A→X and X→A → circular={A}, upstreamOnly and downstreamOnly empty', () => {
        const { upstreamMap, downstreamMap } = makeUpDown([
            { source: 'A.ts', target: 'X.ts' },
            { source: 'X.ts', target: 'A.ts' },
        ]);
        const result = computeSelectionSets(upstreamMap, downstreamMap, 'X.ts');
        expect(result.circular).toEqual(new Set(['A.ts']));
        expect(result.upstreamOnly.size).toBe(0);
        expect(result.downstreamOnly.size).toBe(0);
    });

    it('mixed: A→X (upstream), X→B (downstream), C↔X (circular)', () => {
        const { upstreamMap, downstreamMap } = makeUpDown([
            { source: 'A.ts', target: 'X.ts' },
            { source: 'X.ts', target: 'B.ts' },
            { source: 'C.ts', target: 'X.ts' },
            { source: 'X.ts', target: 'C.ts' },
        ]);
        const result = computeSelectionSets(upstreamMap, downstreamMap, 'X.ts');
        expect(result.upstreamOnly).toEqual(new Set(['A.ts']));
        expect(result.downstreamOnly).toEqual(new Set(['B.ts']));
        expect(result.circular).toEqual(new Set(['C.ts']));
    });

    it('sets are disjoint — union = raw upstream ∪ downstream', () => {
        const { upstreamMap, downstreamMap } = makeUpDown([
            { source: 'A.ts', target: 'X.ts' },
            { source: 'X.ts', target: 'B.ts' },
            { source: 'C.ts', target: 'X.ts' },
            { source: 'X.ts', target: 'C.ts' },
        ]);
        const result = computeSelectionSets(upstreamMap, downstreamMap, 'X.ts');
        const allSets = [...result.upstreamOnly, ...result.downstreamOnly, ...result.circular];
        const asSet = new Set(allSets);
        // No duplicates: array length should equal set size
        expect(allSets.length).toBe(asSet.size);
        // Union should cover all neighbors
        expect(asSet).toEqual(new Set(['A.ts', 'B.ts', 'C.ts']));
    });

    it('isolated node (no edges) → all sets empty', () => {
        const { upstreamMap, downstreamMap } = makeUpDown([]);
        const result = computeSelectionSets(upstreamMap, downstreamMap, 'X.ts');
        expect(result.upstreamOnly.size).toBe(0);
        expect(result.downstreamOnly.size).toBe(0);
        expect(result.circular.size).toBe(0);
    });

    // ─── circularNeighborMap path (Option B: card count = edge isCircular flag) ──

    it('3-node cycle A→B→C→A: selecting A classifies B and C as circular via circularNeighborMap', () => {
        // Direct edges: A→B (downstream), C→A (upstream) — NOT bidirectional, so old path gives circular={}
        const { upstreamMap, downstreamMap } = makeUpDown([
            { source: 'A.ts', target: 'B.ts' },
            { source: 'B.ts', target: 'C.ts' },
            { source: 'C.ts', target: 'A.ts' },
        ]);
        // circularNeighborMap: each node maps to both its isCircular source and target neighbors
        const circularNeighborMap = new Map([
            ['A.ts', new Set(['B.ts', 'C.ts'])],
            ['B.ts', new Set(['A.ts', 'C.ts'])],
            ['C.ts', new Set(['B.ts', 'A.ts'])],
        ]);
        const result = computeSelectionSets(upstreamMap, downstreamMap, 'A.ts', circularNeighborMap);
        expect(result.circular).toEqual(new Set(['B.ts', 'C.ts']));
        expect(result.upstreamOnly.size).toBe(0); // C moved to circular
        expect(result.downstreamOnly.size).toBe(0); // B moved to circular
    });

    it('mixed: non-circular upstream + 3-node cycle participants are classified correctly', () => {
        // D→X (pure upstream, not circular), X→B→C→X is the cycle
        const { upstreamMap, downstreamMap } = makeUpDown([
            { source: 'D.ts', target: 'X.ts' }, // pure upstream
            { source: 'X.ts', target: 'B.ts' }, // cycle
            { source: 'B.ts', target: 'C.ts' }, // cycle
            { source: 'C.ts', target: 'X.ts' }, // cycle
        ]);
        const circularNeighborMap = new Map([
            ['X.ts', new Set(['B.ts', 'C.ts'])],
            ['B.ts', new Set(['X.ts', 'C.ts'])],
            ['C.ts', new Set(['B.ts', 'X.ts'])],
            // D.ts has no circular edges
        ]);
        const result = computeSelectionSets(upstreamMap, downstreamMap, 'X.ts', circularNeighborMap);
        expect(result.upstreamOnly).toEqual(new Set(['D.ts'])); // D not in circularNeighborMap
        expect(result.circular).toEqual(new Set(['B.ts', 'C.ts'])); // cycle members
        expect(result.downstreamOnly.size).toBe(0); // B moved to circular
    });
});
