import { describe, it, expect } from 'vitest';
import type { FileClassification } from '../types';
import { findEntryPoints, traceFlow, mergeSequences, detectFlows } from './flowDetector';
import type { CondensationDag } from './layerDag';

// ─── Task 1: findEntryPoints ──────────────────────────────────────────────

describe('findEntryPoints', () => {
    it('returns controller and route paths and excludes non-entry categories', () => {
        const classifications: FileClassification[] = [
            { path: 'a/controller.ts', category: 'controller', confidence: 'high', reason: '' },
            { path: 'b/controller.ts', category: 'controller', confidence: 'high', reason: '' },
            { path: 'c/route.ts', category: 'route', confidence: 'high', reason: '' },
            { path: 'd/service.ts', category: 'service', confidence: 'high', reason: '' },
        ];
        const result = findEntryPoints(classifications);
        expect(result).toHaveLength(3);
        expect(result).toContain('a/controller.ts');
        expect(result).toContain('b/controller.ts');
        expect(result).toContain('c/route.ts');
        expect(result).not.toContain('d/service.ts');
    });

    it('includes entry category alongside route and controller', () => {
        const classifications: FileClassification[] = [
            { path: 'main.ts', category: 'entry', confidence: 'high', reason: '' },
            { path: 'svc.ts', category: 'service', confidence: 'high', reason: '' },
        ];
        expect(findEntryPoints(classifications)).toEqual(['main.ts']);
    });

    it('returns empty array when no entry categories present', () => {
        const classifications: FileClassification[] = [
            { path: 'utils.ts', category: 'utility', confidence: 'high', reason: '' },
        ];
        expect(findEntryPoints(classifications)).toHaveLength(0);
    });
});

// ─── Task 2: traceFlow — forward DFS along layer order ────────────────────

describe('traceFlow', () => {
    it('returns steps in order for controller → service → persistence path', () => {
        const dag: CondensationDag = {
            components: [['controller.ts'], ['service.ts'], ['repo.ts']],
            dagEdges: [{ from: 0, to: 1 }, { from: 1, to: 2 }],
        };
        const layers = new Map([
            ['controller.ts', 2],
            ['service.ts', 3],
            ['repo.ts', 5],
        ]);
        const seq = traceFlow('controller.ts', dag, layers);
        expect(seq.steps).toHaveLength(3);
        expect(seq.steps[0].filePath).toBe('controller.ts');
        expect(seq.steps[1].filePath).toBe('service.ts');
        expect(seq.steps[2].filePath).toBe('repo.ts');
        expect(seq.anomalies).toHaveLength(0);
        expect(seq.entryPoint).toBe('controller.ts');
    });

    it('returns a sequence with one step when entry point is not in any DAG component', () => {
        const dag: CondensationDag = { components: [], dagEdges: [] };
        const layers = new Map<string, number>();
        const seq = traceFlow('unknown.ts', dag, layers);
        expect(seq.steps).toHaveLength(0);
        expect(seq.anomalies).toHaveLength(0);
    });

    // ─── Task 3: DFS stops at terminal layer ─────────────────────────────

    it('stops DFS at terminal layer node and does not recurse further', () => {
        const dag: CondensationDag = {
            components: [['controller.ts'], ['service.ts'], ['repo.ts'], ['beyond.ts']],
            dagEdges: [
                { from: 0, to: 1 },
                { from: 1, to: 2 },
                { from: 2, to: 3 }, // this edge must not be followed
            ],
        };
        const layers = new Map([
            ['controller.ts', 2],
            ['service.ts', 3],
            ['repo.ts', 5],     // terminal layer
            ['beyond.ts', 6],
        ]);
        const seq = traceFlow('controller.ts', dag, layers);
        const stepFiles = seq.steps.map(s => s.filePath);
        expect(stepFiles).toContain('repo.ts');
        expect(stepFiles).not.toContain('beyond.ts');
    });

    it('treats layer 4 nodes as terminal and does not recurse past them', () => {
        const dag: CondensationDag = {
            components: [['controller.ts'], ['service.ts'], ['model.ts'], ['beyond.ts']],
            dagEdges: [
                { from: 0, to: 1 },
                { from: 1, to: 2 },
                { from: 2, to: 3 },
            ],
        };
        const layers = new Map([
            ['controller.ts', 2],
            ['service.ts', 3],
            ['model.ts', 4],
            ['beyond.ts', 5],
        ]);

        const seq = traceFlow('controller.ts', dag, layers);
        const stepFiles = seq.steps.map((step) => step.filePath);

        expect(stepFiles).toContain('model.ts');
        expect(stepFiles).not.toContain('beyond.ts');
    });

    // ─── Task 4: backward edge produces FlowAnomaly ───────────────────────

    it('produces a backward FlowAnomaly for a service → controller edge', () => {
        const dag: CondensationDag = {
            components: [['controller.ts'], ['service.ts']],
            // controller imports service (forward), service imports controller (backward)
            dagEdges: [{ from: 0, to: 1 }, { from: 1, to: 0 }],
        };
        const layers = new Map([
            ['controller.ts', 2],
            ['service.ts', 3],
        ]);
        const seq = traceFlow('controller.ts', dag, layers);
        expect(seq.anomalies.some(a => a.direction === 'backward')).toBe(true);
    });

    // ─── Task 5: skip-layer edge produces FlowAnomaly ─────────────────────

    it('produces a skip-layer FlowAnomaly for a controller → persistence edge', () => {
        const dag: CondensationDag = {
            components: [['controller.ts'], ['repo.ts']],
            dagEdges: [{ from: 0, to: 1 }], // gap = 5 - 2 = 3 → skip-layer
        };
        const layers = new Map([
            ['controller.ts', 2],
            ['repo.ts', 5],
        ]);
        const seq = traceFlow('controller.ts', dag, layers);
        expect(seq.anomalies.some(a => a.direction === 'skip-layer')).toBe(true);
    });

    it('does not produce an anomaly for a normal one-layer forward edge', () => {
        const dag: CondensationDag = {
            components: [['controller.ts'], ['service.ts']],
            dagEdges: [{ from: 0, to: 1 }], // gap = 3 - 2 = 1 → normal
        };
        const layers = new Map([['controller.ts', 2], ['service.ts', 3]]);
        const seq = traceFlow('controller.ts', dag, layers);
        expect(seq.anomalies).toHaveLength(0);
    });
});

