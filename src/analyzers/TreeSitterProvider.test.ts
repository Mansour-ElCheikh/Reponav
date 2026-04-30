import { describe, it, expect, vi } from 'vitest';
import { TreeSitterProvider } from './TreeSitterProvider';

type TimeoutCallback = Parameters<typeof setTimeout>[0];

describe('TreeSitterProvider', () => {
    it('can be constructed without initializing WASM', () => {
        // Construction must be synchronous and free — no WASM loading at new()
        expect(() => new TreeSitterProvider()).not.toThrow();
    });

    it('parser is null before first analysis call', () => {
        const provider = new TreeSitterProvider();
        expect((provider as unknown as { parser: unknown }).parser).toBeNull();
    });

    it('accepts a language set restriction without throwing', () => {
        // Verifies the language-scoped API introduced by F7
        expect(() => new TreeSitterProvider(new Set(['typescript']))).not.toThrow();
    });

    it('deletes parsed trees after import analysis', async () => {
        const provider = new TreeSitterProvider();
        const treeA = createFakeTree();
        const treeB = createFakeTree();
        const parser = {
            setLanguage: vi.fn(),
            parse: vi.fn()
                .mockReturnValueOnce(treeA)
                .mockReturnValueOnce(treeB),
        };

        const internal = provider as unknown as {
            parser: typeof parser;
            languages: Record<string, unknown>;
        };
        internal.parser = parser;
        internal.languages = { typescript: {} };

        const result = await provider.analyzeImports(
            '/repo',
            new Map([
                ['src/a.ts', 'export const a = 1;'],
                ['src/b.ts', 'export const b = 2;'],
            ])
        );

        expect(result.edges).toEqual([]);
        expect(treeA.delete).toHaveBeenCalledTimes(1);
        expect(treeB.delete).toHaveBeenCalledTimes(1);
    });

    it('yields once during import analysis after the current 20-file cadence', async () => {
        const provider = new TreeSitterProvider();
        const parser = {
            setLanguage: vi.fn(),
            parse: vi.fn(() => createFakeTree()),
        };
        const internal = provider as unknown as {
            parser: typeof parser;
            languages: Record<string, unknown>;
        };
        internal.parser = parser;
        internal.languages = { typescript: {} };

        const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout').mockImplementation(((fn: TimeoutCallback) => {
            if (typeof fn === 'function') {
                fn();
            }
            return 0 as unknown as ReturnType<typeof setTimeout>;
        }) as typeof setTimeout);

        try {
            await provider.analyzeImports(
                '/repo',
                new Map(Array.from({ length: 21 }, (_, index) => [`src/file-${index}.ts`, `export const value${index} = ${index};`]))
            );

            expect(setTimeoutSpy).toHaveBeenCalledTimes(1);
        } finally {
            setTimeoutSpy.mockRestore();
        }
    });

    it('deletes parsed trees after both symbol-analysis passes', async () => {
        const provider = new TreeSitterProvider();
        const treePass1 = createFakeTree();
        const treePass2 = createFakeTree();
        const parser = {
            setLanguage: vi.fn(),
            parse: vi.fn()
                .mockReturnValueOnce(treePass1)
                .mockReturnValueOnce(treePass2),
        };

        const internal = provider as unknown as {
            parser: typeof parser;
            languages: Record<string, unknown>;
        };
        internal.parser = parser;
        internal.languages = { typescript: {} };

        const result = await provider.analyzeSymbols(
            '/repo',
            new Map([['src/main.ts', 'export function main() {}']]),
            []
        );

        expect(result.symbols).toEqual([]);
        expect(result.edges).toEqual([]);
        expect(treePass1.delete).toHaveBeenCalledTimes(1);
        expect(treePass2.delete).toHaveBeenCalledTimes(1);
    });

    it('yields once during symbol analysis after the current 20-file cadence', async () => {
        const provider = new TreeSitterProvider();
        const parser = {
            setLanguage: vi.fn(),
            parse: vi.fn(() => createFakeTree()),
        };
        const internal = provider as unknown as {
            parser: typeof parser;
            languages: Record<string, unknown>;
        };
        internal.parser = parser;
        internal.languages = { typescript: {} };

        const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout').mockImplementation(((fn: TimeoutCallback) => {
            if (typeof fn === 'function') {
                fn();
            }
            return 0 as unknown as ReturnType<typeof setTimeout>;
        }) as typeof setTimeout);

        try {
            await provider.analyzeSymbols(
                '/repo',
                new Map(Array.from({ length: 21 }, (_, index) => [`src/file-${index}.ts`, `export function symbol${index}() { return ${index}; }`])),
                []
            );

            expect(setTimeoutSpy).toHaveBeenCalledTimes(1);
        } finally {
            setTimeoutSpy.mockRestore();
        }
    });
});

function createFakeTree() {
    return {
        rootNode: {
            type: 'program',
            text: '',
            children: [],
            namedChildren: [],
            startPosition: { row: 0, column: 0 },
            endPosition: { row: 0, column: 0 },
            childForFieldName: () => null,
        },
        delete: vi.fn(),
    };
}
