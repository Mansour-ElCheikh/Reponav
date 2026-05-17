/**
 * Tests for symbolWalkers — the language-walker implementations extracted from symbolExtractor.ts.
 *
 * Covers previously untested paths:
 *   - implements edge tracing (TypeScript)
 *   - Python call-edge tracing
 *   - JS (non-TS) edge tracing
 *   - findEnclosingSymbolName module-level fallback
 *   - Go symbol extraction (functions, structs, interfaces, methods)
 *   - Go edge tracing (CALLS, struct embedding)
 *
 * Uses real tree-sitter parsing on fixture strings.
 */
import * as path from 'path';
import { describe, it, expect, beforeAll } from 'vitest';
import * as webTreeSitter from 'web-tree-sitter';
import type { SymbolInfo, ImportEdge } from '../types';
import { getWasmDirectory } from '../utils/wasmLocator';
import {
    walkJsTsSymbols,
    walkPythonSymbols,
    traceJsTsEdges,
    tracePythonEdges,
    findEnclosingSymbolName,
    walkGoSymbols,
    traceGoEdges,
    SupportedLang,
} from './symbolWalkers';

// ─── Parser Setup ────────────────────────────────────────────────────────────

let parser: webTreeSitter.Parser;
let languages: Record<string, webTreeSitter.Language>;

beforeAll(async () => {
    const wasmDir = getWasmDirectory([
        'tree-sitter-javascript.wasm',
        'tree-sitter-typescript.wasm',
        'tree-sitter-python.wasm',
        'tree-sitter-go.wasm',
    ]);
    await webTreeSitter.Parser.init({
        locateFile: (scriptName: string) => path.join(wasmDir, scriptName),
    });
    parser = new webTreeSitter.Parser();
    const [javascript, typescript, python, go] = await Promise.all([
        webTreeSitter.Language.load(path.join(wasmDir, 'tree-sitter-javascript.wasm')),
        webTreeSitter.Language.load(path.join(wasmDir, 'tree-sitter-typescript.wasm')),
        webTreeSitter.Language.load(path.join(wasmDir, 'tree-sitter-python.wasm')),
        webTreeSitter.Language.load(path.join(wasmDir, 'tree-sitter-go.wasm')),
    ]);
    languages = { javascript, typescript, python, go };
});

/** Parse source code and return the tree. */
function parse(code: string, lang: string): webTreeSitter.Tree {
    parser.setLanguage(languages[lang]);
    const tree = parser.parse(code);
    if (!tree) throw new Error(`Failed to parse ${lang} code`);
    return tree;
}

// ─── implements edge (Task 1) ─────────────────────────────────────────────────

describe('traceJsTsEdges — implements clause', () => {
    it('traces implements edge from class to interface', () => {
        const code = `import { Serializable } from './serializable';
export class UserRecord implements Serializable {
  serialize() { return '{}'; }
}`;
        const tree = parse(code, 'typescript');

        const symbolIndex = new Map<string, SymbolInfo[]>();
        symbolIndex.set('Serializable', [{
            name: 'Serializable',
            kind: 'interface',
            filePath: 'src/serializable.ts',
            lineStart: 0,
            lineEnd: 3,
            isExported: true,
            isEntryPoint: false,
        }]);

        const importedFrom = new Map<string, string>();
        importedFrom.set('Serializable', 'src/serializable.ts');

        const edges: import('../types').SymbolEdge[] = [];
        traceJsTsEdges(tree.rootNode, 'src/user.ts', symbolIndex, importedFrom, edges);

        const implEdge = edges.find(e => e.edgeType === 'implements');
        expect(implEdge).toBeDefined();
        expect(implEdge!.sourceName).toBe('UserRecord');
        expect(implEdge!.targetName).toBe('Serializable');
        expect(implEdge!.targetFile).toBe('src/serializable.ts');
    });
});

// ─── Python call edges (Task 2) ───────────────────────────────────────────────

describe('tracePythonEdges — call tracing', () => {
    it('traces a function call in Python source', () => {
        const code = `from utils import helper

def process():
    result = helper()
    return result
`;
        const tree = parse(code, 'python');

        const symbolIndex = new Map<string, SymbolInfo[]>();
        symbolIndex.set('helper', [{
            name: 'helper',
            kind: 'function',
            filePath: 'utils.py',
            lineStart: 0,
            lineEnd: 2,
            isExported: true,
            isEntryPoint: false,
        }]);

        const importedFrom = new Map<string, string>();
        importedFrom.set('helper', 'utils.py');

        const edges: import('../types').SymbolEdge[] = [];
        tracePythonEdges(tree.rootNode, 'service.py', symbolIndex, importedFrom, edges);

        const callEdge = edges.find(e => e.edgeType === 'calls' && e.targetName === 'helper');
        expect(callEdge).toBeDefined();
        expect(callEdge!.sourceFile).toBe('service.py');
        expect(callEdge!.targetFile).toBe('utils.py');
        expect(callEdge!.sourceName).toBe('process');
    });
});

