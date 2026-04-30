/**
 * RepoDatabase — SQLite persistence layer
 *
 * Uses sql.js (WASM-based SQLite) to persist cached tours, retrieval chunks,
 * and auxiliary graph metadata in `.reponav/index.db`.
 *
 * No native modules — works on all platforms.
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import { promises as fsp } from 'fs';
import * as path from 'path';
import type { Database } from 'sql.js';
import { ImportEdge, SymbolInfo, SymbolEdge } from '../types';
import { getWasmDirectory } from '../utils/wasmLocator';
import { CREATE_TABLES, SCHEMA_VERSION, MIGRATE_V1_TO_V2, MIGRATE_V2_TO_V3 } from './schema';
import {
    clearSymbolEdgesForSourceFile,
    clearSymbolsForFile as clearSymbolsForFileRows,
    getSymbolCalleesFor,
    getSymbolCallersFor,
    getSymbolsForFile,
    insertSymbolEdgeRecord,
    upsertSymbolRecord,
} from './symbolStore';

    /** SQLite-backed repository cache for tours, retrieval chunks, symbols, and optional graph metadata. */
export class RepoDatabase {
    private db: Database | null = null;
    private dbPath: string;
    /** True after the first successful initSqlJs() call. Once set, re-opening is fast (~3ms I/O, no WASM compile). */
    private static wasmReady = false;

    constructor(private readonly workspaceRoot: string) {
        this.dbPath = path.join(workspaceRoot, '.reponav', 'index.db');
    }

    // ─── Lifecycle ────────────────────────────────────────────────────────

    async open(): Promise<void> {
        const reponavDir = path.dirname(this.dbPath);
        await fsp.mkdir(reponavDir, { recursive: true });

        const wasmDir = getWasmDirectory(['sql-wasm.wasm']);
        // Lazy-load sql.js so its 44.7KB JS wrapper is not parsed at extension activation.
        const { default: initSqlJs } = await import('sql.js');
        const SQL = await initSqlJs({
            locateFile: (file: string) => path.join(wasmDir, file),
        });
        RepoDatabase.wasmReady = true;

        const dbExists = fs.existsSync(this.dbPath);

        // Load existing DB or create new
        if (dbExists) {
            const readStart = performance.now();
            const buffer = await fsp.readFile(this.dbPath);
            console.info(`[RepoNav][perf][DB] readFile: ${(performance.now() - readStart).toFixed(1)}ms, size: ${buffer.byteLength}`);
            this.db = new SQL.Database(buffer);
        } else {
            this.db = new SQL.Database();
        }

        // Run migrations
        this.db.run(CREATE_TABLES);

        const schemaVersion = String(SCHEMA_VERSION);
        const priorSchemaVersion = this.getMeta('schema_version');

        if (priorSchemaVersion === '1') {
            // V1 → V2: add symbol tables (additive, no data loss)
            this.db.run(MIGRATE_V1_TO_V2);
        }

        if (priorSchemaVersion === '1' || priorSchemaVersion === '2') {
            // V2 → V3: add chunk indexing tables for BM25 hybrid retrieval
            this.db.run(MIGRATE_V2_TO_V3);
        }

        if (!dbExists || priorSchemaVersion !== schemaVersion) {
            this.setMeta('schema_version', schemaVersion);
            await this.save();
        }
    }

    async save(): Promise<void> {
        if (!this.db) return;
        const data = this.db.export();
        const buf = Buffer.from(data);
        const writeStart = performance.now();
        await fsp.writeFile(this.dbPath, buf);
        console.info(`[RepoNav][perf][DB] writeFile: ${(performance.now() - writeStart).toFixed(1)}ms, size: ${buf.byteLength}`);
    }

    async close(): Promise<void> {
        if (this.db) {
            await this.save();
            this.db.close();
            this.db = null;
        }
    }

    /** Returns true if the in-memory database is currently open. */
    isOpen(): boolean {
        return this.db !== null;
    }

    /** Returns true once the sql-wasm.wasm module has been compiled at least once.
     *  Subsequent open() calls skip WASM compilation and only do file I/O (~3ms). */
    isWasmReady(): boolean {
        return RepoDatabase.wasmReady;
    }

