import { describe, it, expect } from 'vitest';
import type { SymbolInfo } from '../types';
import { buildChunks, FileChunk } from './chunkBuilder';

// 3-function TypeScript file content for testing.
const THREE_FUNCTION_FILE = [
    'import { foo } from "./foo";',
    '',
    'export function alpha(): void {',
    '  console.log("alpha");',
    '}',
    '',
    'export function beta(x: number): number {',
    '  return x * 2;',
    '}',
    '',
    'export function gamma(): string {',
    '  return "gamma";',
    '}',
].join('\n');

const symbols: SymbolInfo[] = [
    { name: 'alpha', kind: 'function', filePath: 'src/example.ts', lineStart: 3, lineEnd: 5, isExported: true, isEntryPoint: false },
    { name: 'beta',  kind: 'function', filePath: 'src/example.ts', lineStart: 7, lineEnd: 9, isExported: true, isEntryPoint: false },
    { name: 'gamma', kind: 'function', filePath: 'src/example.ts', lineStart: 11, lineEnd: 13, isExported: true, isEntryPoint: false },
];

describe('buildChunks', () => {
    it('returns one chunk per function when symbol data is available', () => {
        const files = new Map([['src/example.ts', THREE_FUNCTION_FILE]]);
        const chunks = buildChunks(files, symbols);

        const filChunks = chunks.filter((c) => c.path === 'src/example.ts');
        expect(filChunks).toHaveLength(3);
    });

    it('assigns correct symbolName to each chunk', () => {
        const files = new Map([['src/example.ts', THREE_FUNCTION_FILE]]);
        const chunks = buildChunks(files, symbols);

        const names = chunks.map((c) => c.symbolName).sort();
        expect(names).toEqual(['alpha', 'beta', 'gamma']);
    });

    it('extracts correct line ranges for each chunk', () => {
        const files = new Map([['src/example.ts', THREE_FUNCTION_FILE]]);
        const chunks = buildChunks(files, symbols);

        const alpha = chunks.find((c) => c.symbolName === 'alpha')!;
        expect(alpha.lineStart).toBe(3);
        expect(alpha.lineEnd).toBe(5);
    });

    it('falls back to a single whole-file chunk when no symbol data is available', () => {
        const files = new Map([['src/example.ts', THREE_FUNCTION_FILE]]);
        const chunks = buildChunks(files, []);

        expect(chunks).toHaveLength(1);
        expect(chunks[0].path).toBe('src/example.ts');
        expect(chunks[0].symbolName).toBeUndefined();
        expect(chunks[0].content).toBe(THREE_FUNCTION_FILE);
    });

    it('handles multiple files with mixed symbol coverage', () => {
        const files = new Map([
            ['src/example.ts', THREE_FUNCTION_FILE],
            ['src/plain.ts', 'const x = 1;'],
        ]);
        // symbols only for example.ts, not for plain.ts
        const chunks = buildChunks(files, symbols);

        const exampleChunks = chunks.filter((c) => c.path === 'src/example.ts');
        const plainChunks = chunks.filter((c) => c.path === 'src/plain.ts');

        expect(exampleChunks).toHaveLength(3);
        expect(plainChunks).toHaveLength(1); // whole-file fallback
        expect(plainChunks[0].content).toBe('const x = 1;');
    });

    it('assigns stable unique chunkIds', () => {
        const files = new Map([['src/example.ts', THREE_FUNCTION_FILE]]);
        const chunks = buildChunks(files, symbols);
        const ids = new Set(chunks.map((c) => c.chunkId));
        expect(ids.size).toBe(chunks.length);
    });
});
