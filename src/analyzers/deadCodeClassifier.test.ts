import { describe, it, expect } from 'vitest';
import type { SymbolInfo, SymbolEdge, BoundaryRoleAnnotation } from '../types';
import {
    collectCalleeIds,
    computeDeadCode,
} from './deadCodeClassifier';

// ─── Fixtures ───────────────────────────────────────────────────────────────

function sym(overrides: Partial<SymbolInfo> & { name: string; filePath: string }): SymbolInfo {
    return {
        kind: 'function',
        lineStart: 1,
        lineEnd: 10,
        isExported: false,
        isEntryPoint: false,
        ...overrides,
    };
}

function edge(sourceName: string, targetName: string, targetFile = 'src/b.ts'): SymbolEdge {
    return {
        sourceFile: 'src/a.ts',
        sourceName,
        targetFile,
        targetName,
        edgeType: 'calls',
        lineNumber: 5,
    };
}

function boundaryRole(filePath: string, role: BoundaryRoleAnnotation['role']): BoundaryRoleAnnotation {
    return { filePath, role, evidence: `imports ${role} package` };
}

// ─── T1: collectCalleeIds ────────────────────────────────────────────────────

describe('collectCalleeIds', () => {
    it('returns a Set of targetName from edges', () => {
        const edges = [edge('caller', 'B'), edge('callerX', 'C')];
        const ids = collectCalleeIds(edges);
        expect(ids.has('B')).toBe(true);
        expect(ids.has('C')).toBe(true);
        expect(ids.size).toBe(2);
    });

    it('returns empty Set for empty edges', () => {
        expect(collectCalleeIds([])).toEqual(new Set());
    });
});

// ─── T2: Pass 1 — symbols with callers excluded ──────────────────────────────

describe('computeDeadCode - Pass 1: exclude symbols with callers', () => {
    it('does not flag symbol B that appears as a callee', () => {
        const symbols = [sym({ name: 'B', filePath: 'src/b.ts' })];
        const edges = [edge('A', 'B', 'src/b.ts')];
        const result = computeDeadCode(symbols, edges, []);
        expect(result.map(c => c.symbolName)).not.toContain('B');
    });
});

// ─── T3: Pass 2 — exported symbols excluded ──────────────────────────────────

describe('computeDeadCode - Pass 2: exclude exported symbols', () => {
    it('does not flag an exported symbol', () => {
        const symbols = [sym({ name: 'Exported', filePath: 'src/a.ts', isExported: true })];
        const result = computeDeadCode(symbols, [], []);
        expect(result.map(c => c.symbolName)).not.toContain('Exported');
    });

    it('flags a non-exported symbol with no callers', () => {
        const symbols = [sym({ name: 'Hidden', filePath: 'src/a.ts', isExported: false })];
        const result = computeDeadCode(symbols, [], []);
        expect(result.map(c => c.symbolName)).toContain('Hidden');
    });
});

// ─── T4: Pass 3 — entry point symbols excluded ───────────────────────────────

describe('computeDeadCode - Pass 3: exclude entry-point symbols', () => {
    it('excludes symbols in entry point files', () => {
        const symbols = [sym({ name: 'activate', filePath: 'src/extension.ts', isEntryPoint: true })];
        const result = computeDeadCode(symbols, [], []);
        expect(result.map(c => c.symbolName)).not.toContain('activate');
    });

    it('still evaluates non-entry symbols in entry point file', () => {
        const symbols = [
            sym({ name: 'activate', filePath: 'src/extension.ts', isEntryPoint: true }),
            sym({ name: 'helperFn', filePath: 'src/extension.ts' }),
        ];
        const result = computeDeadCode(symbols, [], []);
        // activate is entry, helperFn is not — only helperFn can be dead
        expect(result.map(c => c.symbolName)).not.toContain('activate');
        expect(result.map(c => c.symbolName)).toContain('helperFn');
    });
});

// ─── T5: Pass 4 — boundary-role files excluded (http + persistence only) ─────

describe('computeDeadCode - Pass 4: exclude http and persistence boundary files', () => {
    it.each<readonly [string, string, string, import('../types').BoundaryRole, boolean]>([
        ['http', 'src/api.ts', 'routeHandler', 'http', false],
        ['persistence', 'src/repo.ts', 'findUser', 'persistence', false],
        ['messaging', 'src/bus.ts', 'publishEvent', 'messaging', true],
        ['auth', 'src/auth.ts', 'verifyToken', 'auth', true],
    ])('handles %s boundary symbols as expected', (_label, filePath, symbolName, role, shouldRemain) => {
        const symbols = [sym({ name: symbolName, filePath })];
        const roles = [boundaryRole(filePath, role)];
        const result = computeDeadCode(symbols, [], roles);
        const symbolNames = result.map(c => c.symbolName);
        if (shouldRemain) {
            expect(symbolNames).toContain(symbolName);
            return;
        }
        expect(symbolNames).not.toContain(symbolName);
    });
});

