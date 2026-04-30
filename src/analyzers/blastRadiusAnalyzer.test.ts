import { describe, it, expect } from 'vitest';
import type { SymbolEdge } from '../types';
import { computeBlastRadius } from './blastRadiusAnalyzer';

/** Builds a SymbolEdge for test convenience. */
function edge(sourceName: string, sourceFile: string, targetName: string, targetFile: string, edgeType: SymbolEdge['edgeType'] = 'calls'): SymbolEdge {
    return { sourceName, sourceFile, targetName, targetFile, edgeType, lineNumber: 1 };
}

// ─── Task 21: BFS — direct callers ────────────────────────────────────────

describe('computeBlastRadius', () => {
    it('returns direct callers for a symbol called by B and C', () => {
        const edges: SymbolEdge[] = [
            edge('B', 'b.ts', 'A', 'a.ts'),
            edge('C', 'c.ts', 'A', 'a.ts'),
        ];
        const result = computeBlastRadius('A', 'a.ts', edges);
        expect(result.directCallers).toContain('b.ts:B');
        expect(result.directCallers).toContain('c.ts:C');
        expect(result.byHop[1]).toContain('b.ts:B');
        expect(result.byHop[1]).toContain('c.ts:C');
    });

    // ─── Task 22: Transitive callers with hop grouping ────────────────

    it('groups transitive callers by hop distance (A→B→C→D chain)', () => {
        const edges: SymbolEdge[] = [
            edge('B', 'b.ts', 'A', 'a.ts'),
            edge('C', 'c.ts', 'B', 'b.ts'),
            edge('D', 'd.ts', 'C', 'c.ts'),
        ];
        const result = computeBlastRadius('A', 'a.ts', edges);
        expect(result.byHop[1]).toEqual(expect.arrayContaining(['b.ts:B']));
        expect(result.byHop[2]).toEqual(expect.arrayContaining(['c.ts:C']));
        expect(result.byHop[3]).toEqual(expect.arrayContaining(['d.ts:D']));
        expect(result.transitiveCallers).toContain('c.ts:C');
        expect(result.transitiveCallers).toContain('d.ts:D');
    });

    // ─── Task 23: Weighted scoring by edge type ───────────────────────

    it('weights score: calls=1.0, extends=1.5', () => {
        const edges: SymbolEdge[] = [
            edge('B', 'b.ts', 'A', 'a.ts', 'calls'),   // weight 1.0
            edge('C', 'c.ts', 'A', 'a.ts', 'extends'),  // weight 1.5
        ];
        const result = computeBlastRadius('A', 'a.ts', edges);
        expect(result.score).toBeCloseTo(2.5);
    });

    // ─── Task 24: Cycle safety ────────────────────────────────────────

    it('terminates and returns finite score for recursive call (A→B→A)', () => {
        const edges: SymbolEdge[] = [
            edge('B', 'b.ts', 'A', 'a.ts'),
            edge('A', 'a.ts', 'B', 'b.ts'), // cycle back
        ];
        const result = computeBlastRadius('A', 'a.ts', edges);
        expect(Number.isFinite(result.score)).toBe(true);
        expect(result.directCallers).toContain('b.ts:B');
    });

    // ─── Task 25: Symbol not found ────────────────────────────────────

    it('returns empty result for unknown symbol', () => {
        const result = computeBlastRadius('nonexistent', 'x.ts', []);
        expect(result.origin).toBe('nonexistent');
        expect(result.directCallers).toHaveLength(0);
        expect(result.transitiveCallers).toHaveLength(0);
        expect(result.score).toBe(0);
        expect(result.byHop).toEqual({});
    });

    // ─── Task 26: Same-name disambiguation ───────────────────────────

    it('disambiguates symbols by filePath:name (a.ts:parse vs b.ts:parse)', () => {
        const edges: SymbolEdge[] = [
            edge('caller1', 'caller1.ts', 'parse', 'a.ts'),
            edge('caller2', 'caller2.ts', 'parse', 'b.ts'),
        ];
        const resultA = computeBlastRadius('parse', 'a.ts', edges);
        const resultB = computeBlastRadius('parse', 'b.ts', edges);
        expect(resultA.directCallers).toContain('caller1.ts:caller1');
        expect(resultA.directCallers).not.toContain('caller2.ts:caller2');
        expect(resultB.directCallers).toContain('caller2.ts:caller2');
        expect(resultB.directCallers).not.toContain('caller1.ts:caller1');
    });

    // ─── Task 27: Performance ─────────────────────────────────────────

    it('completes in ≤200ms for 1K-symbol graph', () => {
        const edges: SymbolEdge[] = [];
        // Build a fan-in graph: 1000 symbols all call 'root'
        for (let i = 0; i < 1000; i++) {
            edges.push(edge(`fn${i}`, `file${i}.ts`, 'root', 'root.ts'));
        }
        const start = performance.now();
        computeBlastRadius('root', 'root.ts', edges);
        expect(performance.now() - start).toBeLessThan(200);
    });
});
