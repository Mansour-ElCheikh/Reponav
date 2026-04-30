/**
 * Tests for sigmaEdgeRenderers — pure graphology edge utilities (T24-T29)
 * T24: sigmaEdgeRenderers exports at least one function, SigmaGraph.tsx ≤ 400 lines
 * T27: addCouplingEdges accepts CouplingEdge shape (type safety)
 * T28: coupling edges have dashed type and gray color
 * T29: getCouplingEdgeReducerState hides coupling edges when toggle is off
 */
import { describe, it, expect } from 'vitest';
import Graph from 'graphology';
import {
    addImportEdges,
    addCouplingEdges,
    addFlowEdges,
    buildVisibleFlowPairKeys,
    buildAdjacencyMaps,
    getCouplingEdgeReducerState,
    getFlowEdgeReducerState,
    resolveFlowNodeId,
    shouldSuppressImportEdgeForFlowPair,
    CO_CHANGE_EDGE_COLOR,
    FLOW_COLOR,
} from './sigmaEdgeRenderers';

// ─── T24 — exports exist ──────────────────────────────────────────────────────

describe('sigmaEdgeRenderers — T24: module exports', () => {
    it.each<readonly [string, unknown, string]>([
        ['addImportEdges', addImportEdges, 'function'],
        ['addCouplingEdges', addCouplingEdges, 'function'],
        ['buildAdjacencyMaps', buildAdjacencyMaps, 'function'],
        ['CO_CHANGE_EDGE_COLOR', CO_CHANGE_EDGE_COLOR, 'string'],
    ])('exports %s as a %s', (_name, value, expectedType) => {
        expect(typeof value).toBe(expectedType);
    });
});

// ─── addImportEdges ───────────────────────────────────────────────────────────

describe('sigmaEdgeRenderers — addImportEdges', () => {
    it('adds edges from edge list where both endpoints exist', () => {
        const g = new Graph({ multi: false, type: 'directed' });
        g.addNode('src/a.ts');
        g.addNode('src/b.ts');
        const nodeSet = new Set(['src/a.ts', 'src/b.ts']);

        addImportEdges(g, [{ source: 'src/a.ts', target: 'src/b.ts' }], nodeSet);

        expect(g.hasEdge('src/a.ts→src/b.ts')).toBe(true);
    });

    it('skips edges where source is missing from nodeSet', () => {
        const g = new Graph({ multi: false, type: 'directed' });
        g.addNode('src/b.ts');
        const nodeSet = new Set(['src/b.ts']);

        addImportEdges(g, [{ source: 'src/missing.ts', target: 'src/b.ts' }], nodeSet);

        expect(g.edges().length).toBe(0);
    });

    it('sets isCircular attribute on circular edges', () => {
        const g = new Graph({ multi: false, type: 'directed' });
        g.addNode('a'); g.addNode('b');
        const nodeSet = new Set(['a', 'b']);

        addImportEdges(g, [{ source: 'a', target: 'b', isCircular: true }], nodeSet);

        const attrs = g.getEdgeAttributes('a→b');
        expect(attrs['isCircular']).toBe(true);
        expect(attrs['size']).toBeGreaterThan(1.5); // circular edges are thicker
    });
});

// ─── buildAdjacencyMaps ───────────────────────────────────────────────────────

describe('sigmaEdgeRenderers — buildAdjacencyMaps', () => {
    it('builds upstream and downstream maps from edges', () => {
        const edges = [
            { source: 'a', target: 'b' },
            { source: 'a', target: 'c' },
            { source: 'b', target: 'c' },
        ];
        const { upstreamMap, downstreamMap } = buildAdjacencyMaps(edges);

        // b is downstream of a
        expect(downstreamMap.get('a')?.has('b')).toBe(true);
        expect(downstreamMap.get('a')?.has('c')).toBe(true);
        // a is upstream of b
        expect(upstreamMap.get('b')?.has('a')).toBe(true);
        expect(upstreamMap.get('c')?.has('a')).toBe(true);
        expect(upstreamMap.get('c')?.has('b')).toBe(true);
    });

    it('returns empty maps for empty edge list', () => {
        const { upstreamMap, downstreamMap } = buildAdjacencyMaps([]);
        expect(upstreamMap.size).toBe(0);
        expect(downstreamMap.size).toBe(0);
    });
});

