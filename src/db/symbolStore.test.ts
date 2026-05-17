import { describe, it, expect, vi } from 'vitest';
import type { SymbolInfo, SymbolEdge } from '../types';
import {
    upsertSymbolRecord,
    getSymbolsForFile,
    clearSymbolsForFile,
    insertSymbolEdgeRecord,
    getSymbolCalleesFor,
    getSymbolCallersFor,
    clearSymbolEdgesForSourceFile,
    type SqliteDbLike,
} from './symbolStore';

describe('symbolStore', () => {
    it('maps null optional columns to undefined when reading symbols', () => {
        const db: SqliteDbLike = {
            run: vi.fn(),
            exec: vi.fn(() => [
                {
                    values: [[
                        'fnA',
                        'function',
                        'src/a.ts',
                        10,
                        20,
                        null,
                        1,
                        0,
                        null,
                    ]],
                },
            ]),
        };

        const symbols = getSymbolsForFile(db, 'src/a.ts');
        expect(symbols).toEqual([
            {
                name: 'fnA',
                kind: 'function',
                filePath: 'src/a.ts',
                lineStart: 10,
                lineEnd: 20,
                signature: undefined,
                isExported: true,
                isEntryPoint: false,
                parentSymbol: undefined,
            },
        ]);
    });

    it('keeps clearSymbolsForFile scoped to one file path', () => {
        const run = vi.fn();
        const db: SqliteDbLike = {
            run,
            exec: vi.fn(() => []),
        };

        clearSymbolsForFile(db, 'src/one.ts');

        expect(run).toHaveBeenCalledTimes(1);
        expect(run).toHaveBeenCalledWith('DELETE FROM symbols WHERE file_path = ?', ['src/one.ts']);
    });

    it('inserts symbol edges and retrieves callees and callers', () => {
        const edge: SymbolEdge = {
            sourceFile: 'src/a.ts',
            sourceName: 'a',
            targetFile: 'src/b.ts',
            targetName: 'b',
            edgeType: 'calls',
            lineNumber: 42,
        };

        const db: SqliteDbLike = {
            run: vi.fn(),
            exec: vi
                .fn()
                .mockReturnValueOnce([{ values: [[edge.sourceFile, edge.sourceName, edge.targetFile, edge.targetName, edge.edgeType, edge.lineNumber]] }])
                .mockReturnValueOnce([{ values: [[edge.sourceFile, edge.sourceName, edge.targetFile, edge.targetName, edge.edgeType, edge.lineNumber]] }]),
        };

        insertSymbolEdgeRecord(db, edge);
        const callees = getSymbolCalleesFor(db, 'src/a.ts', 'a');
        const callers = getSymbolCallersFor(db, 'src/b.ts', 'b');

        expect(callees).toEqual([edge]);
        expect(callers).toEqual([edge]);
    });

    it('delegates symbol upsert payload in stable column order', () => {
        const run = vi.fn();
        const db: SqliteDbLike = {
            run,
            exec: vi.fn(() => []),
        };

        const symbol: SymbolInfo = {
            name: 'x',
            kind: 'function',
            filePath: 'src/x.ts',
            lineStart: 1,
            lineEnd: 2,
            signature: '() => void',
            isExported: false,
            isEntryPoint: true,
            parentSymbol: 'parent',
        };

        upsertSymbolRecord(db, symbol);

        expect(run).toHaveBeenCalledTimes(1);
        expect(run.mock.calls[0][1]).toEqual([
            'src/x.ts',
            'x',
            'function',
            1,
            2,
            '() => void',
            0,
            1,
            'parent',
        ]);
    });

    it('clears edges by source file only', () => {
        const run = vi.fn();
        const db: SqliteDbLike = {
            run,
            exec: vi.fn(() => []),
        };

        clearSymbolEdgesForSourceFile(db, 'src/a.ts');

        expect(run).toHaveBeenCalledWith('DELETE FROM symbol_edges WHERE source_file = ?', ['src/a.ts']);
    });
});
