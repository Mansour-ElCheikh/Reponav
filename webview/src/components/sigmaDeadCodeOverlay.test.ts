/**
 * Tests for sigmaDeadCodeOverlay — pure functions for dead code node dimming.
 * T21, T22, T24 (module boundary behavior tested via exports check).
 */
import { describe, it, expect } from 'vitest';
import { applyDeadCodeAttributes } from './sigmaDeadCodeOverlay';

// ─── T21: applyDeadCodeAttributes — file in deadCodeFiles ────────────────────

describe('applyDeadCodeAttributes — file IS in deadCodeFiles', () => {
    it('returns dead color #9ca3af when filePath is in deadCodeFiles', () => {
        const result = applyDeadCodeAttributes('node1', 'src/foo.ts', ['src/foo.ts']);
        expect(result.color).toBe('#9ca3af');
    });

    it('returns size multiplier 0.6 when filePath is in deadCodeFiles', () => {
        const result = applyDeadCodeAttributes('node1', 'src/foo.ts', ['src/foo.ts']);
        expect(result.sizeMultiplier).toBe(0.6);
    });

    it('marks the node as dead', () => {
        const result = applyDeadCodeAttributes('node1', 'src/foo.ts', ['src/foo.ts']);
        expect(result.isDead).toBe(true);
    });
});

// ─── T22: applyDeadCodeAttributes — file NOT in deadCodeFiles ─────────────────

describe('applyDeadCodeAttributes — file NOT in deadCodeFiles', () => {
    it('returns null when filePath is not in deadCodeFiles', () => {
        const result = applyDeadCodeAttributes('node1', 'src/bar.ts', ['src/foo.ts']);
        expect(result).toBeNull();
    });

    it('returns null when deadCodeFiles is empty', () => {
        const result = applyDeadCodeAttributes('node1', 'src/foo.ts', []);
        expect(result).toBeNull();
    });

    it('accepts a precomputed Set of dead-code files', () => {
        const result = applyDeadCodeAttributes('node1', 'src/foo.ts', new Set(['src/foo.ts']));
        expect(result?.isDead).toBe(true);
    });

    it('does not clone a provided Set when checking membership', () => {
        class TrackingSet extends Set<string> {
            public iteratorCalls = 0;

            override [Symbol.iterator](): IterableIterator<string> {
                this.iteratorCalls += 1;
                return super[Symbol.iterator]();
            }
        }

        const deadFiles = new TrackingSet(['src/foo.ts']);
        const result = applyDeadCodeAttributes('node1', 'src/foo.ts', deadFiles);

        expect(result?.isDead).toBe(true);
        expect(deadFiles.iteratorCalls).toBe(0);
    });
});

// ─── T24 (structural): module exports applyDeadCodeAttributes ─────────────────

describe('sigmaDeadCodeOverlay — module exports', () => {
    it('exports applyDeadCodeAttributes as a function', async () => {
        const mod = await import('./sigmaDeadCodeOverlay');
        expect(typeof mod.applyDeadCodeAttributes).toBe('function');
    });
});
