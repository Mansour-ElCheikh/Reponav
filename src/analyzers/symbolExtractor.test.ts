/**
 * Tests for symbolExtractor — pure TS symbol extraction from tree-sitter ASTs.
 *
 * Uses real tree-sitter parsing on fixture strings to verify extraction accuracy.
 */
import * as path from 'path';
import { describe, it, expect, beforeAll } from 'vitest';
import * as webTreeSitter from 'web-tree-sitter';
import type { SymbolInfo, ImportEdge } from '../types';
import { getWasmDirectory } from '../utils/wasmLocator';
import { extractSymbols, traceSymbolEdges, findSymbolsAtRange } from './symbolExtractor';

// ─── Parser Setup ────────────────────────────────────────────────────────────

let parser: webTreeSitter.Parser;
let languages: Record<string, webTreeSitter.Language>;

beforeAll(async () => {
    const wasmDir = getWasmDirectory([
        'tree-sitter-javascript.wasm',
        'tree-sitter-typescript.wasm',
        'tree-sitter-tsx.wasm',
        'tree-sitter-python.wasm',
    ]);
    await webTreeSitter.Parser.init({
        locateFile: (scriptName: string) => path.join(wasmDir, scriptName),
    });
    parser = new webTreeSitter.Parser();
    const [javascript, typescript, tsx, python] = await Promise.all([
        webTreeSitter.Language.load(path.join(wasmDir, 'tree-sitter-javascript.wasm')),
        webTreeSitter.Language.load(path.join(wasmDir, 'tree-sitter-typescript.wasm')),
        webTreeSitter.Language.load(path.join(wasmDir, 'tree-sitter-tsx.wasm')),
        webTreeSitter.Language.load(path.join(wasmDir, 'tree-sitter-python.wasm')),
    ]);
    languages = { javascript, typescript, tsx, python };
});

/** Parse source code and return the tree. */
function parse(code: string, lang: string): webTreeSitter.Tree {
    parser.setLanguage(languages[lang]);
    const tree = parser.parse(code);
    if (!tree) throw new Error(`Failed to parse ${lang} code`);
    return tree;
}

// ─── TypeScript Symbol Extraction ────────────────────────────────────────────