// ─── T27, T28 — addCouplingEdges ─────────────────────────────────────────────

describe('sigmaEdgeRenderers — T27/T28: addCouplingEdges', () => {
    it('T27: accepts CouplingEdge shape and adds edges to graph', () => {
        const g = new Graph({ multi: false, type: 'directed' });
        g.addNode('src/a.ts');
        g.addNode('src/b.ts');
        const nodeSet = new Set(['src/a.ts', 'src/b.ts']);

        // T27: TypeScript would catch shape mismatches — runtime check
        addCouplingEdges(g, [{ fileA: 'src/a.ts', fileB: 'src/b.ts' }], nodeSet);

        expect(g.edges().length).toBe(1);
    });

    it('T28: coupling edges have CO_CHANGE_EDGE_COLOR and isCoupling=true', () => {
        const g = new Graph({ multi: false, type: 'directed' });
        g.addNode('a'); g.addNode('b');
        const nodeSet = new Set(['a', 'b']);

        addCouplingEdges(g, [{ fileA: 'a', fileB: 'b' }], nodeSet);

        const edgeKey = g.edges()[0];
        const attrs = g.getEdgeAttributes(edgeKey);
        expect(attrs['color']).toBe(CO_CHANGE_EDGE_COLOR);
        expect(attrs['isCoupling']).toBe(true);
        expect(attrs['type']).toBe('dashed');
        expect(attrs['zIndex']).toBe(-1);
    });

    it('skips coupling edges where a node is not in nodeSet', () => {
        const g = new Graph({ multi: false, type: 'directed' });
        g.addNode('a');
        const nodeSet = new Set(['a']); // b missing

        addCouplingEdges(g, [{ fileA: 'a', fileB: 'missing' }], nodeSet);

        expect(g.edges().length).toBe(0);
    });

    it('projects grouped coupling edges onto visible cluster nodes', () => {
        const g = new Graph({ multi: false, type: 'directed' });
        g.addNode('cluster::src');
        g.addNode('lib/c.ts');
        const nodeSet = new Set(['cluster::src', 'lib/c.ts']);
        const fileToDisplayNode = new Map([
            ['src/a.ts', 'cluster::src'],
            ['src/b.ts', 'cluster::src'],
            ['lib/c.ts', 'lib/c.ts'],
        ]);

        addCouplingEdges(g, [{ fileA: 'src/a.ts', fileB: 'lib/c.ts' }], nodeSet, fileToDisplayNode);

        expect(g.edges()).toHaveLength(1);
        const edgeKey = g.edges()[0];
        expect(g.source(edgeKey)).toBe('cluster::src');
        expect(g.target(edgeKey)).toBe('lib/c.ts');
    });

    it('drops grouped coupling self-loops created by collapsed directories', () => {
        const g = new Graph({ multi: false, type: 'directed' });
        g.addNode('cluster::src');
        const nodeSet = new Set(['cluster::src']);
        const fileToDisplayNode = new Map([
            ['src/a.ts', 'cluster::src'],
            ['src/b.ts', 'cluster::src'],
        ]);

        addCouplingEdges(g, [{ fileA: 'src/a.ts', fileB: 'src/b.ts' }], nodeSet, fileToDisplayNode);

        expect(g.edges()).toHaveLength(0);
    });
});

// ─── T29 — getCouplingEdgeReducerState ────────────────────────────────────────