// ─── JS (non-TS) edge tracing (Task 2) ───────────────────────────────────────

describe('traceJsTsEdges — JavaScript source', () => {
    it('traces a call expression in plain JS', () => {
        const code = `const { createUser } = require('./user');
function handler(req, res) {
  createUser(req.body.name);
}`;
        const tree = parse(code, 'javascript');

        const symbolIndex = new Map<string, SymbolInfo[]>();
        symbolIndex.set('createUser', [{
            name: 'createUser',
            kind: 'function',
            filePath: 'src/user.js',
            lineStart: 0,
            lineEnd: 3,
            isExported: true,
            isEntryPoint: false,
        }]);

        const importedFrom = new Map<string, string>();
        importedFrom.set('createUser', 'src/user.js');

        const edges: import('../types').SymbolEdge[] = [];
        traceJsTsEdges(tree.rootNode, 'src/handler.js', symbolIndex, importedFrom, edges);

        const callEdge = edges.find(e => e.edgeType === 'calls' && e.targetName === 'createUser');
        expect(callEdge).toBeDefined();
        expect(callEdge!.sourceFile).toBe('src/handler.js');
        expect(callEdge!.targetFile).toBe('src/user.js');
    });
});

// ─── findEnclosingSymbolName module-level fallback (Task 3) ───────────────────

describe('findEnclosingSymbolName — module-level fallback', () => {
    it('returns null for a call at module level (no enclosing function)', () => {
        // A call_expression node at module level has no parent function/method
        // findEnclosingSymbolName should return null (caller uses ?? '<module>')
        const code = `createUser('alice');`;
        const tree = parse(code, 'typescript');

        // The call_expression node is the first named child of the root
        const callNode = tree.rootNode.namedChildren[0];
        expect(callNode).toBeDefined();

        const result = findEnclosingSymbolName(callNode!);
        expect(result).toBeNull();
    });

    it('returns the enclosing function name when nested', () => {
        const code = `function boot() { createUser('alice'); }`;
        const tree = parse(code, 'typescript');

        // Navigate to the call_expression inside the function body
        const funcNode = tree.rootNode.namedChildren[0]; // function_declaration
        const body = funcNode?.childForFieldName('body');
        const stmt = body?.namedChildren[0]; // expression_statement
        const callExpr = stmt?.namedChildren[0]; // call_expression
        expect(callExpr).toBeDefined();

        const result = findEnclosingSymbolName(callExpr!);
        expect(result).toBe('boot');
    });
});

// ─── Go symbol walker (Tasks 13-14) ──────────────────────────────────────────

describe('walkGoSymbols — function, struct, interface, method', () => {
    it('extracts a top-level function declaration', () => {
        const code = `package main\nfunc Hello(name string) string { return "" }`;
        const tree = parse(code, 'go');
        const symbols: import('../types').SymbolInfo[] = [];
        walkGoSymbols(tree.rootNode, 'main.go', symbols);
        const fn = symbols.find(s => s.name === 'Hello');
        expect(fn).toBeDefined();
        expect(fn!.kind).toBe('function');
        expect(fn!.filePath).toBe('main.go');
        expect(fn!.isExported).toBe(true);
    });

    it('extracts a struct type declaration', () => {
        const code = `package main\ntype User struct { Name string }`;
        const tree = parse(code, 'go');
        const symbols: import('../types').SymbolInfo[] = [];
        walkGoSymbols(tree.rootNode, 'user.go', symbols);
        const cls = symbols.find(s => s.name === 'User');
        expect(cls).toBeDefined();
        expect(cls!.kind).toBe('class');
    });

    it('extracts an interface type declaration', () => {
        const code = `package main\ntype Writer interface { Write(p []byte) (int, error) }`;
        const tree = parse(code, 'go');
        const symbols: import('../types').SymbolInfo[] = [];
        walkGoSymbols(tree.rootNode, 'io.go', symbols);
        const iface = symbols.find(s => s.name === 'Writer');
        expect(iface).toBeDefined();
        expect(iface!.kind).toBe('interface');
    });

    it('extracts a method declaration with receiver', () => {
        const code = `package main\ntype User struct{}\nfunc (u User) Greet() string { return "" }`;
        const tree = parse(code, 'go');
        const symbols: import('../types').SymbolInfo[] = [];
        walkGoSymbols(tree.rootNode, 'user.go', symbols);
        const method = symbols.find(s => s.name === 'Greet');
        expect(method).toBeDefined();
        expect(method!.kind).toBe('method');
        expect(method!.parentSymbol).toBe('User');
    });

    it('marks unexported (lowercase) functions as not exported', () => {
        const code = `package main\nfunc helper() {}`;
        const tree = parse(code, 'go');
        const symbols: import('../types').SymbolInfo[] = [];
        walkGoSymbols(tree.rootNode, 'internal.go', symbols);
        const fn = symbols.find(s => s.name === 'helper');
        expect(fn).toBeDefined();
        expect(fn!.isExported).toBe(false);
    });
});

