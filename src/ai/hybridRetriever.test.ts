import { describe, it, expect } from 'vitest';
import { reciprocalRankFusion, packChunksToContext } from './hybridRetriever';

describe('reciprocalRankFusion', () => {
    it('ranks items that appear in multiple lists higher', () => {
        const listA = ['a', 'b', 'c'];
        const listB = ['b', 'c', 'd'];
        const fused = reciprocalRankFusion([listA, listB]);

        const bIdx = fused.indexOf('b');
        const dIdx = fused.indexOf('d');
        const aIdx = fused.indexOf('a');

        // b and c appear in both lists — should rank before a and d (single-list items)
        expect(bIdx).toBeLessThan(dIdx);
        expect(bIdx).toBeLessThan(aIdx);
    });

    it('returns a result containing all unique items', () => {
        const fused = reciprocalRankFusion([['a', 'b'], ['b', 'c', 'd']]);
        expect(new Set(fused)).toEqual(new Set(['a', 'b', 'c', 'd']));
    });

    it('handles empty lists gracefully', () => {
        expect(reciprocalRankFusion([])).toEqual([]);
        expect(reciprocalRankFusion([[]])).toEqual([]);
        expect(reciprocalRankFusion([[], []])).toEqual([]);
    });

    it('handles a single list by returning it in order', () => {
        const fused = reciprocalRankFusion([['x', 'y', 'z']]);
        expect(fused).toEqual(['x', 'y', 'z']);
    });
});

describe('packChunksToContext', () => {
    const chunks = new Map([
        ['pathA::sym1', { path: 'src/a.ts', chunkId: 'pathA::sym1', content: 'function alpha(): void {}', symbolName: 'alpha', lineStart: 1, lineEnd: 3, score: -1 }],
        ['pathB::sym1', { path: 'src/b.ts', chunkId: 'pathB::sym1', content: 'export class Beta {}', symbolName: 'Beta', lineStart: 1, lineEnd: 5, score: -2 }],
        ['pathC::sym1', { path: 'src/c.ts', chunkId: 'pathC::sym1', content: 'x'.repeat(400), symbolName: 'gamma', lineStart: 1, lineEnd: 10, score: -3 }],
    ]);

    it('packs chunks in rankedOrder up to the budget', () => {
        const ranked = ['pathA::sym1', 'pathB::sym1', 'pathC::sym1'];
        const result = packChunksToContext(ranked, chunks, 100);
        // 100 chars budget — should fit first two chunks but not the 400-char third
        expect(result).toContain('alpha');
        expect(result).not.toContain('x'.repeat(10)); // third chunk excluded
    });

    it('includes all chunks when budget is large', () => {
        const ranked = ['pathA::sym1', 'pathB::sym1', 'pathC::sym1'];
        const result = packChunksToContext(ranked, chunks, 10_000);
        expect(result).toContain('alpha');
        expect(result).toContain('Beta');
        expect(result).toContain('gamma');
    });

    it('returns empty string when budget is 0', () => {
        const ranked = ['pathA::sym1'];
        expect(packChunksToContext(ranked, chunks, 0)).toBe('');
    });
});