    private ensureOpen(): Database {
        if (!this.db) throw new Error('Database not open. Call open() first.');
        return this.db;
    }

    // ─── Meta ─────────────────────────────────────────────────────────────

    setMeta(key: string, value: string): void {
        const db = this.ensureOpen();
        db.run(
            'INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)',
            [key, value]
        );
    }

    getMeta(key: string): string | null {
        const db = this.ensureOpen();
        const result = db.exec('SELECT value FROM meta WHERE key = ?', [key]);
        if (result.length === 0 || result[0].values.length === 0) return null;
        return result[0].values[0][0] as string;
    }

    // ─── Nodes ────────────────────────────────────────────────────────────

    upsertNode(
        filePath: string,
        category: string,
        label: string,
        lines: number,
        mtime: number,
        contentHash: string
    ): void {
        const db = this.ensureOpen();
        db.run(
            `INSERT OR REPLACE INTO nodes (path, category, label, lines, mtime, content_hash, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [filePath, category, label, lines, mtime, contentHash, new Date().toISOString()]
        );
    }

    getNodeMtime(filePath: string): number | null {
        const db = this.ensureOpen();
        const result = db.exec('SELECT mtime FROM nodes WHERE path = ?', [filePath]);
        if (result.length === 0 || result[0].values.length === 0) return null;
        return result[0].values[0][0] as number;
    }

    getAllNodePaths(): string[] {
        const db = this.ensureOpen();
        const result = db.exec('SELECT path FROM nodes');
        if (result.length === 0) return [];
        return result[0].values.map((row: any[]) => row[0] as string);
    }

    deleteNode(filePath: string): void {
        const db = this.ensureOpen();
        db.run('DELETE FROM nodes WHERE path = ?', [filePath]);
        db.run('DELETE FROM edges WHERE source = ? OR target = ?', [filePath, filePath]);
    }

    updateFanCounts(): void {
        const db = this.ensureOpen();
        // Fan-out = how many edges originate from this node
        db.run(`
            UPDATE nodes SET fan_out = (
                SELECT COUNT(*) FROM edges WHERE edges.source = nodes.path
            )
        `);
        // Fan-in = how many edges point to this node
        db.run(`
            UPDATE nodes SET fan_in = (
                SELECT COUNT(*) FROM edges WHERE edges.target = nodes.path
            )
        `);
    }

    // ─── Edges ────────────────────────────────────────────────────────────

    clearEdgesForSource(sourcePath: string): void {
        const db = this.ensureOpen();
        db.run('DELETE FROM edges WHERE source = ?', [sourcePath]);
    }

    insertEdge(edge: ImportEdge): void {
        const db = this.ensureOpen();
        db.run(
            `INSERT OR IGNORE INTO edges (source, target, raw_statement, is_dynamic)
             VALUES (?, ?, ?, ?)`,
            [edge.source, edge.target, edge.rawStatement, edge.isDynamic ? 1 : 0]
        );
    }

    getAllEdges(): ImportEdge[] {
        const db = this.ensureOpen();
        const result = db.exec('SELECT source, target, raw_statement, is_dynamic FROM edges');
        if (result.length === 0) return [];
        return result[0].values.map((row: any[]) => ({
            source: row[0] as string,
            target: row[1] as string,
            specifiers: [],
            rawStatement: row[2] as string,
            isDynamic: (row[3] as number) === 1,
        }));
    }

    // ─── External Deps ────────────────────────────────────────────────────

    clearExternalDeps(): void {
        const db = this.ensureOpen();
        db.run('DELETE FROM external_deps');
    }

    addExternalDep(name: string): void {
        const db = this.ensureOpen();
        db.run('INSERT OR IGNORE INTO external_deps (name) VALUES (?)', [name]);
    }

    getExternalDeps(): Set<string> {
        const db = this.ensureOpen();
        const result = db.exec('SELECT name FROM external_deps');
        if (result.length === 0) return new Set();
        return new Set(result[0].values.map((row: any[]) => row[0] as string));
    }

    // ─── Tours ────────────────────────────────────────────────────────────

    async saveTour(id: string, query: string, tourType: string, stateHash: string, data: string): Promise<void> {
        const db = this.ensureOpen();
        db.run(
            `INSERT OR REPLACE INTO tours (id, query, tour_type, state_hash, data, created_at)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [id, query, tourType, stateHash, data, new Date().toISOString()]
        );
        // Evict to keep at most 20 cached tours so the in-memory buffer stays bounded.
        db.run(
            `DELETE FROM tours WHERE id NOT IN (
                SELECT id FROM tours ORDER BY created_at DESC LIMIT 20
            )`
        );
        await this.save();
        // Release the in-memory buffer after flushing — re-opened lazily on next cache lookup.
        // `db` is the non-null handle captured via ensureOpen() above.
        db.close();
        this.db = null;
    }