describe('sigmaEdgeRenderers — T29: getCouplingEdgeReducerState', () => {
    it('returns null for non-coupling edges (does not affect them)', () => {
        const result = getCouplingEdgeReducerState({ isCoupling: false }, false);
        expect(result).toBeNull();
    });

    it('returns { hidden: true } for coupling edge when showCoupling=false', () => {
        const result = getCouplingEdgeReducerState({ isCoupling: true }, false);
        expect(result).toEqual({ hidden: true });
    });

    it('returns { zIndex: -1 } for coupling edge when showCoupling=true and no selection', () => {
        const result = getCouplingEdgeReducerState({ isCoupling: true }, true);
        expect(result).toEqual({ zIndex: -1 });
    });

    it('hides coupling edge when selected node is not an endpoint', () => {
        const result = getCouplingEdgeReducerState({ isCoupling: true }, true, 'c', 'a', 'b');
        expect(result).toEqual({ hidden: true });
    });

    it('shows coupling edge when selected node is an endpoint', () => {
        const result = getCouplingEdgeReducerState({ isCoupling: true }, true, 'a', 'a', 'b');
        expect(result).toEqual({ zIndex: -1 });
    });
});

describe('sigmaEdgeRenderers — import suppression for visible flow pairs', () => {
    it('builds visible flow pair keys from normalized file paths', () => {
        const nodeSet = new Set(['src/controllers/user.ts', 'src/services/user.ts']);
        const flowPairs = buildVisibleFlowPairKeys(
            [{
                entryPoint: 'src/controllers/user.ts',
                steps: [
                    { filePath: './src/controllers/user.ts' },
                    { filePath: 'src\\services\\user.ts' },
                ],
                anomalies: [],
            }],
            nodeSet,
        );

        expect(flowPairs).toEqual(new Set(['src/controllers/user.ts→src/services/user.ts']));
    });

    it('projects grouped flows to visible nodes and drops collapsed self-hops', () => {
        const nodeSet = new Set(['cluster::src', 'lib/c.ts']);
        const fileToDisplayNode = new Map([
            ['src/a.ts', 'cluster::src'],
            ['src/b.ts', 'cluster::src'],
            ['lib/c.ts', 'lib/c.ts'],
        ]);
        const flowPairs = buildVisibleFlowPairKeys(
            [{
                entryPoint: 'src/a.ts',
                steps: [
                    { filePath: 'src/a.ts' },
                    { filePath: 'src/b.ts' },
                    { filePath: 'lib/c.ts' },
                ],
                anomalies: [],
            }],
            nodeSet,
            fileToDisplayNode,
        );

        expect(flowPairs).toEqual(new Set(['cluster::src→lib/c.ts']));
    });

    it('suppresses import edge when flow edge exists for same source→target and flow toggle is on', () => {
        const flowPairs = new Set(['a.ts→b.ts']);
        expect(shouldSuppressImportEdgeForFlowPair({ isFlowEdge: false, isCoupling: false }, 'a.ts', 'b.ts', true, flowPairs)).toBe(true);
    });

    it('does not suppress non-import edge types', () => {
        const flowPairs = new Set(['a.ts→b.ts']);
        expect(shouldSuppressImportEdgeForFlowPair({ isFlowEdge: true }, 'a.ts', 'b.ts', true, flowPairs)).toBe(false);
        expect(shouldSuppressImportEdgeForFlowPair({ isCoupling: true }, 'a.ts', 'b.ts', true, flowPairs)).toBe(false);
    });

    it('does not suppress when flow toggle is off or no pair match exists', () => {
        const flowPairs = new Set(['a.ts→b.ts']);
        expect(shouldSuppressImportEdgeForFlowPair({ isFlowEdge: false, isCoupling: false }, 'a.ts', 'b.ts', false, flowPairs)).toBe(false);
        expect(shouldSuppressImportEdgeForFlowPair({ isFlowEdge: false, isCoupling: false }, 'x.ts', 'y.ts', true, flowPairs)).toBe(false);
    });
});

