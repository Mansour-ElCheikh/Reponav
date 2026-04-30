/**
 * Tests for RepoDatabase — schema migration and symbol CRUD.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { SymbolInfo, SymbolEdge } from '../types';
import { RepoDatabase } from './RepoDatabase';

let db: RepoDatabase;
let tmpDir: string;

beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reponav-db-test-'));
    db = new RepoDatabase(tmpDir);
    await db.open();
});

afterEach(async () => {
    await db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('schema migration', () => {
    it('creates symbols table on fresh database', () => {
        const symbols = db.getSymbolsByFile('src/index.ts');
        expect(symbols).toEqual([]);
    });

    it('creates symbol_edges table on fresh database', () => {
        const edges = db.getSymbolCallees('src/index.ts', 'main');
        expect(edges).toEqual([]);
    });

    it('reports schema version 3', () => {
        expect(db.getMeta('schema_version')).toBe('3');
    });

    it('migrates from v1 to v2 without data loss', async () => {
        // Close current db, create a v1-only db manually
        await db.close();

        const v1Db = new RepoDatabase(tmpDir);
        // Simulate a v1 database by opening and setting version to 1
        await v1Db.open();
        v1Db.upsertNode('src/app.ts', 'entry', 'app.ts', 50, 1000, 'abc123');
        v1Db.setMeta('schema_version', '1');
        await v1Db.save();
        await v1Db.close();

        // Re-open — should migrate to v2
        db = new RepoDatabase(tmpDir);
        await db.open();

        // V1 data survives
        expect(db.getNodeMtime('src/app.ts')).toBe(1000);
        // V2 tables exist
        expect(db.getSymbolsByFile('src/app.ts')).toEqual([]);
        expect(db.getMeta('schema_version')).toBe('3');
    });
});

describe('v3 chunk indexing and BM25 search', () => {
    it('indexChunks inserts chunks into the database', () => {
        const chunks = [
            { path: 'src/a.ts', chunkId: 'src/a.ts::alpha', content: 'export function alpha(): void {}', symbolName: 'alpha', lineStart: 1, lineEnd: 3 },
            { path: 'src/a.ts', chunkId: 'src/a.ts::beta', content: 'export function beta(): number { return 1; }', symbolName: 'beta', lineStart: 5, lineEnd: 7 },
        ];
        // Should not throw
        expect(() => db.indexChunks(chunks)).not.toThrow();
    });

    it('searchBM25 returns results matching the query', () => {
        const chunks = [
            { path: 'src/auth.ts', chunkId: 'src/auth.ts::login', content: 'function login handles JWT authentication and login token verification', symbolName: 'login', lineStart: 1, lineEnd: 5 },
            { path: 'src/graph.ts', chunkId: 'src/graph.ts::draw', content: 'function draw renders nodes and edges on canvas', symbolName: 'draw', lineStart: 1, lineEnd: 5 },
        ];
        db.indexChunks(chunks);

        const results = db.searchBM25('JWT authentication login', 10);
        expect(results.length).toBeGreaterThan(0);
        expect(results[0].path).toBe('src/auth.ts');
    });

    it('searchBM25 returns empty array when no matches', () => {
        const chunks = [
            { path: 'src/a.ts', chunkId: 'src/a.ts::foo', content: 'function foo does nothing special', symbolName: 'foo', lineStart: 1, lineEnd: 3 },
        ];
        db.indexChunks(chunks);
        const results = db.searchBM25('quantum entanglement orbital mechanics', 10);
        expect(results).toEqual([]);
    });

    it('searchBM25 re-index replaces previous content', () => {
        const v1 = [{ path: 'src/a.ts', chunkId: 'src/a.ts::foo', content: 'old content about dogs', symbolName: 'foo', lineStart: 1, lineEnd: 3 }];
        const v2 = [{ path: 'src/a.ts', chunkId: 'src/a.ts::foo', content: 'new content about cats', symbolName: 'foo', lineStart: 1, lineEnd: 3 }];
        db.indexChunks(v1);
        db.indexChunks(v2);
        const dogResults = db.searchBM25('dogs', 10);
        const catResults = db.searchBM25('cats', 10);
        expect(dogResults).toHaveLength(0);
        expect(catResults.length).toBeGreaterThan(0);
    });
});

describe('get2HopNeighbors', () => {
    beforeEach(() => {
        // Insert a small dep graph: a → b → c, a → d
        db.insertEdge({ source: 'src/a.ts', target: 'src/b.ts', specifiers: [], rawStatement: '', isDynamic: false });
        db.insertEdge({ source: 'src/a.ts', target: 'src/d.ts', specifiers: [], rawStatement: '', isDynamic: false });
        db.insertEdge({ source: 'src/b.ts', target: 'src/c.ts', specifiers: [], rawStatement: '', isDynamic: false });
    });

    it('returns direct and 2-hop outgoing neighbors', () => {
        const neighbors = db.get2HopNeighbors(['src/a.ts']);
        expect(neighbors).toContain('src/b.ts');
        expect(neighbors).toContain('src/d.ts');
        expect(neighbors).toContain('src/c.ts'); // 2nd hop via b
    });

    it('does not include the seed file itself', () => {
        const neighbors = db.get2HopNeighbors(['src/a.ts']);
        expect(neighbors).not.toContain('src/a.ts');
    });

    it('returns empty array when seed has no outgoing edges', () => {
        const neighbors = db.get2HopNeighbors(['src/c.ts']);
        expect(neighbors).toEqual([]);
    });

    it('handles empty seed array without error', () => {
        expect(() => db.get2HopNeighbors([])).not.toThrow();
        expect(db.get2HopNeighbors([])).toEqual([]);
    });
});

describe('symbol CRUD', () => {
    const sym: SymbolInfo = {
        name: 'createUser',
        kind: 'function',
        filePath: 'src/services/user.ts',
        lineStart: 10,
        lineEnd: 25,
        signature: 'async createUser(name: string): Promise<User>',
        isExported: true,
        isEntryPoint: false,
    };

    it('inserts and retrieves a symbol', () => {
        db.upsertSymbol(sym);
        const result = db.getSymbolsByFile('src/services/user.ts');
        expect(result).toHaveLength(1);
        expect(result[0].name).toBe('createUser');
        expect(result[0].kind).toBe('function');
        expect(result[0].lineStart).toBe(10);
        expect(result[0].lineEnd).toBe(25);
        expect(result[0].signature).toBe('async createUser(name: string): Promise<User>');
        expect(result[0].isExported).toBe(true);
    });

    it('upserts (replaces) on conflict', () => {
        db.upsertSymbol(sym);
        db.upsertSymbol({ ...sym, lineEnd: 30, signature: 'updated' });
        const result = db.getSymbolsByFile('src/services/user.ts');
        expect(result).toHaveLength(1);
        expect(result[0].lineEnd).toBe(30);
        expect(result[0].signature).toBe('updated');
    });

    it('handles symbols with parentSymbol (methods)', () => {
        const method: SymbolInfo = {
            name: 'validate',
            kind: 'method',
            filePath: 'src/models/User.ts',
            lineStart: 15,
            lineEnd: 20,
            isExported: false,
            isEntryPoint: false,
            parentSymbol: 'User',
        };
        db.upsertSymbol(method);
        const result = db.getSymbolsByFile('src/models/User.ts');
        expect(result[0].parentSymbol).toBe('User');
    });

    it('clears symbols for a file', () => {
        db.upsertSymbol(sym);
        db.upsertSymbol({ ...sym, name: 'deleteUser', lineStart: 30, lineEnd: 40 });
        db.clearSymbolsForFile('src/services/user.ts');
        expect(db.getSymbolsByFile('src/services/user.ts')).toEqual([]);
    });
});

describe('symbol edge CRUD', () => {
    const edge: SymbolEdge = {
        sourceFile: 'src/routes/users.ts',
        sourceName: 'handleCreate',
        targetFile: 'src/services/user.ts',
        targetName: 'createUser',
        edgeType: 'calls',
        lineNumber: 42,
    };

    it('inserts and retrieves callees', () => {
        db.insertSymbolEdge(edge);
        const callees = db.getSymbolCallees('src/routes/users.ts', 'handleCreate');
        expect(callees).toHaveLength(1);
        expect(callees[0].targetName).toBe('createUser');
        expect(callees[0].edgeType).toBe('calls');
    });

    it('retrieves callers', () => {
        db.insertSymbolEdge(edge);
        const callers = db.getSymbolCallers('src/services/user.ts', 'createUser');
        expect(callers).toHaveLength(1);
        expect(callers[0].sourceName).toBe('handleCreate');
    });

    it('ignores duplicate edges', () => {
        db.insertSymbolEdge(edge);
        db.insertSymbolEdge(edge);
        const callees = db.getSymbolCallees('src/routes/users.ts', 'handleCreate');
        expect(callees).toHaveLength(1);
    });

    it('clears symbol edges for a file', () => {
        db.insertSymbolEdge(edge);
        db.clearSymbolEdgesForFile('src/routes/users.ts');
        expect(db.getSymbolCallees('src/routes/users.ts', 'handleCreate')).toEqual([]);
    });
});