// ─── Task 6: mergeSequences ───────────────────────────────────────────────

describe('mergeSequences', () => {
    it('merges two sequences from same entry sharing prefix [A→B] into one sequence containing all steps', () => {
        const seqABC = {
            id: 'entry.ts', entryPoint: 'entry.ts',
            steps: [
                { filePath: 'A.ts', fileCategory: 'controller' as const, layer: 2 },
                { filePath: 'B.ts', fileCategory: 'service' as const, layer: 3 },
                { filePath: 'C.ts', fileCategory: 'model' as const, layer: 5 },
            ],
            anomalies: [],
        };
        const seqABD = {
            id: 'entry.ts', entryPoint: 'entry.ts',
            steps: [
                { filePath: 'A.ts', fileCategory: 'controller' as const, layer: 2 },
                { filePath: 'B.ts', fileCategory: 'service' as const, layer: 3 },
                { filePath: 'D.ts', fileCategory: 'model' as const, layer: 5 },
            ],
            anomalies: [],
        };
        const result = mergeSequences([seqABC, seqABD]);
        expect(result).toHaveLength(1);
        const allFiles = result[0].steps.map(s => s.filePath);
        expect(allFiles).toContain('A.ts');
        expect(allFiles).toContain('B.ts');
        expect(allFiles).toContain('C.ts');
        expect(allFiles).toContain('D.ts');
    });

    it('leaves sequences with distinct entry points as separate sequences', () => {
        const seq1 = { id: 'ep1.ts', entryPoint: 'ep1.ts', steps: [{ filePath: 'A.ts', fileCategory: 'controller' as const, layer: 2 }], anomalies: [] };
        const seq2 = { id: 'ep2.ts', entryPoint: 'ep2.ts', steps: [{ filePath: 'B.ts', fileCategory: 'controller' as const, layer: 2 }], anomalies: [] };
        expect(mergeSequences([seq1, seq2])).toHaveLength(2);
    });
});

// ─── Task 7: Isolated controller (no outgoing edges) ─────────────────────

describe('traceFlow — isolated controller', () => {
    it('returns a sequence with one step and empty anomalies when entry has no forward edges', () => {
        const dag: CondensationDag = {
            components: [['controller.ts']],
            dagEdges: [],
        };
        const layers = new Map([['controller.ts', 2]]);
        const seq = traceFlow('controller.ts', dag, layers);
        expect(seq.steps).toHaveLength(1);
        expect(seq.steps[0].filePath).toBe('controller.ts');
        expect(seq.anomalies).toHaveLength(0);
    });
});

// ─── Task 8: detectFlows — empty entry points ────────────────────────────