describe('sigmaEdgeRenderers — resolveFlowNodeId', () => {
    it('resolves direct normalized matches', () => {
        const map = new Map<string, string>([['src/a.ts', 'src/a.ts']]);
        expect(resolveFlowNodeId('./src/a.ts', map)).toBe('src/a.ts');
        expect(resolveFlowNodeId('src\\a.ts', map)).toBe('src/a.ts');
    });

    it('resolves absolute paths by unique suffix match', () => {
        const map = new Map<string, string>([
            ['src/controllers/user.ts', 'src/controllers/user.ts'],
            ['src/services/user.ts', 'src/services/user.ts'],
        ]);
        expect(resolveFlowNodeId('/Users/me/repo/src/controllers/user.ts', map)).toBe('src/controllers/user.ts');
    });

    it('returns undefined for ambiguous suffix matches', () => {
        const map = new Map<string, string>([
            ['src/a.ts', 'src/a.ts'],
            ['other/a.ts', 'other/a.ts'],
        ]);
        expect(resolveFlowNodeId('/tmp/a.ts', map)).toBeUndefined();
    });

    it('prefers grouped display-node mappings over raw node ids', () => {
        const nodeMap = new Map<string, string>([['cluster::src', 'cluster::src']]);
        const displayMap = new Map<string, string>([['src/a.ts', 'cluster::src']]);
        expect(resolveFlowNodeId('src/a.ts', nodeMap, displayMap)).toBe('cluster::src');
    });
});

// ─── T29-T31 (epic-007 C004): flow edge rendering ────────────────────────────

describe('sigmaEdgeRenderers — T29: addFlowEdges edge color', () => {
    it('flow edge between consecutive steps has FLOW_COLOR and isFlowEdge flag', () => {
        const g = new Graph({ multi: false, type: 'directed' });
        g.addNode('ctrl.ts'); g.addNode('svc.ts');
        const nodeSet = new Set(['ctrl.ts', 'svc.ts']);
        const flows = [{ entryPoint: 'ctrl.ts', steps: [{ filePath: 'ctrl.ts' }, { filePath: 'svc.ts' }], anomalies: [] }];

        addFlowEdges(g, flows, nodeSet);

        const edgeKey = g.edges()[0];
        const attrs = g.getEdgeAttributes(edgeKey);
        expect(attrs['color']).toBe(FLOW_COLOR);
        expect(attrs['isFlowEdge']).toBe(true);
    });
});

