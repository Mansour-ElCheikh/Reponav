import { describe, it, expect } from 'vitest';
import { detectSeams } from './seamDetector';
import type { ImportEdge, CoChangePair } from '../types';

describe('seamDetector', () => {
    it('should identify a high-confidence seam at a structural bottleneck', () => {
        // Linear chain: A -> B -> C
        // B is the bottleneck (bridge)
        const nodes = ['A.ts', 'B.ts', 'C.ts'];
        const edges: ImportEdge[] = [
            { source: 'A.ts', target: 'B.ts', specifiers: [], isDynamic: false, rawStatement: '' },
            { source: 'B.ts', target: 'C.ts', specifiers: [], isDynamic: false, rawStatement: '' }
        ];
        
        // Low coupling between A and C
        const couplings: CoChangePair[] = [
            { fileA: 'A.ts', fileB: 'B.ts', support: 1, confidence: 0.1 }
        ];

        const seams = detectSeams(nodes, edges, couplings);

        expect(seams.length).toBeGreaterThan(0);
        expect(seams[0].score).toBeGreaterThan(30);
        expect(seams[0].rationale).toContain('High structural betweenness');
    });

    it('should penalize edges with high change coupling', () => {
        const nodes = ['A.ts', 'B.ts'];
        const edges: ImportEdge[] = [
            { source: 'A.ts', target: 'B.ts', specifiers: [], isDynamic: false, rawStatement: '' }
        ];
        
        // Case 1: Low coupling
        const lowCouplings: CoChangePair[] = [{ fileA: 'A.ts', fileB: 'B.ts', support: 1, confidence: 0.1 }];
        const lowScore = detectSeams(nodes, edges, lowCouplings)[0].score;

        // Case 2: High coupling (should be lower score)
        const highCouplings: CoChangePair[] = [{ fileA: 'A.ts', fileB: 'B.ts', support: 100, confidence: 1.0 }];
        const highScore = detectSeams(nodes, edges, highCouplings)[0].score;
        
        expect(highScore).toBeLessThan(lowScore);
    });
});