    findTourByHash(stateHash: string): string | null {
        const db = this.ensureOpen();
        const result = db.exec(
            'SELECT data FROM tours WHERE state_hash = ? ORDER BY created_at DESC LIMIT 1',
            [stateHash]
        );
        if (result.length === 0 || result[0].values.length === 0) return null;
        return result[0].values[0][0] as string;
    }

    // ─── Symbols (v1.3) ─────────────────────────────────────────────────

    /** Insert or update a symbol record. */
    upsertSymbol(sym: SymbolInfo): void {
        upsertSymbolRecord(this.ensureOpen(), sym);
    }

    /** Get all symbols for a given file. */
    getSymbolsByFile(filePath: string): SymbolInfo[] {
        return getSymbolsForFile(this.ensureOpen(), filePath);
    }

    /** Remove all symbols for a file (used before re-extraction). */
    clearSymbolsForFile(filePath: string): void {
        clearSymbolsForFileRows(this.ensureOpen(), filePath);
    }

    // ─── Symbol Edges (v1.3) ──────────────────────────────────────────────

    /** Insert a symbol-to-symbol edge. Ignores duplicates. */
    insertSymbolEdge(edge: SymbolEdge): void {
        insertSymbolEdgeRecord(this.ensureOpen(), edge);
    }

    /** Get all symbols called by a given symbol. */
    getSymbolCallees(sourceFile: string, sourceName: string): SymbolEdge[] {
        return getSymbolCalleesFor(this.ensureOpen(), sourceFile, sourceName);
    }

    /** Get all symbols that call a given symbol. */
    getSymbolCallers(targetFile: string, targetName: string): SymbolEdge[] {
        return getSymbolCallersFor(this.ensureOpen(), targetFile, targetName);
    }

    /** Remove all symbol edges originating from a file. */
    clearSymbolEdgesForFile(sourceFile: string): void {
        clearSymbolEdgesForSourceFile(this.ensureOpen(), sourceFile);
    }

    // ─── State Hashing ────────────────────────────────────────────────────

    /**
     * Compute a deterministic hash of the tour cache state.
     * When live edges are provided, they take precedence over persisted edge rows.
     */
    computeStateHash(query: string, tourType: string, providerName?: string, promptVersion?: string, liveEdges?: ImportEdge[]): string {
        let edgeStr = '';

        if (liveEdges) {
            edgeStr = liveEdges
                .map((edge) => `${edge.source}→${edge.target}`)
                .sort()
                .join('|');
        } else {
            const db = this.ensureOpen();
            const edgeResult = db.exec(
                'SELECT source, target FROM edges ORDER BY source, target'
            );
            edgeStr = edgeResult.length > 0
                ? edgeResult[0].values.map((r: any[]) => `${r[0]}→${r[1]}`).join('|')
                : '';
        }

        const input = `${query}::${tourType}::${providerName ?? 'unknown'}::${promptVersion ?? 'v0'}::${edgeStr}`;
        return crypto.createHash('sha256').update(input).digest('hex').substring(0, 16);
    }

    // ─── Chunk Indexing (v3 — BM25 hybrid retrieval) ─────────────────────

