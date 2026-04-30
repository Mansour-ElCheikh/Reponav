import { describe, expect, it } from 'vitest';
import type { Tour } from '../types';
import { CIRCULAR_COLOR, DOWNSTREAM_COLOR, buildEdgeReducerState, edgeColorFor } from './sigmaRenderPolicy';
import {
    hasCircularEdgesInTour,
} from './sigmaGraphHelpers';

describe('sigmaGraphHelpers', () => {
    it('detects circular edges from the cached analysis snapshot first', () => {
        const tour = {
            analysisSnapshot: { circularCount: 2 },
            graph: { edges: [] },
        } as Tour;

        expect(hasCircularEdgesInTour(tour)).toBe(true);
    });

    it('falls back to graph edge flags when the snapshot count is missing', () => {
        const tour = {
            graph: { edges: [{ isCircular: true }] },
        } as Tour;

        expect(hasCircularEdgesInTour(tour)).toBe(true);
    });

    it('returns circular edge styling when the circular-only filter is active', () => {
        expect(edgeColorFor('a.ts', 'b.ts', true, null, true)).toEqual({
            color: CIRCULAR_COLOR,
            size: 2.5,
        });
    });

    it('hides unrelated edges in the reducer when a node selection is active', () => {
        const result = buildEdgeReducerState(
            { isCircular: false },
            'src/a.ts',
            'src/b.ts',
            { showTestFiles: true, showCircularOnly: false },
            new Set<string>(),
            'src/selected.ts',
        );

        expect(result.hidden).toBe(true);
    });

    it('keeps selected-node edges visible with directional color', () => {
        const result = buildEdgeReducerState(
            { isCircular: false },
            'src/selected.ts',
            'src/child.ts',
            { showTestFiles: true, showCircularOnly: false },
            new Set<string>(),
            'src/selected.ts',
        );

        expect(result.hidden).toBeUndefined();
        expect(result.color).toBe(DOWNSTREAM_COLOR);
    });
});