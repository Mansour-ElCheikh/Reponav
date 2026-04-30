/**
 * sigmaDeadCodeOverlay — pure utilities for dead code node dimming in Sigma.js graphs.
 *
 * These functions are pure (no Sigma/DOM dependency) so they can be unit-tested in Node.
 * SigmaGraph.tsx imports and applies them during the node reducer pass.
 */

/** Dead code node visual attributes returned when a node's file is flagged. */
export interface DeadNodeAttributes {
    color: string;
    sizeMultiplier: number;
    isDead: true;
}

/** Dead code node color — neutral gray matching Tailwind gray-400. */
export const DEAD_CODE_COLOR = '#9ca3af';

/** Dead code size multiplier — nodes render at 60% of their normal size. */
export const DEAD_CODE_SIZE_MULTIPLIER = 0.6;

/**
 * Computes dead code overlay attributes for a single node.
 *
 * Returns `DeadNodeAttributes` when the node's file is in `deadCodeFiles`,
 * or `null` when the node is not dead (caller should leave attributes unchanged).
 */
export function applyDeadCodeAttributes(
    _nodeId: string,
    filePath: string,
    deadCodeFiles: readonly string[] | ReadonlySet<string>
): DeadNodeAttributes | null {
    if (deadCodeFiles instanceof Set) {
        if (deadCodeFiles.size === 0 || !deadCodeFiles.has(filePath)) return null;
    } else {
        if (deadCodeFiles.length === 0 || !deadCodeFiles.includes(filePath)) return null;
    }
    return {
        color: DEAD_CODE_COLOR,
        sizeMultiplier: DEAD_CODE_SIZE_MULTIPLIER,
        isDead: true,
    };
}