// ─── T6: Pass 5 — test-only files excluded ───────────────────────────────────

describe('computeDeadCode - Pass 5: exclude test files', () => {
    it.each<readonly [string, string]>([
        ['src/foo.test.ts', 'setup'],
        ['src/foo.spec.ts', 'helper'],
        ['test/utils.ts', 'mockFn'],
    ])('excludes %s from dead-code candidates', (filePath, symbolName) => {
        const symbols = [sym({ name: symbolName, filePath })];
        const result = computeDeadCode(symbols, [], []);
        expect(result.map(c => c.symbolName)).not.toContain(symbolName);
    });
});

// ─── T7: Compose all passes ───────────────────────────────────────────────────

describe('computeDeadCode - full composition', () => {
    it('returns exactly the uncovered symbols with reason and confidence', () => {
        const symbols = [
            sym({ name: 'A', filePath: 'src/a.ts' }), // has callers
            sym({ name: 'B', filePath: 'src/a.ts' }), // has callers
            sym({ name: 'C', filePath: 'src/a.ts' }), // has callers
            sym({ name: 'Exported1', filePath: 'src/a.ts', isExported: true }),
            sym({ name: 'Exported2', filePath: 'src/a.ts', isExported: true }),
            sym({ name: 'EntryFn', filePath: 'src/index.ts', isEntryPoint: true }),
            sym({ name: 'RouteX', filePath: 'src/api.ts' }),
            sym({ name: 'TestHelper', filePath: 'src/a.test.ts' }),
            sym({ name: 'Dead1', filePath: 'src/a.ts' }), // dead
            sym({ name: 'Dead2', filePath: 'src/b.ts' }), // dead
        ];
        const edges = [
            edge('Caller', 'A', 'src/a.ts'),
            edge('Caller', 'B', 'src/a.ts'),
            edge('Caller', 'C', 'src/a.ts'),
        ];
        const roles = [boundaryRole('src/api.ts', 'http')];


        const result = computeDeadCode(symbols, edges, roles);

        expect(result).toHaveLength(2);
        const names = result.map(c => c.symbolName);
        expect(names).toContain('Dead1');
        expect(names).toContain('Dead2');

        for (const c of result) {
            expect(c.filePath).toBeTruthy();
            expect(c.lineStart).toBeGreaterThan(0);
            expect(c.reason).toBeTruthy();
            expect(c.confidence).toBeGreaterThanOrEqual(0);
            expect(c.confidence).toBeLessThanOrEqual(1);
        }
    });
});

// ─── T8: Edge case — type_alias and interface not flagged ─────────────────────

describe('computeDeadCode - type_alias and interface excluded', () => {
    it('does not flag type_alias symbols', () => {
        const symbols = [sym({ name: 'MyType', filePath: 'src/a.ts', kind: 'type_alias' })];
        const result = computeDeadCode(symbols, [], []);
        expect(result.map(c => c.symbolName)).not.toContain('MyType');
    });

    it('does not flag interface symbols', () => {
        const symbols = [sym({ name: 'MyInterface', filePath: 'src/a.ts', kind: 'interface' })];
        const result = computeDeadCode(symbols, [], []);
        expect(result.map(c => c.symbolName)).not.toContain('MyInterface');
    });
});

// ─── T9: Pass 8 — class members (parentSymbol set) excluded ──────────────────

describe('computeDeadCode - Pass 8: exclude class members', () => {
    it.each<readonly [string, import('../types').SymbolKind, string | undefined]>([
        ['walkDir', 'function', 'LocalWorkspaceAdapter'],
        ['constructor', 'constructor', 'LocalWorkspaceAdapter'],
    ])('does not flag class member %s', (symbolName, kind, parentSymbol) => {
        const symbols = [sym({ name: symbolName, filePath: 'src/adapter.ts', kind, parentSymbol })];
        const result = computeDeadCode(symbols, [], []);
        expect(result.map(c => c.symbolName)).not.toContain(symbolName);
    });

    it('still flags a standalone function with no parentSymbol and no callers', () => {
        const symbols = [sym({ name: 'orphanFn', filePath: 'src/a.ts' })];
        const result = computeDeadCode(symbols, [], []);
        expect(result.map(c => c.symbolName)).toContain('orphanFn');
    });
});

// ─── T9: Edge case — node_modules symbols not flagged ─────────────────────────

describe('computeDeadCode - node_modules excluded', () => {
    it('does not flag symbols from node_modules/', () => {
        const symbols = [sym({ name: 'externalFn', filePath: 'node_modules/some-lib/index.ts' })];
        const result = computeDeadCode(symbols, [], []);
        expect(result.map(c => c.symbolName)).not.toContain('externalFn');
    });
});

// ─── T10+T11: Precision and recall on labeled fixture ─────────────────────────

