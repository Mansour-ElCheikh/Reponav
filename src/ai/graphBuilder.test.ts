/**
 * Tests for buildDeterministicTour — converts AnalysisReport to a graph-only Tour without LLM.
 */

import { describe, it, expect } from 'vitest';
import type { AnalysisReport } from '../types';
import { buildDeterministicTour } from './graphBuilder';

function makeReport(overrides: Partial<AnalysisReport> = {}): AnalysisReport {
    return {
        timestamp: new Date().toISOString(),
        workspaceRoot: '/test',
        indexTier: 1,
        frameworks: [{ name: 'express', version: '4.18', type: 'framework', evidence: 'package.json' }],
        primaryLanguage: 'TypeScript',
        entryPoints: [{ file: 'src/index.ts', type: 'main', confidence: 'high', reason: 'package.json main' }],
        dependencyGraph: {
            nodes: ['src/index.ts', 'src/app.ts', 'src/routes.ts'],
            edges: [
                { source: 'src/index.ts', target: 'src/app.ts', specifiers: ['app'], isDynamic: false, rawStatement: "import { app } from './app'" },
                { source: 'src/app.ts', target: 'src/routes.ts', specifiers: ['router'], isDynamic: false, rawStatement: "import { router } from './routes'" },
            ],
            circularDependencies: [],
        },
        fileClassifications: [
            { path: 'src/index.ts', category: 'entry', confidence: 'high', reason: 'main entry' },
            { path: 'src/app.ts', category: 'config', confidence: 'medium', reason: 'app setup' },
            { path: 'src/routes.ts', category: 'route', confidence: 'high', reason: 'route definitions' },
        ],
        metrics: {
            totalFiles: 3,
            totalLines: 150,
            fileMetrics: [
                { path: 'src/index.ts', lines: 20, importCount: 1, exportCount: 0, fanIn: 0, fanOut: 1 },
                { path: 'src/app.ts', lines: 80, importCount: 1, exportCount: 1, fanIn: 1, fanOut: 1 },
                { path: 'src/routes.ts', lines: 50, importCount: 0, exportCount: 1, fanIn: 1, fanOut: 0 },
            ],
            hotFiles: [{ path: 'src/app.ts', lines: 80, importCount: 1, exportCount: 1, fanIn: 1, fanOut: 1 }],
            orphanFiles: [],
        },
        fileTree: {},
        keyFileContents: {},
        ...overrides,
    };
}

