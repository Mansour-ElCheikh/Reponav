import { describe, it, expect } from 'vitest';
import { findBridgeEdges } from './communityAnalyzer';
import type { ImportEdge } from '../types';

describe('communityAnalyzer', () => {
    it('should identify a bridge edge in a linear chain', () => {
        // A -> B -> C
        const nodes = ['A.ts', 'B.ts', 'C.ts'];
        const edges: ImportEdge[] = [
            { source: 'A.ts', target: 'B.ts', specifiers: [], isDynamic: false, rawStatement: '' },
            { source: 'B.ts', target: 'C.ts', specifiers: [], isDynamic: false, rawStatement: '' }
        ];

        const bridges = findBridgeEdges(nodes, edges);

        // Path A->B contributes 2 (for A->B and A->C)
        // Path B->C contributes 1 (for B->C)
        // Note: traceBack logic only counts edges starting from every node to every other node reachable.
        // For A: paths are A->B, A->B->C. Edges: (A,B), (A,B)+(B,C). Counts: (A,B)=2, (B,C)=1
        // For B: path is B->C. Edge: (B,C). Count: (B,C)=1.
        // Total (A,B)=2, (B,C)=2.
        
        expect(bridges).toHaveLength(2);
        expect(bridges[0].betweenness).toBe(2);
        expect(bridges[1].betweenness).toBe(2);
    });

    it('should identify a bottleneck in a butterfly graph', () => {
        // (A,B) -> C -> (D,E)
        const nodes = ['A', 'B', 'C', 'D', 'E'];
        const edges: ImportEdge[] = [
            { source: 'A', target: 'C', specifiers: [], isDynamic: false, rawStatement: '' },
            { source: 'B', target: 'C', specifiers: [], isDynamic: false, rawStatement: '' },
            { source: 'C', target: 'D', specifiers: [], isDynamic: false, rawStatement: '' },
            { source: 'C', target: 'E', specifiers: [], isDynamic: false, rawStatement: '' },
        ];

        const bridges = findBridgeEdges(nodes, edges);

        // Edges connected to C should have highest betweenness
        // From A: A->C (count 3: C, D, E)
        // From B: B->C (count 3: C, D, E)
        // From C: C->D (count 1), C->E (count 1)
        // A->C paths also use C->D and C->E.
        // Total A->C: 3
        // Total B->C: 3
        // Total C->D: 2 (from A and B) + 1 (from C) = 3
        // Total C->E: 2 (from A and B) + 1 (from C) = 3
        
        expect(bridges).toHaveLength(4);
        expect(bridges[0].betweenness).toBe(3);
    });

    it('should handle disconnected nodes', () => {
        const nodes = ['A', 'B'];
        const edges: ImportEdge[] = [];
        const bridges = findBridgeEdges(nodes, edges);
        expect(bridges).toHaveLength(0);
    });
});