describe('extractSymbols — TypeScript', () => {
    it('extracts exported function declaration', () => {
        const tree = parse(`export function createUser(name: string): User {\n  return { name };\n}`, 'typescript');
        const symbols = extractSymbols(tree, 'src/user.ts', 'typescript');
        expect(symbols).toHaveLength(1);
        expect(symbols[0]).toMatchObject({
            name: 'createUser',
            kind: 'function',
            filePath: 'src/user.ts',
            lineStart: 0,
            isExported: true,
        });
    });

    it('extracts non-exported function', () => {
        const tree = parse(`function helper() { return 1; }`, 'typescript');
        const symbols = extractSymbols(tree, 'src/util.ts', 'typescript');
        expect(symbols).toHaveLength(1);
        expect(symbols[0].isExported).toBe(false);
    });

    it('extracts exported arrow function assigned to const', () => {
        const tree = parse(`export const greet = (name: string) => \`Hello \${name}\`;`, 'typescript');
        const symbols = extractSymbols(tree, 'src/greet.ts', 'typescript');
        expect(symbols).toHaveLength(1);
        expect(symbols[0]).toMatchObject({
            name: 'greet',
            kind: 'function',
            isExported: true,
        });
    });

    it('extracts class with methods', () => {
        const code = `export class UserService {\n  async create(name: string) {\n    return name;\n  }\n  private validate() {}\n}`;
        const tree = parse(code, 'typescript');
        const symbols = extractSymbols(tree, 'src/service.ts', 'typescript');

        const cls = symbols.find(s => s.name === 'UserService');
        expect(cls).toBeDefined();
        expect(cls!.kind).toBe('class');
        expect(cls!.isExported).toBe(true);

        const create = symbols.find(s => s.name === 'create');
        expect(create).toBeDefined();
        expect(create!.kind).toBe('method');
        expect(create!.parentSymbol).toBe('UserService');

        const validate = symbols.find(s => s.name === 'validate');
        expect(validate).toBeDefined();
        expect(validate!.kind).toBe('method');
        expect(validate!.parentSymbol).toBe('UserService');
    });

    it('extracts interface', () => {
        const tree = parse(`export interface User {\n  name: string;\n  age: number;\n}`, 'typescript');
        const symbols = extractSymbols(tree, 'src/types.ts', 'typescript');
        expect(symbols).toHaveLength(1);
        expect(symbols[0]).toMatchObject({ name: 'User', kind: 'interface', isExported: true });
    });

    it('extracts type alias', () => {
        const tree = parse(`export type UserID = string;`, 'typescript');
        const symbols = extractSymbols(tree, 'src/types.ts', 'typescript');
        expect(symbols).toHaveLength(1);
        expect(symbols[0]).toMatchObject({ name: 'UserID', kind: 'type_alias', isExported: true });
    });

    it('extracts enum', () => {
        const tree = parse(`export enum Status {\n  Active,\n  Inactive,\n}`, 'typescript');
        const symbols = extractSymbols(tree, 'src/types.ts', 'typescript');
        expect(symbols).toHaveLength(1);
        expect(symbols[0]).toMatchObject({ name: 'Status', kind: 'enum', isExported: true });
    });

    it('extracts exported const (non-function)', () => {
        const tree = parse(`export const MAX_RETRIES = 3;`, 'typescript');
        const symbols = extractSymbols(tree, 'src/config.ts', 'typescript');
        expect(symbols).toHaveLength(1);
        expect(symbols[0]).toMatchObject({ name: 'MAX_RETRIES', kind: 'constant', isExported: true });
    });

    it('skips non-exported const', () => {
        const tree = parse(`const internal = 5;`, 'typescript');
        const symbols = extractSymbols(tree, 'src/config.ts', 'typescript');
        // Non-exported constants are noise — skip them
        expect(symbols).toHaveLength(0);
    });
});

// ─── JavaScript Symbol Extraction ────────────────────────────────────────────

describe('extractSymbols — JavaScript', () => {
    it('extracts function and class from JS', () => {
        const code = `export function handler(req, res) {}\nexport class Router {}`;
        const tree = parse(code, 'javascript');
        const symbols = extractSymbols(tree, 'src/app.js', 'javascript');
        expect(symbols).toHaveLength(2);
        expect(symbols.map(s => s.name).sort()).toEqual(['Router', 'handler']);
    });
});

// ─── Python Symbol Extraction ────────────────────────────────────────────────

describe('extractSymbols — Python', () => {
    it('extracts top-level function', () => {
        const tree = parse(`def create_user(name: str) -> User:\n    return User(name)\n`, 'python');
        const symbols = extractSymbols(tree, 'services/user.py', 'python');
        expect(symbols).toHaveLength(1);
        expect(symbols[0]).toMatchObject({ name: 'create_user', kind: 'function', lineStart: 0 });
    });

    it('extracts class with methods', () => {
        const code = `class UserService:\n    def create(self, name):\n        pass\n    def delete(self, id):\n        pass\n`;
        const tree = parse(code, 'python');
        const symbols = extractSymbols(tree, 'services/user.py', 'python');

        const cls = symbols.find(s => s.name === 'UserService');
        expect(cls).toBeDefined();
        expect(cls!.kind).toBe('class');

        const methods = symbols.filter(s => s.kind === 'method');
        expect(methods).toHaveLength(2);
        expect(methods[0].parentSymbol).toBe('UserService');
    });
});

// ─── Edge Tracing ────────────────────────────────────────────────────────────