describe('buildDeterministicTour', () => {
    it('includes all dependency graph nodes', () => {
        const report = makeReport();
        const tour = buildDeterministicTour(report);
        expect(tour.graph.nodes).toHaveLength(3);
        expect(tour.graph.nodes.map(n => n.id)).toEqual(['src/index.ts', 'src/app.ts', 'src/routes.ts']);
    });

    it('includes all dependency graph edges', () => {
        const report = makeReport();
        const tour = buildDeterministicTour(report);
        expect(tour.graph.edges).toHaveLength(2);
        expect(tour.graph.edges[0].source).toBe('src/index.ts');
        expect(tour.graph.edges[0].target).toBe('src/app.ts');
    });

    it('uses file classifications for node types', () => {
        const report = makeReport();
        const tour = buildDeterministicTour(report);
        const indexNode = tour.graph.nodes.find(n => n.id === 'src/index.ts');
        expect(indexNode?.type).toBe('entry');
    });

    it('defaults to unknown type for unclassified files', () => {
        const report = makeReport({
            fileClassifications: [],
        });
        const tour = buildDeterministicTour(report);
        expect(tour.graph.nodes[0].type).toBe('unknown');
    });

    it('has no steps (graph-only tour)', () => {
        const report = makeReport();
        const tour = buildDeterministicTour(report);
        expect(tour.steps).toHaveLength(0);
    });

    it('sets tourType to dependency-audit', () => {
        const report = makeReport();
        const tour = buildDeterministicTour(report);
        expect(tour.tourType).toBe('dependency-audit');
    });

    it('populates analysisSnapshot', () => {
        const report = makeReport();
        const tour = buildDeterministicTour(report);
        expect(tour.analysisSnapshot.totalFiles).toBe(3);
        expect(tour.analysisSnapshot.totalEdges).toBe(2);
        expect(tour.analysisSnapshot.frameworks).toContain('express');
    });

    it('separates runtime entry points from tooling launch surfaces in analysisSnapshot', () => {
        const report = makeReport({
            entryPoints: [
                { file: 'src/main.ts', type: 'main', entrySurface: 'runtime', confidence: 'high', reason: 'runtime' },
                { file: 'bin/reponav.ts', type: 'cli', entrySurface: 'tooling', confidence: 'high', reason: 'cli' },
            ],
        });

        const tour = buildDeterministicTour(report);

        expect(tour.analysisSnapshot.entryPoints).toEqual(['src/main.ts']);
        expect(tour.analysisSnapshot.launchSurfaces).toEqual(['bin/reponav.ts']);
    });

    it('sets fan-in as node weight', () => {
        const report = makeReport();
        const tour = buildDeterministicTour(report);
        const appNode = tour.graph.nodes.find(n => n.id === 'src/app.ts');
        expect(appNode?.weight).toBe(1);
    });

    it('caps nodes to maxNodes, prioritizing entry points and high fan-in', () => {
        const nodes = Array.from({ length: 50 }, (_, i) => `src/file${i}.ts`);
        const edges = nodes.slice(1).map(n => ({
            source: 'src/file0.ts', target: n, specifiers: [], isDynamic: false, rawStatement: '',
        }));
        const fileMetrics = nodes.map((p, i) => ({
            path: p, lines: 10, importCount: 0, exportCount: 0,
            fanIn: i === 0 ? 49 : i, // file0 has highest fan-in
            fanOut: 0,
        }));
        const report = makeReport({
            dependencyGraph: { nodes, edges, circularDependencies: [] },
            entryPoints: [{ file: 'src/file0.ts', type: 'main' as const, confidence: 'high', reason: 'test' }],
            metrics: { totalFiles: 50, totalLines: 500, fileMetrics, hotFiles: [], orphanFiles: [] },
        });

        const tour = buildDeterministicTour(report, 10);
        expect(tour.graph.nodes).toHaveLength(10);
        // Entry point always included
        expect(tour.graph.nodes.map(n => n.id)).toContain('src/file0.ts');
        // Edges only between selected nodes
        for (const edge of tour.graph.edges) {
            const nodeIds = new Set(tour.graph.nodes.map(n => n.id));
            expect(nodeIds.has(edge.source)).toBe(true);
            expect(nodeIds.has(edge.target)).toBe(true);
        }
        // analysisSnapshot reflects total, not filtered
        expect(tour.analysisSnapshot.totalFiles).toBe(50);
    });

    it('marks the file graph snapshot as sampled when the node cap trims the graph', () => {
        const nodes = Array.from({ length: 50 }, (_, i) => `src/file${i}.ts`);
        const edges = nodes.slice(1).map((node) => ({
            source: 'src/file0.ts', target: node, specifiers: [], isDynamic: false, rawStatement: '',
        }));
        const fileMetrics = nodes.map((path, index) => ({
            path,
            lines: 10,
            importCount: 0,
            exportCount: 0,
            fanIn: index === 0 ? 49 : index,
            fanOut: 0,
        }));
        const report = makeReport({
            dependencyGraph: { nodes, edges, circularDependencies: [] },
            entryPoints: [{ file: 'src/file0.ts', type: 'main' as const, confidence: 'high', reason: 'test' }],
            metrics: { totalFiles: 50, totalLines: 500, fileMetrics, hotFiles: [], orphanFiles: [] },
        });

        const tour = buildDeterministicTour(report, 10);

        expect(tour.analysisSnapshot.completeness).toEqual({
            analysisScope: 'fullWorkspace',
            analyzedFileCount: 50,
            graphNodeCount: 10,
            graphEdgeCount: tour.graph.edges.length,
            graphSampleLimit: 10,
            analysisCoverage: 'complete',
            graphCoverage: 'sampled',
        });
    });

    it('marks the file graph snapshot as complete when all analyzed nodes fit in the graph', () => {
        const report = makeReport();

        const tour = buildDeterministicTour(report, 40);

        expect(tour.analysisSnapshot.completeness).toEqual({
            analysisScope: 'fullWorkspace',
            analyzedFileCount: 3,
            graphNodeCount: 3,
            graphEdgeCount: 2,
            graphSampleLimit: 40,
            analysisCoverage: 'complete',
            graphCoverage: 'complete',
        });
    });

    it('includes all nodes when under maxNodes cap', () => {
        const report = makeReport(); // 3 nodes
        const tour = buildDeterministicTour(report, 40);
        expect(tour.graph.nodes).toHaveLength(3);
    });

    it('marks circular edges', () => {
        const report = makeReport({
            dependencyGraph: {
                nodes: ['a.ts', 'b.ts'],
                edges: [
                    { source: 'a.ts', target: 'b.ts', specifiers: [], isDynamic: false, rawStatement: '' },
                    { source: 'b.ts', target: 'a.ts', specifiers: [], isDynamic: false, rawStatement: '' },
                ],
                circularDependencies: [['a.ts', 'b.ts']],
            },
        });
        const tour = buildDeterministicTour(report);
        const circularEdge = tour.graph.edges.find(e => e.source === 'b.ts' && e.target === 'a.ts');
        expect(circularEdge?.isCircular).toBe(true);
    });

    it('includes low fan-in cycle nodes even when maxNodes cap would exclude them', () => {
        // Build a report where the first node is a high-traffic hub but the second (cycle partner) has zero fan-in.
        // With maxNodes=1, the hub is selected but the cycle partner would normally be excluded.
        // The augmentation must force the cycle partner into the graph so the circular edge is visible.
        const cycleEdge1 = { source: 'hub.ts', target: 'hidden.ts', specifiers: [], isDynamic: false, rawStatement: '' };
        const cycleEdge2 = { source: 'hidden.ts', target: 'hub.ts', specifiers: [], isDynamic: false, rawStatement: '' };
        const report = makeReport({
            dependencyGraph: {
                nodes: ['hub.ts', 'hidden.ts'],
                edges: [cycleEdge1, cycleEdge2],
                circularDependencies: [['hub.ts', 'hidden.ts']],
            },
        });
        const tour = buildDeterministicTour(report, { maxNodes: 1 }); // cap forces hub.ts only initially
        const nodeIds = tour.graph.nodes.map(n => n.id);
        expect(nodeIds).toContain('hub.ts');
        expect(nodeIds).toContain('hidden.ts'); // augmentation must include this
        const circEdge = tour.graph.edges.find(e => e.source === 'hidden.ts' && e.target === 'hub.ts');
        expect(circEdge?.isCircular).toBe(true);
    });

    describe('groupByDirectory clustering', () => {
        it('collapses files in the same directory into a cluster node', () => {
            const report = makeReport();
            // all 3 nodes are in 'src/' directory
            const tour = buildDeterministicTour(report, { groupByDirectory: true });
            expect(tour.graph.nodes).toHaveLength(1);
            expect(tour.graph.nodes[0].isCluster).toBe(true);
            expect(tour.graph.nodes[0].childCount).toBe(3);
            expect(tour.graph.nodes[0].label).toBe('src');
        });

        it('drops intra-cluster edges (self-loops after remapping)', () => {
            const report = makeReport();
            const tour = buildDeterministicTour(report, { groupByDirectory: true });
            // all edges are intra-'src/' and become self-loops, so they're dropped
            expect(tour.graph.edges).toHaveLength(0);
        });

        it('preserves inter-directory edges between different clusters', () => {
            // Use 2 files in each directory so clustering is triggered
            const report = makeReport({
                dependencyGraph: {
                    nodes: ['src/index.ts', 'src/app.ts', 'lib/utils.ts', 'lib/helpers.ts'],
                    edges: [
                        { source: 'src/index.ts', target: 'lib/utils.ts', specifiers: [], isDynamic: false, rawStatement: '' },
                        { source: 'src/app.ts', target: 'lib/helpers.ts', specifiers: [], isDynamic: false, rawStatement: '' },
                    ],
                    circularDependencies: [],
                },
                fileClassifications: [
                    { path: 'src/index.ts', category: 'entry', confidence: 'high', reason: 'entry' },
                    { path: 'src/app.ts', category: 'config', confidence: 'medium', reason: 'app' },
                    { path: 'lib/utils.ts', category: 'utility', confidence: 'high', reason: 'utility' },
                    { path: 'lib/helpers.ts', category: 'utility', confidence: 'high', reason: 'helpers' },
                ],
                entryPoints: [{ file: 'src/index.ts', type: 'main', confidence: 'high', reason: 'entry' }],
                metrics: {
                    totalFiles: 4,
                    totalLines: 100,
                    fileMetrics: [
                        { path: 'src/index.ts', lines: 20, importCount: 1, exportCount: 0, fanIn: 0, fanOut: 1 },
                        { path: 'src/app.ts', lines: 30, importCount: 1, exportCount: 0, fanIn: 0, fanOut: 1 },
                        { path: 'lib/utils.ts', lines: 25, importCount: 0, exportCount: 1, fanIn: 1, fanOut: 0 },
                        { path: 'lib/helpers.ts', lines: 25, importCount: 0, exportCount: 1, fanIn: 1, fanOut: 0 },
                    ],
                    hotFiles: [],
                    orphanFiles: [],
                },
            });
            const tour = buildDeterministicTour(report, { groupByDirectory: true });
            expect(tour.graph.nodes).toHaveLength(2);
            expect(tour.graph.nodes.every(n => n.isCluster)).toBe(true);
            // Both inter-dir edges get deduplicated to one per (src→lib, src→lib)
            expect(tour.graph.edges.length).toBeGreaterThanOrEqual(1);
            const edgeSources = tour.graph.edges.map(e => e.source);
            const edgeTargets = tour.graph.edges.map(e => e.target);
            expect(edgeSources).toContain('cluster::src');
            expect(edgeTargets).toContain('cluster::lib');
        });

        it('expands a cluster when its id is in expandedClusters', () => {
            const report = makeReport();
            const tour = buildDeterministicTour(report, {
                groupByDirectory: true,
                expandedClusters: new Set(['cluster::src']),
            });
            // cluster expanded → individual files shown
            expect(tour.graph.nodes.every(n => !n.isCluster)).toBe(true);
            expect(tour.graph.nodes).toHaveLength(3);
        });

        it('shows single-file directories as plain nodes (no cluster)', () => {
            const report = makeReport({
                dependencyGraph: {
                    nodes: ['src/index.ts', 'lib/utils.ts'],
                    edges: [],
                    circularDependencies: [],
                },
                fileClassifications: [
                    { path: 'src/index.ts', category: 'entry', confidence: 'high', reason: 'entry' },
                    { path: 'lib/utils.ts', category: 'utility', confidence: 'high', reason: 'utility' },
                ],
                metrics: {
                    totalFiles: 2,
                    totalLines: 50,
                    fileMetrics: [
                        { path: 'src/index.ts', lines: 20, importCount: 0, exportCount: 0, fanIn: 0, fanOut: 0 },
                        { path: 'lib/utils.ts', lines: 30, importCount: 0, exportCount: 0, fanIn: 0, fanOut: 0 },
                    ],
                    hotFiles: [],
                    orphanFiles: [],
                },
            });
            const tour = buildDeterministicTour(report, { groupByDirectory: true });
            // Each directory has exactly 1 file → shown as plain nodes
            expect(tour.graph.nodes.every(n => !n.isCluster)).toBe(true);
        });
    });

    it('can build a symbol-level deterministic graph when symbol data is present', () => {
        const tour = buildDeterministicTour(makeReport({
            indexTier: 2,
            symbols: [
                {
                    name: 'bootstrap',
                    kind: 'function',
                    filePath: 'src/index.ts',
                    lineStart: 1,
                    lineEnd: 4,
                    isExported: true,
                    isEntryPoint: true,
                },
                {
                    name: 'AppService',
                    kind: 'class',
                    filePath: 'src/app.ts',
                    lineStart: 1,
                    lineEnd: 12,
                    isExported: true,
                    isEntryPoint: false,
                },
            ],
            symbolEdges: [
                {
                    sourceFile: 'src/index.ts',
                    sourceName: 'bootstrap',
                    targetFile: 'src/app.ts',
                    targetName: 'AppService',
                    edgeType: 'calls',
                    lineNumber: 3,
                },
            ],
            symbolMetrics: {
                totalSymbols: 2,
                totalSymbolEdges: 1,
                symbolsByKind: {
                    function: 1,
                    class: 1,
                } as any,
                deadCodeCount: 0,
            },
        }), { graphMode: 'symbol', maxNodes: 10 });

        expect(tour.query).toBe('Symbol Graph');
        expect(tour.graph.nodes).toHaveLength(2);
        expect(tour.graph.nodes[0].id).toContain('::symbol::');
        expect(tour.graph.edges[0].label).toBe('calls');
        expect(tour.analysisSnapshot.totalFiles).toBe(2);
    });
});
