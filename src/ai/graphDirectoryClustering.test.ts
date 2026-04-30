import { describe, expect, it } from 'vitest';
import type { Tour } from '../types';
import { applyDirectoryClustering } from './graphDirectoryClustering';

describe('applyDirectoryClustering', () => {
    it('preserves circular state when multiple file edges collapse into one cluster edge', () => {
        const tour: Tour = {
            id: 'tour-1',
            query: 'cluster test',
            tourType: 'dependency-audit',
            steps: [],
            graph: {
                nodes: [
                    { id: 'src/index.ts', label: 'index.ts', type: 'entry' },
                    { id: 'src/app.ts', label: 'app.ts', type: 'config' },
                    { id: 'lib/utils.ts', label: 'utils.ts', type: 'utility' },
                    { id: 'lib/helpers.ts', label: 'helpers.ts', type: 'utility' },
                ],
                edges: [
                    { source: 'src/index.ts', target: 'lib/utils.ts', label: 'imports' },
                    { source: 'src/app.ts', target: 'lib/helpers.ts', label: 'imports', isCircular: true },
                ],
            },
            analysisSnapshot: {
                frameworks: [],
                entryPoints: [],
                totalFiles: 4,
                totalEdges: 2,
                circularCount: 1,
            },
            createdAt: new Date().toISOString(),
        };

        const clustered = applyDirectoryClustering(tour, new Set());

        expect(clustered.graph.nodes.map((node) => node.id)).toEqual(['cluster::src', 'cluster::lib']);
        expect(clustered.graph.edges).toHaveLength(1);
        expect(clustered.graph.edges[0]).toMatchObject({
            source: 'cluster::src',
            target: 'cluster::lib',
            isCircular: true,
        });
    });
});