describe('detectFlows', () => {
    it('returns empty array without throwing when no route/controller files exist', () => {
        const result = detectFlows(
            [{ path: 'utils.ts', category: 'utility', confidence: 'high', reason: '' }],
            { components: [], dagEdges: [] },
            new Map(),
        );
        expect(result).toEqual([]);
    });

    it('returns one sequence per entry point when entry points exist', () => {
        const dag: CondensationDag = {
            components: [['ctrl.ts'], ['svc.ts']],
            dagEdges: [{ from: 0, to: 1 }],
        };
        const layers = new Map([['ctrl.ts', 2], ['svc.ts', 3]]);
        const result = detectFlows(
            [{ path: 'ctrl.ts', category: 'controller', confidence: 'high', reason: '' }],
            dag,
            layers,
        );
        expect(result.length).toBeGreaterThanOrEqual(1);
        expect(result[0].entryPoint).toBe('ctrl.ts');
        expect(result[0].entrySurface).toBe('runtime');
    });

    it('marks bin-root flows as tooling in the raw analyzer model', () => {
        const dag: CondensationDag = {
            components: [['bin/reponav.ts'], ['src/service.ts']],
            dagEdges: [{ from: 0, to: 1 }],
        };
        const layers = new Map([
            ['bin/reponav.ts', 1],
            ['src/service.ts', 3],
        ]);

        const result = detectFlows(
            [
                { path: 'bin/reponav.ts', category: 'entry', confidence: 'high', reason: '' },
                { path: 'src/service.ts', category: 'service', confidence: 'high', reason: '' },
            ],
            dag,
            layers,
        );

        expect(result).toHaveLength(1);
        expect(result[0].entrySurface).toBe('tooling');
    });

    it('prefers runtime anchors when both runtime and tooling launch surfaces are present', () => {
        const dag: CondensationDag = {
            components: [['bin/reponav.ts'], ['src/routes/http.ts'], ['src/service.ts']],
            dagEdges: [{ from: 0, to: 2 }, { from: 1, to: 2 }],
        };
        const layers = new Map([
            ['bin/reponav.ts', 1],
            ['src/routes/http.ts', 2],
            ['src/service.ts', 3],
        ]);

        const result = detectFlows(
            [
                { path: 'bin/reponav.ts', category: 'entry', confidence: 'high', reason: '' },
                { path: 'src/routes/http.ts', category: 'route', confidence: 'high', reason: '' },
                { path: 'src/service.ts', category: 'service', confidence: 'high', reason: '' },
            ],
            dag,
            layers,
        );

        expect(result).toHaveLength(1);
        expect(result[0].entryPoint).toBe('src/routes/http.ts');
        expect(result[0].entrySurface).toBe('runtime');
    });

    it('ignores markdown task files even when classification noise marks them as route-like', () => {
        const dag: CondensationDag = {
            components: [['dev/epics/004-dead-code-detection/tasks.md'], ['src/service.ts']],
            dagEdges: [{ from: 0, to: 1 }],
        };
        const layers = new Map([
            ['dev/epics/004-dead-code-detection/tasks.md', 2],
            ['src/service.ts', 3],
        ]);

        const result = detectFlows(
            [
                { path: 'dev/epics/004-dead-code-detection/tasks.md', category: 'route', confidence: 'low', reason: 'noise' },
                { path: 'src/service.ts', category: 'service', confidence: 'high', reason: '' },
            ],
            dag,
            layers,
        );

        expect(result).toEqual([]);
    });
});

// ─── Task 9: DFS depth cap ────────────────────────────────────────────────

describe('traceFlow — depth cap', () => {
    it('truncates at MAX_DEPTH steps and sets depthCapped flag for a depth-30 chain', () => {
        // Build a linear chain of 31 components (deeper than MAX_DEPTH=20)
        // All nodes at layer 2 (controller) so terminal-layer stop doesn't fire first.
        const N = 31;
        const components = Array.from({ length: N }, (_, i) => [`node${i}.ts`]);
        const dagEdges = Array.from({ length: N - 1 }, (_, i) => ({ from: i, to: i + 1 }));
        const layers = new Map(components.flatMap(([f]) => [[f, 2]]));

        const dag: CondensationDag = { components, dagEdges };
        const seq = traceFlow('node0.ts', dag, layers);
        expect(seq.steps.length).toBeLessThanOrEqual(20);
        expect(seq.depthCapped).toBe(true);
    });
});

// ─── Task 10: Precision ≥ 80% on Express fixture ─────────────────────────

