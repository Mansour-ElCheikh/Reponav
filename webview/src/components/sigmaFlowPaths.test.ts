/**
 * sigmaFlowPaths tests — epic 008 component 002 task T10.
 * Tests the pure path-conversion utility in isolation (no Sigma / WebGL required).
 */
import { describe, expect, it } from 'vitest';
import { buildFlowPaths, flowPathsEqual } from './sigmaFlowPaths';
import type { FlowSequence } from '../types';

const mockGetCoords = (id: string): { x: number; y: number } | undefined => {
    const coords: Record<string, { x: number; y: number }> = {
        'ctrl.ts': { x: 10, y: 20 },
        'svc.ts': { x: 30, y: 40 },
        'db.ts': { x: 50, y: 60 },
    };
    return coords[id];
};

describe('sigmaFlowPaths — T10: buildFlowPaths conversion', () => {
    it('converts FlowSequence steps to coordinate paths', () => {
        const flows: FlowSequence[] = [
            { id: 'f1', entryPoint: 'ctrl.ts', steps: [{ filePath: 'ctrl.ts', fileCategory: 'controller', layer: 0 }, { filePath: 'svc.ts', fileCategory: 'service', layer: 1 }, { filePath: 'db.ts', fileCategory: 'model', layer: 2 }], anomalies: [] },
        ];
        const paths = buildFlowPaths(flows, mockGetCoords);
        // 3 steps → 2 consecutive pairs → 2 polylines
        expect(paths.length).toBe(2);
        expect(paths[0]).toEqual([[10, 20], [30, 40]]);
        expect(paths[1]).toEqual([[30, 40], [50, 60]]);
    });

    it('returns empty paths when flows is empty', () => {
        const paths = buildFlowPaths([], mockGetCoords);
        expect(paths.length).toBe(0);
    });

    it('skips step pairs where a node coord is missing', () => {
        const flows: FlowSequence[] = [
            { id: 'f2', entryPoint: 'ctrl.ts', steps: [{ filePath: 'ctrl.ts', fileCategory: 'controller', layer: 0 }, { filePath: 'unknown.ts', fileCategory: 'unknown', layer: 1 }, { filePath: 'db.ts', fileCategory: 'model', layer: 2 }], anomalies: [] },
        ];
        const paths = buildFlowPaths(flows, mockGetCoords);
        // ctrl→unknown: unknown missing, skip. unknown→db: unknown missing, skip.
        expect(paths.length).toBe(0);
    });

    it('skips a FlowSequence with only 1 step (no pair possible)', () => {
        const flows: FlowSequence[] = [
            { id: 'f3', entryPoint: 'ctrl.ts', steps: [{ filePath: 'ctrl.ts', fileCategory: 'controller', layer: 0 }], anomalies: [] },
        ];
        const paths = buildFlowPaths(flows, mockGetCoords);
        expect(paths.length).toBe(0);
    });
});

describe('sigmaFlowPaths — acceptance: stable path equality', () => {
    it('returns true for identical flow path arrays', () => {
        const paths = [[[10, 20], [30, 40]]];
        expect(flowPathsEqual(paths, [[[10, 20], [30, 40]]])).toBe(true);
    });

    it('returns false when any coordinate differs', () => {
        expect(flowPathsEqual([[[10, 20], [30, 40]]], [[[10, 20], [31, 40]]])).toBe(false);
    });

    it('returns false when path counts differ', () => {
        expect(flowPathsEqual([[[10, 20], [30, 40]]], [])).toBe(false);
    });
});
