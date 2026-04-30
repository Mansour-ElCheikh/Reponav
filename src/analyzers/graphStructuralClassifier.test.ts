/**
 * Tests for graphStructuralClassifier (Pass 4).
 *
 * Each test maps 1:1 to a task row in tasks.md for epic 009.
 */
import { describe, it, expect } from 'vitest';
import type { FileClassification, ImportEdge } from '../types';
import { enrichWithGraphStructure } from './graphStructuralClassifier';

// ─── Helpers ─────────────────────────────────────────────────────────────────

// Shorthand to build a classification entry
function fc(path: string, category: string, confidence: 'high' | 'medium' | 'low' = 'high', reason = 'test'): FileClassification {
    return { path, category: category as FileClassification['category'], confidence, reason };
}

// Shorthand to build an import edge
function edge(source: string, target: string, specifiers: string[] = ['default'], isDynamic = false): ImportEdge {
    return { source, target, specifiers, isDynamic, rawStatement: `import from '${target}'` };
}

// ─── Task 1: high-fanIn + zero-fanOut → utility ─────────────────────────────

describe('graphStructuralClassifier — Pass 4', () => {
    it('T1: high-fanIn + zero-fanOut → utility (medium confidence)', () => {
        // File imported by 3+ others but imports nothing except types
        const classifications: FileClassification[] = [
            fc('src/helpers/format.ts', 'unknown', 'low', 'unclassified'),
            fc('src/services/auth.ts', 'service', 'high'),
            fc('src/services/user.ts', 'service', 'high'),
            fc('src/routes/api.ts', 'route', 'high'),
        ];
        const edges: ImportEdge[] = [
            edge('src/services/auth.ts', 'src/helpers/format.ts'),
            edge('src/services/user.ts', 'src/helpers/format.ts'),
            edge('src/routes/api.ts', 'src/helpers/format.ts'),
        ];

        const result = enrichWithGraphStructure(classifications, edges);
        const classified = result.find(c => c.path === 'src/helpers/format.ts')!;
        expect(classified.category).toBe('utility');
        expect(classified.confidence).toBe('medium');
    });

    it('T1b: keeps the current high-fanIn threshold at three importers', () => {
        const classifications: FileClassification[] = [
            fc('src/helpers/format.ts', 'unknown', 'low', 'unclassified'),
            fc('src/services/auth.ts', 'service', 'high'),
            fc('src/services/user.ts', 'service', 'high'),
            fc('src/routes/api.ts', 'route', 'high'),
        ];
        const edges: ImportEdge[] = [
            edge('src/services/auth.ts', 'src/helpers/format.ts'),
            edge('src/services/user.ts', 'src/helpers/format.ts'),
            edge('src/routes/api.ts', 'src/helpers/format.ts'),
        ];

        const result = enrichWithGraphStructure(classifications, edges);
        const classified = result.find(c => c.path === 'src/helpers/format.ts')!;

        expect(classified.reason).toContain('high fanIn (3), zero fanOut');
    });

    // ─── Task 2: sole external SDK importer → service ───────────────────────

    it('T2: sole external SDK importer → service (medium confidence)', () => {
        // File is the only one importing an external package (stripe)
        const classifications: FileClassification[] = [
            fc('src/payments/stripe.ts', 'unknown', 'low', 'unclassified'),
            fc('src/services/auth.ts', 'service', 'high'),
        ];
        const edges: ImportEdge[] = [
            edge('src/payments/stripe.ts', 'stripe', ['Stripe']),
            edge('src/services/auth.ts', 'src/payments/stripe.ts'),
        ];

        const result = enrichWithGraphStructure(classifications, edges);
        const classified = result.find(c => c.path === 'src/payments/stripe.ts')!;
        expect(classified.category).toBe('service');
        expect(classified.confidence).toBe('medium');
    });

    // ─── Task 3: imported only by tests → utility (test helper) ─────────────

    it('T3: imported only by tests → utility (low confidence)', () => {
        const classifications: FileClassification[] = [
            fc('src/testUtils/factory.ts', 'unknown', 'low', 'unclassified'),
            fc('src/services/auth.test.ts', 'test', 'high'),
            fc('src/services/user.test.ts', 'test', 'high'),
        ];
        const edges: ImportEdge[] = [
            edge('src/services/auth.test.ts', 'src/testUtils/factory.ts'),
            edge('src/services/user.test.ts', 'src/testUtils/factory.ts'),
        ];

        const result = enrichWithGraphStructure(classifications, edges);
        const classified = result.find(c => c.path === 'src/testUtils/factory.ts')!;
        expect(classified.category).toBe('utility');
        expect(classified.confidence).toBe('low');
    });

    // ─── Task 4: majority-neighbor category propagation ─────────────────────

    it('T4: majority-neighbor category propagation (low confidence)', () => {
        // Unknown file where ≥60% of non-unknown neighbors share same category
        const classifications: FileClassification[] = [
            fc('src/logic/calc.ts', 'unknown', 'low', 'unclassified'),
            fc('src/services/a.ts', 'service', 'high'),
            fc('src/services/b.ts', 'service', 'high'),
            fc('src/services/c.ts', 'service', 'high'),
            fc('src/models/m.ts', 'model', 'high'),
        ];
        const edges: ImportEdge[] = [
            // calc imports 3 services and 1 model → 75% service
            edge('src/logic/calc.ts', 'src/services/a.ts'),
            edge('src/logic/calc.ts', 'src/services/b.ts'),
            edge('src/logic/calc.ts', 'src/services/c.ts'),
            edge('src/logic/calc.ts', 'src/models/m.ts'),
        ];

        const result = enrichWithGraphStructure(classifications, edges);
        const classified = result.find(c => c.path === 'src/logic/calc.ts')!;
        expect(classified.category).toBe('service');
        expect(classified.confidence).toBe('low');
        expect(classified.reason).toContain("75% of neighbors are 'service'");
    });

    // ─── Task 5: type-only exports → type ───────────────────────────────────

    it('T5: exports consumed as type-only → type (medium confidence)', () => {
        // All import edges targeting this file use type-only specifiers
        const classifications: FileClassification[] = [
            fc('src/shared/defs.ts', 'unknown', 'low', 'unclassified'),
            fc('src/services/auth.ts', 'service', 'high'),
            fc('src/services/user.ts', 'service', 'high'),
        ];
        const edges: ImportEdge[] = [
            // rawStatement contains "import type" — that's the signal
            { source: 'src/services/auth.ts', target: 'src/shared/defs.ts', specifiers: ['UserType'], isDynamic: false, rawStatement: "import type { UserType } from '../shared/defs'" },
            { source: 'src/services/user.ts', target: 'src/shared/defs.ts', specifiers: ['UserType'], isDynamic: false, rawStatement: "import type { UserType } from '../shared/defs'" },
        ];

        const result = enrichWithGraphStructure(classifications, edges);
        const classified = result.find(c => c.path === 'src/shared/defs.ts')!;
        expect(classified.category).toBe('type');
        expect(classified.confidence).toBe('medium');
    });

    // ─── Task 6: entry-adjacent single-import → config ──────────────────────

    it('T6: entry-adjacent single-import → config (low confidence)', () => {
        // Unknown file imported only by an entry-classified file, imports nothing
        const classifications: FileClassification[] = [
            fc('src/settings.ts', 'unknown', 'low', 'unclassified'),
            fc('src/main.ts', 'entry', 'high'),
        ];
        const edges: ImportEdge[] = [
            edge('src/main.ts', 'src/settings.ts'),
        ];

        const result = enrichWithGraphStructure(classifications, edges);
        const classified = result.find(c => c.path === 'src/settings.ts')!;
        expect(classified.category).toBe('config');
        expect(classified.confidence).toBe('low');
    });

    // ─── Task 7: never override non-unknown classifications ─────────────────

    it('T7: never overrides non-unknown classifications', () => {
        const classifications: FileClassification[] = [
            fc('src/services/auth.ts', 'service', 'high', 'Pass 1 match'),
            fc('src/models/user.ts', 'model', 'medium', 'Pass 2 match'),
        ];
        const edges: ImportEdge[] = [
            // Even though auth.ts looks like a utility by fanIn/fanOut,
            // it must keep its existing classification
            edge('src/routes/a.ts', 'src/services/auth.ts'),
            edge('src/routes/b.ts', 'src/services/auth.ts'),
            edge('src/routes/c.ts', 'src/services/auth.ts'),
            edge('src/routes/d.ts', 'src/services/auth.ts'),
        ];

        const result = enrichWithGraphStructure(classifications, edges);
        expect(result.find(c => c.path === 'src/services/auth.ts')!.category).toBe('service');
        expect(result.find(c => c.path === 'src/services/auth.ts')!.confidence).toBe('high');
        expect(result.find(c => c.path === 'src/models/user.ts')!.category).toBe('model');
    });

    // ─── Task 8: isolated files stay unknown ────────────────────────────────

    it('T8: files with zero imports and zero importers stay unknown', () => {
        const classifications: FileClassification[] = [
            fc('src/orphan.ts', 'unknown', 'low', 'unclassified'),
        ];
        const edges: ImportEdge[] = [];

        const result = enrichWithGraphStructure(classifications, edges);
        expect(result.find(c => c.path === 'src/orphan.ts')!.category).toBe('unknown');
    });

    // ─── Task 9: performance test ───────────────────────────────────────────

    it('T9: classifies 500 files with 2000 edges in <50ms', () => {
        // Synthetic graph: 500 nodes, 350 unknowns, 2000 edges
        const classifications: FileClassification[] = [];
        for (let i = 0; i < 150; i++) {
            classifications.push(fc(`src/known/${i}.ts`, 'service', 'high'));
        }
        for (let i = 0; i < 350; i++) {
            classifications.push(fc(`src/unknown/${i}.ts`, 'unknown', 'low', 'unclassified'));
        }

        const edges: ImportEdge[] = [];
        for (let i = 0; i < 2000; i++) {
            const src = `src/${Math.random() < 0.3 ? 'known' : 'unknown'}/${Math.floor(Math.random() * (Math.random() < 0.3 ? 150 : 350))}.ts`;
            const dst = `src/${Math.random() < 0.5 ? 'known' : 'unknown'}/${Math.floor(Math.random() * (Math.random() < 0.5 ? 150 : 350))}.ts`;
            edges.push(edge(src, dst));
        }

        const start = performance.now();
        enrichWithGraphStructure(classifications, edges);
        const elapsed = performance.now() - start;
        expect(elapsed).toBeLessThan(50);
    });

    // ─── Conflict resolution: highest confidence wins ───────────────────────

    it('conflict resolution: when multiple heuristics fire, highest confidence wins', () => {
        // File imported only by tests (→ utility low) BUT also has high fanIn / zero fanOut (→ utility medium)
        // Both agree on utility, medium should win over low
        const classifications: FileClassification[] = [
            fc('src/helpers/shared.ts', 'unknown', 'low', 'unclassified'),
            fc('src/a.test.ts', 'test', 'high'),
            fc('src/b.test.ts', 'test', 'high'),
            fc('src/c.test.ts', 'test', 'high'),
        ];
        const edges: ImportEdge[] = [
            edge('src/a.test.ts', 'src/helpers/shared.ts'),
            edge('src/b.test.ts', 'src/helpers/shared.ts'),
            edge('src/c.test.ts', 'src/helpers/shared.ts'),
        ];

        const result = enrichWithGraphStructure(classifications, edges);
        const classified = result.find(c => c.path === 'src/helpers/shared.ts')!;
        expect(classified.category).toBe('utility');
        // High-fanIn heuristic fires at medium confidence, test-only at low — medium wins
        expect(classified.confidence).toBe('medium');
    });

    // ─── Edge case: circular SCC where all neighbors are also unknown ─────────

    it('circular SCC with all-unknown neighbors stays unknown', () => {
        // a→b→c→a — all unknown, no basis for propagation (H5 needs ≥1 non-unknown neighbor)
        const classifications: FileClassification[] = [
            fc('src/a.ts', 'unknown', 'low', 'unclassified'),
            fc('src/b.ts', 'unknown', 'low', 'unclassified'),
            fc('src/c.ts', 'unknown', 'low', 'unclassified'),
        ];
        const edges: ImportEdge[] = [
            edge('src/a.ts', 'src/b.ts'),
            edge('src/b.ts', 'src/c.ts'),
            edge('src/c.ts', 'src/a.ts'),
        ];

        const result = enrichWithGraphStructure(classifications, edges);
        result.forEach(c => expect(c.category).toBe('unknown'));
    });
});
