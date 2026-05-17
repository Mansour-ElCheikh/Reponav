import { describe, it, expect } from 'vitest';
import type { ImportEdge, LayerViolation } from '../types';
import { buildCondensationDag, assignLayers, detectViolations } from './layerDag';

/** Utility: build ImportEdge from source → target */
function edge(source: string, target: string): ImportEdge {
    return { source, target, specifiers: [], isDynamic: false, rawStatement: '' };
}

// ─── Task 10: Tarjan SCC → condensation DAG ───────────────────────────────

describe('buildCondensationDag', () => {
    it('returns a DAG with no cycles for a graph with 2 separate SCCs', () => {
        const edges = [edge('a', 'b'), edge('b', 'c')];
        const dag = buildCondensationDag(['a', 'b', 'c'], edges);
        expect(dag.components.length).toBe(3); // each node is its own SCC
        expect(dag.dagEdges.length).toBeGreaterThanOrEqual(2);
    });

    it('collapses a cycle (a→b→a) into a single SCC component', () => {
        const edges = [edge('a', 'b'), edge('b', 'a'), edge('a', 'c')];
        const dag = buildCondensationDag(['a', 'b', 'c'], edges);
        const twoNodeComp = dag.components.find(c => c.length === 2);
        expect(twoNodeComp).toBeDefined();
    });
});

// ─── Task 11: Layer assignment ────────────────────────────────────────────

describe('assignLayers', () => {
    it('assigns numeric layers matching expected ordering for entry/service/persistence', () => {
        const files = ['src/app.ts', 'src/userService.ts', 'src/db.ts'];
        const categories = new Map([
            ['src/app.ts', 'entry'],
            ['src/userService.ts', 'service'],
            ['src/db.ts', 'persistence'],
        ]);
        const layers = assignLayers(files, categories);
        expect(layers.get('src/app.ts')!).toBeLessThan(layers.get('src/userService.ts')!);
        expect(layers.get('src/userService.ts')!).toBeLessThan(layers.get('src/db.ts')!);
    });

    it('assigns layer 1 for files with category "entry"', () => {
        const categories = new Map([['src/extension.ts', 'entry']]);
        const layers = assignLayers(['src/extension.ts'], categories);
        expect(layers.get('src/extension.ts')).toBe(1);
    });

    it('non-entry categories (test, config, library) are unaffected by the key rename', () => {
        const categories = new Map([
            ['a.test.ts', 'test'],
            ['tsconfig.json', 'config'],
            ['utils.ts', 'utility'],
        ]);
        const layers = assignLayers(['a.test.ts', 'tsconfig.json', 'utils.ts'], categories);
        expect(layers.get('a.test.ts')).toBe(-2);
        expect(layers.get('tsconfig.json')).toBe(0);
        expect(layers.get('utils.ts')).toBe(0);
    });
});

// ─── Task 12: Backward violation detection ───────────────────────────────

describe('detectViolations', () => {
    it('detects backward violation when db.ts imports controller.ts (layer 5→2, against flow)', () => {
        const layers = new Map([
            ['db.ts', 5],
            ['controller.ts', 2],
        ]);
        const edges = [edge('db.ts', 'controller.ts')]; // persistence importing controller = true reversal
        const violations = detectViolations(edges, layers);
        expect(violations.some(v => v.direction === 'backward')).toBe(true);
        expect(violations[0].sourceFile).toBe('db.ts');
        expect(violations[0].targetFile).toBe('controller.ts');
    });

    // ─── Task 13: Skip-layer violation ─────────────────────────────────

    it('detects skip-layer violation when route.ts imports model.ts (layer 1→4)', () => {
        const layers = new Map([
            ['route.ts', 1],
            ['controller.ts', 2],
            ['service.ts', 3],
            ['model.ts', 4],
        ]);
        const edges = [edge('route.ts', 'model.ts')]; // skips controller + service
        const violations = detectViolations(edges, layers);
        expect(violations.some(v => v.direction === 'skip-layer')).toBe(true);
    });

    // ─── Task 14: Zero false positives on clean fixture ───────────────

    it('returns empty array for a well-layered dependency graph', () => {
        const layers = new Map([
            ['entry.ts', 1],
            ['service.ts', 2],
            ['repo.ts', 3],
        ]);
        const edges = [edge('entry.ts', 'service.ts'), edge('service.ts', 'repo.ts')];
        const violations = detectViolations(edges, layers);
        expect(violations).toHaveLength(0);
    });

    // ─── Task 15: Utility file exemption ─────────────────────────────

    it('does not report violations for utility files (layer 0)', () => {
        const layers = new Map([
            ['entry.ts', 1],
            ['service.ts', 3],
            ['utils.ts', 0], // utility — exempt from violation reporting
        ]);
        const edges = [
            edge('entry.ts', 'utils.ts'),
            edge('service.ts', 'utils.ts'),
        ];
        const violations = detectViolations(edges, layers);
        expect(violations).toHaveLength(0);
    });

    // ─── Task 16: Unknown layer ───────────────────────────────────────

    it('uses unknown (-1) for files with no assigned layer, no violations reported for them', () => {
        const layers = new Map([
            ['known.ts', 2],
            // unknown.ts → not in map
        ]);
        const edges = [edge('known.ts', 'unknown.ts')];
        const violations = detectViolations(edges, layers);
        // Unknown layer targets are not reported as violations
        expect(violations).toHaveLength(0);
    });

    // ─── Task 17: Intra-SCC edges ────────────────────────────────────

    it('skips intra-SCC edges (circular deps within same SCC component)', () => {
        const layers = new Map([
            ['a.ts', 1],
            ['b.ts', 1], // same layer, same SCC
        ]);
        const edges = [edge('a.ts', 'b.ts'), edge('b.ts', 'a.ts')];
        // Same-layer edges are not violations
        const violations = detectViolations(edges, layers);
        expect(violations).toHaveLength(0);
    });

    // ─── Task 18: Performance ────────────────────────────────────────

    it('completes in ≤200ms for 1K-file fixture', () => {
        const layers = new Map<string, number>();
        const edges: ImportEdge[] = [];
        for (let i = 0; i < 1000; i++) {
            layers.set(`file${i}.ts`, i % 5 + 1);
        }
        // Clean forward edges (no violations)
        for (let i = 0; i < 900; i++) {
            edges.push(edge(`file${i}.ts`, `file${i + 1}.ts`));
        }
        const start = performance.now();
        detectViolations(edges, layers);
        expect(performance.now() - start).toBeLessThan(200);
    });
});
