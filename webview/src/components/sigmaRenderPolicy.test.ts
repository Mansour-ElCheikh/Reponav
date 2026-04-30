import { describe, expect, it } from 'vitest';

import {
    BASE_EDGE_COLOR,
    CIRCULAR_COLOR,
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

describe('sigmaRenderPolicy', () => {
    it('keeps node category color when no selection is active', () => {
        expect(nodeColorFor('src/app.ts', 'service', null, new Set(), new Set(), new Set())).toBe(NODE_COLORS.service);
    });

    it('uses structural border colors without changing the node fill', () => {
        const visuals = nodeVisualsFor('dep.ts', 'utility', 'app.ts', new Set(['dep.ts']), new Set(), new Set());

        expect(visuals.color).toBe(NODE_COLORS.utility);
        expect(visuals.borderColor).toBe(UPSTREAM_COLOR);
        expect(visuals.borderSize).toBe(0.15);
    });

    it('keeps default edges neutral until selection or circular filter changes policy', () => {
        expect(edgeColorFor('a.ts', 'b.ts', true, null)).toEqual({ color: BASE_EDGE_COLOR, size: 1.5 });
        expect(edgeColorFor('a.ts', 'b.ts', true, null, true)).toEqual({ color: CIRCULAR_COLOR, size: 2.5 });
    });

    it('classifies transitive cycle neighbors as circular when circularNeighborMap is provided', () => {
        const upstreamMap = new Map<string, Set<string>>([
            ['A.ts', new Set(['C.ts'])],
            ['B.ts', new Set(['A.ts'])],
            ['C.ts', new Set(['B.ts'])],
        ]);
        const downstreamMap = new Map<string, Set<string>>([
            ['A.ts', new Set(['B.ts'])],
            ['B.ts', new Set(['C.ts'])],
            ['C.ts', new Set(['A.ts'])],
        ]);
        const circularNeighborMap = new Map<string, Set<string>>([
            ['A.ts', new Set(['B.ts', 'C.ts'])],
        ]);

        const result = computeSelectionSets(upstreamMap, downstreamMap, 'A.ts', circularNeighborMap);

        expect(result.circular).toEqual(new Set(['B.ts', 'C.ts']));
        expect(result.upstreamOnly.size).toBe(0);
        expect(result.downstreamOnly.size).toBe(0);
    });

    it('adds glow affordance for step-active reducer nodes', () => {
        const baseData = {
            color: NODE_COLORS.route,
            size: 10,
            nodeType: 'route',
            originalSize: 10,
            halo: false,
            borderColor: NODE_COLORS.route,
            borderSize: 0,
        };

        const result = buildNodeReducerState(
            'step.ts',
            baseData,
            { showTestFiles: true, showCircularOnly: false },
            null,
            new Set(),
            new Set(),
            new Set(['step.ts']),
        );

        expect(result.halo).toBe(true);
        expect(result.borderColor).toBe(STEP_GLOW_COLOR);
        expect(result.zIndex).toBe(1);
    });

    it('hides unrelated edges once selection policy dims them', () => {
        const result = buildEdgeReducerState(
            { color: BASE_EDGE_COLOR, size: 1.5, isCircular: false },
            'a.ts',
            'b.ts',
            { showTestFiles: true, showCircularOnly: false },
            new Set(),
            'selected.ts',
        );

        expect(result.hidden).toBe(true);
    });

    it('keeps downstream selected edges visible with directional styling', () => {
        const result = buildEdgeReducerState(
            { color: BASE_EDGE_COLOR, size: 1.5, isCircular: false },
            'selected.ts',
            'child.ts',
            { showTestFiles: true, showCircularOnly: false },
            new Set(),
            'selected.ts',
        );

        expect(result.hidden).toBeUndefined();
        expect(result.color).toBe(DOWNSTREAM_COLOR);
        expect(result.size).toBe(3);
    });
});