describe('traceSymbolEdges', () => {
    it('traces a direct function call across files', () => {
        // File A calls createUser which is defined in File B
        const callerCode = `import { createUser } from './user';\nfunction handler() {\n  createUser('test');\n}`;
        const callerTree = parse(callerCode, 'typescript');

        const symbolIndex = new Map<string, SymbolInfo[]>();
        symbolIndex.set('createUser', [{
            name: 'createUser',
            kind: 'function',
            filePath: 'src/user.ts',
            lineStart: 0,
            lineEnd: 5,
            isExported: true,
            isEntryPoint: false,
        }]);

        const importEdges: ImportEdge[] = [{
            source: 'src/handler.ts',
            target: 'src/user.ts',
            specifiers: ['createUser'],
            isDynamic: false,
            rawStatement: "import { createUser } from './user'",
        }];

        const edges = traceSymbolEdges(callerTree, 'src/handler.ts', 'typescript', symbolIndex, importEdges);
        expect(edges.length).toBeGreaterThanOrEqual(1);
        const callEdge = edges.find(e => e.targetName === 'createUser' && e.edgeType === 'calls');
        expect(callEdge).toBeDefined();
        expect(callEdge!.sourceFile).toBe('src/handler.ts');
        expect(callEdge!.targetFile).toBe('src/user.ts');
    });

    it('traces extends clause', () => {
        const code = `import { BaseService } from './base';\nexport class UserService extends BaseService {}`;
        const tree = parse(code, 'typescript');

        const symbolIndex = new Map<string, SymbolInfo[]>();
        symbolIndex.set('BaseService', [{
            name: 'BaseService',
            kind: 'class',
            filePath: 'src/base.ts',
            lineStart: 0,
            lineEnd: 10,
            isExported: true,
            isEntryPoint: false,
        }]);

        const importEdges: ImportEdge[] = [{
            source: 'src/user.ts',
            target: 'src/base.ts',
            specifiers: ['BaseService'],
            isDynamic: false,
            rawStatement: "import { BaseService } from './base'",
        }];

        const edges = traceSymbolEdges(tree, 'src/user.ts', 'typescript', symbolIndex, importEdges);
        const extendsEdge = edges.find(e => e.edgeType === 'extends');
        expect(extendsEdge).toBeDefined();
        expect(extendsEdge!.sourceName).toBe('UserService');
        expect(extendsEdge!.targetName).toBe('BaseService');
    });
});

// ─── Range Mapping ───────────────────────────────────────────────────────────

describe('findSymbolsAtRange', () => {
    const mockSymbols: SymbolInfo[] = [
        { name: 'foo', kind: 'function', filePath: 'f.ts', lineStart: 10, lineEnd: 20, isExported: true, isEntryPoint: false },
        { name: 'bar', kind: 'function', filePath: 'f.ts', lineStart: 30, lineEnd: 40, isExported: true, isEntryPoint: false },
        { name: 'Nested', kind: 'class', filePath: 'f.ts', lineStart: 50, lineEnd: 100, isExported: true, isEntryPoint: false },
        { name: 'method', kind: 'method', filePath: 'f.ts', lineStart: 60, lineEnd: 70, isExported: false, isEntryPoint: false, parentSymbol: 'Nested' },
    ];

    it('finds symbols containing a single line', () => {
        const found = findSymbolsAtRange(mockSymbols, 15, 15);
        expect(found).toHaveLength(1);
        expect(found[0].name).toBe('foo');
    });

    it('finds multiple symbols in a broad range', () => {
        const found = findSymbolsAtRange(mockSymbols, 15, 35);
        expect(found).toHaveLength(2);
        expect(found.map(s => s.name)).toContain('foo');
        expect(found.map(s => s.name)).toContain('bar');
    });

    it('finds parent and child symbols when range hits both', () => {
        const found = findSymbolsAtRange(mockSymbols, 65, 65);
        expect(found).toHaveLength(2);
        expect(found.map(s => s.name)).toContain('Nested');
        expect(found.map(s => s.name)).toContain('method');
    });

    it('finds symbols fully contained within the range', () => {
        const found = findSymbolsAtRange(mockSymbols, 25, 45);
        expect(found).toHaveLength(1);
        expect(found[0].name).toBe('bar');
    });

    it('returns empty array if no symbols overlap', () => {
        const found = findSymbolsAtRange(mockSymbols, 0, 5);
        expect(found).toHaveLength(0);
    });
});