describe('sigmaEdgeRenderers — T30: addFlowEdges anomaly edges use FLOW_COLOR', () => {
    it('anomaly flow edge uses FLOW_COLOR (orange deferred — multi:true revealed noise)', () => {
        const g = new Graph({ multi: false, type: 'directed' });
        g.addNode('ctrl.ts'); g.addNode('repo.ts');
        const nodeSet = new Set(['ctrl.ts', 'repo.ts']);
        const flows = [{
            entryPoint: 'ctrl.ts',
            steps: [{ filePath: 'ctrl.ts' }, { filePath: 'repo.ts' }],
            anomalies: [{ fromFile: 'ctrl.ts', toFile: 'repo.ts' }],
        }];

        addFlowEdges(g, flows, nodeSet);

        const edgeKey = g.edges()[0];
        const attrs = g.getEdgeAttributes(edgeKey);
        expect(attrs['color']).toBe(FLOW_COLOR);
    });

    it('silently skips step files absent from nodeSet', () => {
        const g = new Graph({ multi: false, type: 'directed' });
        g.addNode('ctrl.ts');
        const nodeSet = new Set(['ctrl.ts']); // svc.ts missing
        const flows = [{ entryPoint: 'ctrl.ts', steps: [{ filePath: 'ctrl.ts' }, { filePath: 'svc.ts' }], anomalies: [] }];

        addFlowEdges(g, flows, nodeSet);

        expect(g.edges().length).toBe(0);
    });

    it('matches flow steps to nodes when step paths use ./ prefix or backslashes', () => {
        const g = new Graph({ multi: false, type: 'directed' });
        g.addNode('src/controllers/user.ts');
        g.addNode('src/services/user.ts');
        const nodeSet = new Set(['src/controllers/user.ts', 'src/services/user.ts']);
        const flows = [{
            entryPoint: 'src/controllers/user.ts',
            steps: [
                { filePath: './src/controllers/user.ts' },
                { filePath: 'src\\services\\user.ts' },
            ],
            anomalies: [],
        }];

        addFlowEdges(g, flows, nodeSet);

        expect(g.edges().length).toBe(1);
        const edgeKey = g.edges()[0];
        expect(g.source(edgeKey)).toBe('src/controllers/user.ts');
        expect(g.target(edgeKey)).toBe('src/services/user.ts');
    });

    it('matches absolute flow paths to relative node ids when suffix is unique', () => {
        const g = new Graph({ multi: false, type: 'directed' });
        g.addNode('src/controllers/user.ts');
        g.addNode('src/services/user.ts');
        const nodeSet = new Set(['src/controllers/user.ts', 'src/services/user.ts']);
        const flows = [{
            entryPoint: 'src/controllers/user.ts',
            steps: [
                { filePath: '/Users/me/repo/src/controllers/user.ts' },
                { filePath: '/Users/me/repo/src/services/user.ts' },
            ],
            anomalies: [],
        }];

        addFlowEdges(g, flows, nodeSet);

        expect(g.edges().length).toBe(1);
        const edgeKey = g.edges()[0];
        expect(g.source(edgeKey)).toBe('src/controllers/user.ts');
        expect(g.target(edgeKey)).toBe('src/services/user.ts');
    });

    it('projects grouped flow steps onto visible cluster nodes and drops collapsed self-hops', () => {
        const g = new Graph({ multi: false, type: 'directed' });
        g.addNode('cluster::src');
        g.addNode('lib/c.ts');
        const nodeSet = new Set(['cluster::src', 'lib/c.ts']);
        const fileToDisplayNode = new Map([
            ['src/a.ts', 'cluster::src'],
            ['src/b.ts', 'cluster::src'],
            ['lib/c.ts', 'lib/c.ts'],
        ]);
        const flows = [{
            entryPoint: 'src/a.ts',
            steps: [
                { filePath: 'src/a.ts' },
                { filePath: 'src/b.ts' },
                { filePath: 'lib/c.ts' },
            ],
            anomalies: [],
        }];

        addFlowEdges(g, flows, nodeSet, fileToDisplayNode);

        expect(g.edges()).toHaveLength(1);
        const edgeKey = g.edges()[0];
        expect(g.source(edgeKey)).toBe('cluster::src');
        expect(g.target(edgeKey)).toBe('lib/c.ts');
    });
});

describe('sigmaEdgeRenderers — T31: getFlowEdgeReducerState', () => {
    it('returns null for non-flow edges', () => {
        expect(getFlowEdgeReducerState({ isFlowEdge: false }, false)).toBeNull();
        expect(getFlowEdgeReducerState({}, true)).toBeNull();
    });

    it('returns { hidden: true } for flow edge when toggle is off', () => {
        expect(getFlowEdgeReducerState({ isFlowEdge: true }, false)).toEqual({ hidden: true });
    });

    it('returns { zIndex: 2 } for flow edge when toggle is on and no selection', () => {
        expect(getFlowEdgeReducerState({ isFlowEdge: true }, true)).toEqual({ zIndex: 2 });
    });

    it('hides flow edge when selected node is not an endpoint', () => {
        expect(getFlowEdgeReducerState({ isFlowEdge: true }, true, 'c', 'a', 'b')).toEqual({ hidden: true });
    });

    it('shows flow edge when selected node is source', () => {
        expect(getFlowEdgeReducerState({ isFlowEdge: true }, true, 'a', 'a', 'b')).toEqual({ zIndex: 2 });
    });

    it('keeps canvas flow edge visible so overlay failure cannot hide the flow signal', () => {
        expect(getFlowEdgeReducerState({ isFlowEdge: true }, true, null, 'a', 'b')).toEqual({ zIndex: 2 });
    });
});
