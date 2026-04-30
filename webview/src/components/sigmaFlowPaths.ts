/**
 * sigmaFlowPaths — pure utility to convert FlowSequence data into SVG polyline paths.
 * Accepts a coordinate-getter function so it is testable without Sigma or a DOM.
 */
import type { FlowSequence } from '../types';

/** A single SVG polyline expressed as an ordered list of [x, y] viewport coordinates. */
export type FlowPath = number[][];

/**
 * Converts an array of FlowSequences into polyline paths using the provided coordinate
 * getter. One path is produced per consecutive step pair within each sequence.
 * Step pairs where either node's coordinates are unavailable are silently skipped.
 */
export function buildFlowPaths(
    flows: FlowSequence[],
    getCoords: (nodeId: string) => { x: number; y: number } | undefined,
): FlowPath[] {
    const paths: FlowPath[] = [];
    for (const seq of flows) {
        for (let i = 0; i < seq.steps.length - 1; i++) {
            const a = getCoords(seq.steps[i].filePath);
            const b = getCoords(seq.steps[i + 1].filePath);
            if (!a || !b) continue;
            paths.push([[a.x, a.y], [b.x, b.y]]);
        }
    }
    return paths;
}

/** Returns true when both path arrays contain the exact same viewport coordinates. */
export function flowPathsEqual(a: FlowPath[], b: FlowPath[]): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
        if (a[i].length !== b[i].length) return false;
        for (let j = 0; j < a[i].length; j++) {
            if (a[i][j][0] !== b[i][j][0] || a[i][j][1] !== b[i][j][1]) return false;
        }
    }
    return true;
}
