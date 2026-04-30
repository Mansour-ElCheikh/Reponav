import { describe, it, expect } from 'vitest';
import Graph from 'graphology';
import { applyGroupingLayout } from './sigmaGroupingLayout';
import type { GraphData } from '../types';

function makeBaseGraph(nodes: string[], edges: { source: string; target: string }[] = []): GraphData {
    return {
        nodes: nodes.map((id) => ({ id, label: id, type: 'module', weight: 1 })),
        edges: edges.map((e) => ({ source: e.source, target: e.target, isCircular: false })),
    };
}

function makeGraph(nodes: string[]): Graph {
    const g = new Graph({ multi: false, type: 'directed' });
    nodes.forEach((id, i) => g.addNode(id, { x: i * 10, y: 0, size: 7, color: '#fff', label: id }));
    return g;
}

describe('applyGroupingLayout', () => {
    it('when groupDirs=false restores flat graph nodes', () => {
        const baseGraph = makeBaseGraph(['src/a.ts', 'src/b.ts']);
        const g = makeGraph(['src/a.ts']);
        const saved = new Map<string, { x: number; y: number }>();
        applyGroupingLayout(g, baseGraph, false, new Set(), saved);
        expect(g.hasNode('src/b.ts')).toBe(true);
    });

    it('when groupDirs=false removes cluster nodes', () => {
        const baseGraph = makeBaseGraph(['src/a.ts']);
        const g = makeGraph(['cluster::src', 'src/a.ts']);
        const saved = new Map<string, { x: number; y: number }>();
        applyGroupingLayout(g, baseGraph, false, new Set(), saved);
        expect(g.hasNode('cluster::src')).toBe(false);
        expect(g.hasNode('src/a.ts')).toBe(true);
    });

    it('saves positions before mutation', () => {
        const baseGraph = makeBaseGraph(['src/a.ts']);
        const g = makeGraph(['src/a.ts']);
        const saved = new Map<string, { x: number; y: number }>();
        applyGroupingLayout(g, baseGraph, false, new Set(), saved);
        expect(saved.has('src/a.ts')).toBe(true);
    });

    it('returns a file-to-display map for flat mode', () => {
        const baseGraph = makeBaseGraph(['src/a.ts', 'src/b.ts']);
        const g = makeGraph(['src/a.ts', 'src/b.ts']);
        const saved = new Map<string, { x: number; y: number }>();
        const result = applyGroupingLayout(g, baseGraph, false, new Set(), saved);
        expect(result.fileToDisplayNode.get('src/a.ts')).toBe('src/a.ts');
        expect(result.fileToDisplayNode.get('src/b.ts')).toBe('src/b.ts');
    });

    it('returns clustered file-to-display map when groupDirs=true', () => {
        const baseGraph = makeBaseGraph(
            ['src/a.ts', 'src/b.ts', 'lib/c.ts'],
            [{ source: 'src/a.ts', target: 'lib/c.ts' }],
        );
        const g = makeGraph(['src/a.ts', 'src/b.ts', 'lib/c.ts']);
        const saved = new Map<string, { x: number; y: number }>();
        const result = applyGroupingLayout(g, baseGraph, true, new Set(), saved);
        expect(result.fileToDisplayNode.get('src/a.ts')).toBe('cluster::src');
        expect(result.fileToDisplayNode.get('src/b.ts')).toBe('cluster::src');
        expect(result.fileToDisplayNode.get('lib/c.ts')).toBe('lib/c.ts');
    });
});