    /** Index an array of file chunks into the FTS5 store.
     *  Existing chunks for overlapping chunk_ids are replaced. */
    indexChunks(chunks: Array<{ path: string; chunkId: string; content: string; symbolName?: string; lineStart: number; lineEnd: number }>): void {
        const db = this.ensureOpen();

        for (const chunk of chunks) {
            // Delete old metadata + FTS entry (if any) for this chunk_id.
            const existing = db.exec(
                'SELECT rowid FROM file_chunks WHERE chunk_id = ?',
                [chunk.chunkId]
            );
            if (existing.length > 0 && existing[0].values.length > 0) {
                const rowid = existing[0].values[0][0] as number;
                db.run('DELETE FROM file_chunks_fts WHERE rowid = ?', [rowid]);
                db.run('DELETE FROM file_chunks WHERE chunk_id = ?', [chunk.chunkId]);
            }

            // Insert metadata.
            db.run(
                `INSERT INTO file_chunks (path, chunk_id, symbol_name, line_start, line_end)
                 VALUES (?, ?, ?, ?, ?)`,
                [chunk.path, chunk.chunkId, chunk.symbolName ?? null, chunk.lineStart, chunk.lineEnd]
            );
            // Get the new rowid for FTS linkage.
            const rowidResult = db.exec('SELECT last_insert_rowid()');
            const newRowid = rowidResult[0].values[0][0] as number;

            // Insert FTS entry at the same rowid.
            db.run(
                `INSERT INTO file_chunks_fts (rowid, content) VALUES (?, ?)`,
                [newRowid, chunk.content]
            );
        }
    }

    /** Full-text search over chunk content using SQLite FTS4.
     *  Returns up to topK results. Uses FTS4 default term-match ordering.
     *  NOTE: Upgrade to FTS5 for BM25 rank scores when a FTS5-enabled sql.js build is available. */
    searchBM25(query: string, topK: number): Array<{ path: string; chunkId: string; content: string; symbolName?: string; lineStart: number; lineEnd: number; score: number }> {
        const db = this.ensureOpen();

        // Strip FTS special characters to avoid syntax errors.
        const safeQuery = query.replace(/["*^]/g, ' ').trim();
        if (!safeQuery) return [];

        try {
            const result = db.exec(
                `SELECT fc.path, fc.chunk_id, fc.symbol_name, fc.line_start, fc.line_end,
                        file_chunks_fts.content
                 FROM file_chunks_fts
                 JOIN file_chunks fc ON file_chunks_fts.rowid = fc.id
                 WHERE file_chunks_fts MATCH ?
                 LIMIT ?`,
                [safeQuery, topK]
            );
            if (result.length === 0) return [];
            return result[0].values.map((row: any[], index: number) => ({
                path: row[0] as string,
                chunkId: row[1] as string,
                symbolName: (row[2] as string | null) ?? undefined,
                lineStart: row[3] as number,
                lineEnd: row[4] as number,
                content: (row[5] as string) ?? '',
                // FTS4 does not expose BM25 scores; use match-order index as a proxy.
                score: -(index + 1),
            }));
        } catch {
            // FTS syntax errors or empty index — degrade gracefully.
            return [];
        }
    }

    /** Return direct and 2-hop outgoing neighbors of the seed file paths.
     *  Uses the existing import-edge graph in the `edges` table. */
    get2HopNeighbors(filePaths: string[]): string[] {
        if (filePaths.length === 0) return [];
        const db = this.ensureOpen();

        const seedSet = new Set(filePaths);
        const neighbors = new Set<string>();

        // Hop 1: direct targets of seed files.
        const hop1Placeholders = filePaths.map(() => '?').join(', ');
        const hop1 = db.exec(
            `SELECT DISTINCT target FROM edges WHERE source IN (${hop1Placeholders})`,
            filePaths
        );
        const hop1Targets: string[] = [];
        if (hop1.length > 0) {
            for (const row of hop1[0].values) {
                const target = row[0] as string;
                if (!seedSet.has(target)) {
                    neighbors.add(target);
                    hop1Targets.push(target);
                }
            }
        }

        // Hop 2: targets of hop-1 files.
        if (hop1Targets.length > 0) {
            const hop2Placeholders = hop1Targets.map(() => '?').join(', ');
            const hop2 = db.exec(
                `SELECT DISTINCT target FROM edges WHERE source IN (${hop2Placeholders})`,
                hop1Targets
            );
            if (hop2.length > 0) {
                for (const row of hop2[0].values) {
                    const target = row[0] as string;
                    if (!seedSet.has(target)) {
                        neighbors.add(target);
                    }
                }
            }
        }

        return [...neighbors];
    }
}