describe('computeDeadCode - precision and recall', () => {
    // 20-symbol labeled fixture: 12 truly dead, 8 truly live
    // truly live: 3 with callers, 2 exported, 1 entry, 1 http-boundary, 1 test-file
    // truly dead: 12 uncalled, unexported, not entry, not boundary, not test
    const buildLabeledFixture = () => {
        const symbols: SymbolInfo[] = [
            // truly live — have callers (3)
            sym({ name: 'CalledA', filePath: 'src/core.ts' }),
            sym({ name: 'CalledB', filePath: 'src/core.ts' }),
            sym({ name: 'CalledC', filePath: 'src/core.ts' }),
            // truly live — exported (2)
            sym({ name: 'ExportedX', filePath: 'src/core.ts', isExported: true }),
            sym({ name: 'ExportedY', filePath: 'src/core.ts', isExported: true }),
            // truly live — entry point (1)
            sym({ name: 'entryFn', filePath: 'src/entry.ts', isEntryPoint: true }),
            // truly live — http boundary (1)
            sym({ name: 'httpHandler', filePath: 'src/http.ts' }),
            // truly live — test file (1)
            sym({ name: 'testHelper', filePath: 'src/core.test.ts' }),
            // truly dead (12)
            sym({ name: 'Dead1', filePath: 'src/a.ts' }),
            sym({ name: 'Dead2', filePath: 'src/a.ts' }),
            sym({ name: 'Dead3', filePath: 'src/b.ts' }),
            sym({ name: 'Dead4', filePath: 'src/b.ts' }),
            sym({ name: 'Dead5', filePath: 'src/c.ts' }),
            sym({ name: 'Dead6', filePath: 'src/c.ts' }),
            sym({ name: 'Dead7', filePath: 'src/d.ts' }),
            sym({ name: 'Dead8', filePath: 'src/d.ts' }),
            sym({ name: 'Dead9', filePath: 'src/e.ts' }),
            sym({ name: 'Dead10', filePath: 'src/e.ts' }),
            sym({ name: 'Dead11', filePath: 'src/f.ts' }),
            sym({ name: 'Dead12', filePath: 'src/f.ts' }),
        ];
        const edges: SymbolEdge[] = [
            { sourceFile: 'src/main.ts', sourceName: 'main', targetFile: 'src/core.ts', targetName: 'CalledA', edgeType: 'calls', lineNumber: 1 },
            { sourceFile: 'src/main.ts', sourceName: 'main', targetFile: 'src/core.ts', targetName: 'CalledB', edgeType: 'calls', lineNumber: 2 },
            { sourceFile: 'src/main.ts', sourceName: 'main', targetFile: 'src/core.ts', targetName: 'CalledC', edgeType: 'calls', lineNumber: 3 },
        ];
        const roles: BoundaryRoleAnnotation[] = [boundaryRole('src/http.ts', 'http')];
        const trulyDead = new Set(['Dead1','Dead2','Dead3','Dead4','Dead5','Dead6','Dead7','Dead8','Dead9','Dead10','Dead11','Dead12']);
        return { symbols, edges, roles, trulyDead };
    };

    it('achieves precision >= 0.85', () => {
        const { symbols, edges, roles, trulyDead } = buildLabeledFixture();
        const candidates = computeDeadCode(symbols, edges, roles);
        const truePositives = candidates.filter(c => trulyDead.has(c.symbolName)).length;
        const falsePositives = candidates.filter(c => !trulyDead.has(c.symbolName)).length;
        const precision = truePositives / (truePositives + falsePositives);
        expect(precision).toBeGreaterThanOrEqual(0.85);
    });

    it('achieves recall >= 0.70', () => {
        const { symbols, edges, roles, trulyDead } = buildLabeledFixture();
        const candidates = computeDeadCode(symbols, edges, roles);
        const truePositives = candidates.filter(c => trulyDead.has(c.symbolName)).length;
        const falseNegatives = trulyDead.size - truePositives;
        const recall = truePositives / (truePositives + falseNegatives);
        expect(recall).toBeGreaterThanOrEqual(0.70);
    });
});

// ─── T12: Performance ─────────────────────────────────────────────────────────

describe('computeDeadCode - performance', () => {
    it('completes in < 500ms for 1000 symbols / 2000 edges', () => {
        const symbols: SymbolInfo[] = Array.from({ length: 1000 }, (_, i) =>
            sym({ name: `fn${i}`, filePath: `src/file${i % 50}.ts` })
        );
        const edges: SymbolEdge[] = Array.from({ length: 2000 }, (_, i) => ({
            sourceFile: `src/file${i % 50}.ts`,
            sourceName: `fn${i % 500 + 500}`,
            targetFile: `src/file${i % 50}.ts`,
            targetName: `fn${i % 500}`,
            edgeType: 'calls' as const,
            lineNumber: 1,
        }));
        const start = performance.now();
        computeDeadCode(symbols, edges, []);
        const duration = performance.now() - start;
        expect(duration).toBeLessThan(500);
    });
});