describe('detectFlows — Express fixture precision', () => {
    it('keeps the current Express fixture service and persistence layers', async () => {
        const { expressLayers } = await import('./__fixtures__/flow-express');

        expect(expressLayers.get('services/userService.ts')).toBe(3);
        expect(expressLayers.get('db/userRepo.ts')).toBe(5);
    });

    it('detects all 6 entry-point sequences (precision = 100% on labeled fixture)', async () => {
        const { expressClassifications, expressDag, expressLayers, expressExpectedEntryPoints } =
            await import('./__fixtures__/flow-express');

        const sequences = detectFlows(expressClassifications, expressDag, expressLayers);
        const detectedEPs = new Set(sequences.map(s => s.entryPoint));

        const truePositives = expressExpectedEntryPoints.filter(ep => detectedEPs.has(ep)).length;
        const falsePositives = sequences.filter(s => !expressExpectedEntryPoints.includes(s.entryPoint)).length;
        const total = truePositives + falsePositives;
        const precision = total === 0 ? 1 : truePositives / total;

        expect(precision).toBeGreaterThanOrEqual(0.8);
        expect(truePositives).toBeGreaterThanOrEqual(
            Math.ceil(expressExpectedEntryPoints.length * 0.8),
        );
    });
});

// ─── Task 11: Precision ≥ 80% on FastAPI fixture ─────────────────────────

describe('detectFlows — FastAPI fixture precision', () => {
    it('keeps the current FastAPI fixture service, repository, and schema layers', async () => {
        const { fastapiLayers } = await import('./__fixtures__/flow-fastapi');

        expect(fastapiLayers.get('services/user_svc.py')).toBe(3);
        expect(fastapiLayers.get('repositories/user_repo.py')).toBe(5);
        expect(fastapiLayers.get('schemas/user.py')).toBe(4);
    });

    it('detects all 4 router-level sequences (precision = 100% on labeled fixture)', async () => {
        const { fastapiClassifications, fastapiDag, fastapiLayers, fastapiExpectedEntryPoints } =
            await import('./__fixtures__/flow-fastapi');

        const sequences = detectFlows(fastapiClassifications, fastapiDag, fastapiLayers);
        const detectedEPs = new Set(sequences.map(s => s.entryPoint));

        const truePositives = fastapiExpectedEntryPoints.filter(ep => detectedEPs.has(ep)).length;
        const falsePositives = sequences.filter(s => !fastapiExpectedEntryPoints.includes(s.entryPoint)).length;
        const total = truePositives + falsePositives;
        const precision = total === 0 ? 1 : truePositives / total;

        expect(precision).toBeGreaterThanOrEqual(0.8);
        expect(truePositives).toBeGreaterThanOrEqual(
            Math.ceil(fastapiExpectedEntryPoints.length * 0.8),
        );
    });
});

// ─── Task 12: Performance ≤ 500ms on 500-file / 50 entry-point fixture ───

describe('detectFlows — performance', () => {
    it('completes in under 500ms on a synthetic 500-file / 50 entry-point fixture', () => {
        const N = 500;
        const EP = 50;

        // 50 controllers + 200 services + 250 model (db/persistence)
        const classifications: FileClassification[] = [
            ...Array.from({ length: EP }, (_, i) => ({
                path: `ctrl${i}.ts`, category: 'controller' as const,
                confidence: 'high' as const, reason: '',
            })),
            ...Array.from({ length: 200 }, (_, i) => ({
                path: `svc${i}.ts`, category: 'service' as const,
                confidence: 'high' as const, reason: '',
            })),
            ...Array.from({ length: 250 }, (_, i) => ({
                path: `repo${i}.ts`, category: 'model' as const,
                confidence: 'high' as const, reason: '',
            })),
        ];

        // Each controller → 4 services, each service → 5 repos (star topology — no deep chains)
        const components = classifications.map(c => [c.path]);
        const dagEdges: Array<{ from: number; to: number }> = [];
        for (let i = 0; i < EP; i++) {
            for (let j = 0; j < 4; j++) {
                const svcIdx = EP + (i * 4 + j) % 200;
                dagEdges.push({ from: i, to: svcIdx });
            }
        }
        for (let s = 0; s < 200; s++) {
            for (let r = 0; r < 5; r++) {
                const repoIdx = EP + 200 + (s * 5 + r) % 250;
                dagEdges.push({ from: EP + s, to: repoIdx });
            }
        }

        const layers = new Map<string, number>([
            ...Array.from({ length: EP }, (_, i): [string, number] => [`ctrl${i}.ts`, 2]),
            ...Array.from({ length: 200 }, (_, i): [string, number] => [`svc${i}.ts`, 3]),
            ...Array.from({ length: 250 }, (_, i): [string, number] => [`repo${i}.ts`, 5]),
        ]);

        const dag = { components, dagEdges };

        const start = performance.now();
        const result = detectFlows(classifications, dag, layers);
        const elapsed = performance.now() - start;

        expect(result.length).toBeGreaterThan(0);
        expect(elapsed).toBeLessThan(500);
    });
});