// ─── it.each parameterized Go fixture tests (Task 17 — R16) ─────────────────

const GO_FIXTURES: Array<{
    name: string;
    filePath: string;
    code: string;
    expectedSymbols: Array<{ name: string; kind: string }>;
}> = [
    {
        name: 'hello.go — minimal single-function file',
        filePath: 'cmd/hello.go',
        code: `package main\n\nimport "fmt"\n\nfunc SayHello(name string) string {\n\treturn fmt.Sprintf("Hello, %s", name)\n}\n`,
        expectedSymbols: [{ name: 'SayHello', kind: 'function' }],
    },
    {
        name: 'service.go — struct + interface + method + unexported helper',
        filePath: 'internal/service.go',
        code: `package service\n\ntype Storer interface {\n\tSave(id string) error\n}\n\ntype UserService struct {\n\tstore Storer\n}\n\nfunc NewUserService(s Storer) *UserService {\n\treturn &UserService{store: s}\n}\n\nfunc (svc *UserService) CreateUser(name string) error {\n\treturn svc.store.Save(name)\n}\n\nfunc validateName(name string) bool {\n\treturn len(name) > 0\n}\n`,
        expectedSymbols: [
            { name: 'Storer', kind: 'interface' },
            { name: 'UserService', kind: 'class' },
            { name: 'NewUserService', kind: 'function' },
            { name: 'CreateUser', kind: 'method' },
            { name: 'validateName', kind: 'function' },
        ],
    },
];

describe.each(GO_FIXTURES)('walkGoSymbols — $name', ({ filePath, code, expectedSymbols }) => {
    it('extracts all expected symbols', () => {
        const tree = parse(code, 'go');
        const symbols: import('../types').SymbolInfo[] = [];
        walkGoSymbols(tree.rootNode, filePath, symbols);

        for (const expected of expectedSymbols) {
            const found = symbols.find(s => s.name === expected.name);
            expect(found, `Expected symbol '${expected.name}' not found`).toBeDefined();
            expect(found!.kind).toBe(expected.kind);
            expect(found!.filePath).toBe(filePath);
        }
    });
});


describe('traceGoEdges — CALLS and struct embedding', () => {
    it('traces a function call edge', () => {
        const code = `package main\nfunc Process() { helper() }`;
        const tree = parse(code, 'go');

        const symbolIndex = new Map<string, import('../types').SymbolInfo[]>();
        symbolIndex.set('helper', [{
            name: 'helper',
            kind: 'function',
            filePath: 'utils.go',
            lineStart: 0,
            lineEnd: 2,
            isExported: false,
            isEntryPoint: false,
        }]);

        const importedFrom = new Map<string, string>();
        importedFrom.set('helper', 'utils.go');

        const edges: import('../types').SymbolEdge[] = [];
        traceGoEdges(tree.rootNode, 'main.go', symbolIndex, importedFrom, edges);

        const callEdge = edges.find(e => e.edgeType === 'calls' && e.targetName === 'helper');
        expect(callEdge).toBeDefined();
        expect(callEdge!.sourceFile).toBe('main.go');
        expect(callEdge!.targetFile).toBe('utils.go');
    });

    it('traces struct embedding as an extends edge', () => {
        const code = `package main\ntype B struct{}\ntype A struct { B }`;
        const tree = parse(code, 'go');

        const symbolIndex = new Map<string, import('../types').SymbolInfo[]>();
        symbolIndex.set('B', [{
            name: 'B',
            kind: 'class',
            filePath: 'base.go',
            lineStart: 0,
            lineEnd: 2,
            isExported: true,
            isEntryPoint: false,
        }]);

        const importedFrom = new Map<string, string>();
        importedFrom.set('B', 'base.go');

        const edges: import('../types').SymbolEdge[] = [];
        traceGoEdges(tree.rootNode, 'derived.go', symbolIndex, importedFrom, edges);

        const inheritEdge = edges.find(e => e.edgeType === 'extends' && e.targetName === 'B');
        expect(inheritEdge).toBeDefined();
        expect(inheritEdge!.sourceName).toBe('A');
        expect(inheritEdge!.sourceFile).toBe('derived.go');
        expect(inheritEdge!.targetFile).toBe('base.go');
    });
});
