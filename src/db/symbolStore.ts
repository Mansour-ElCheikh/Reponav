import type { SymbolEdge, SymbolInfo } from '../types';

interface QueryResult {
    values: unknown[][];
}

/**
 * Minimal SQL.js-like surface needed by symbol persistence helpers.
 */
export interface SqliteDbLike {
    run(sql: string, params?: unknown[]): void;
    exec(sql: string, params?: unknown[]): QueryResult[];
}

/** Insert or update one symbol record. */
export function upsertSymbolRecord(db: SqliteDbLike, sym: SymbolInfo): void {
    db.run(
        `INSERT OR REPLACE INTO symbols
         (file_path, name, kind, line_start, line_end, signature, is_exported, is_entry_point, parent_symbol)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            sym.filePath,
            sym.name,
            sym.kind,
            sym.lineStart,
            sym.lineEnd,
            sym.signature ?? null,
            sym.isExported ? 1 : 0,
            sym.isEntryPoint ? 1 : 0,
            sym.parentSymbol ?? null,
        ],
    );
}

/** Fetch all symbols for a given file path. */
export function getSymbolsForFile(db: SqliteDbLike, filePath: string): SymbolInfo[] {
    const result = db.exec(
        'SELECT name, kind, file_path, line_start, line_end, signature, is_exported, is_entry_point, parent_symbol FROM symbols WHERE file_path = ?',
        [filePath],
    );
    if (result.length === 0) return [];

    return result[0].values.map((row) => ({
        name: row[0] as string,
        kind: row[1] as SymbolInfo['kind'],
        filePath: row[2] as string,
        lineStart: row[3] as number,
        lineEnd: row[4] as number,
        signature: toOptionalString(row[5]),
        isExported: (row[6] as number) === 1,
        isEntryPoint: (row[7] as number) === 1,
        parentSymbol: toOptionalString(row[8]),
    }));
}

/** Delete all symbols associated with one file. */
export function clearSymbolsForFile(db: SqliteDbLike, filePath: string): void {
    db.run('DELETE FROM symbols WHERE file_path = ?', [filePath]);
}

/** Insert one symbol edge and ignore duplicates. */
export function insertSymbolEdgeRecord(db: SqliteDbLike, edge: SymbolEdge): void {
    db.run(
        `INSERT OR IGNORE INTO symbol_edges
         (source_file, source_name, target_file, target_name, edge_type, line_number)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [edge.sourceFile, edge.sourceName, edge.targetFile, edge.targetName, edge.edgeType, edge.lineNumber],
    );
}

/** Fetch all callees for a given source symbol. */
export function getSymbolCalleesFor(db: SqliteDbLike, sourceFile: string, sourceName: string): SymbolEdge[] {
    return querySymbolEdges(
        db,
        'SELECT source_file, source_name, target_file, target_name, edge_type, line_number FROM symbol_edges WHERE source_file = ? AND source_name = ?',
        [sourceFile, sourceName],
    );
}

/** Fetch all callers for a given target symbol. */
export function getSymbolCallersFor(db: SqliteDbLike, targetFile: string, targetName: string): SymbolEdge[] {
    return querySymbolEdges(
        db,
        'SELECT source_file, source_name, target_file, target_name, edge_type, line_number FROM symbol_edges WHERE target_file = ? AND target_name = ?',
        [targetFile, targetName],
    );
}

/** Delete all symbol edges originating from one source file. */
export function clearSymbolEdgesForSourceFile(db: SqliteDbLike, sourceFile: string): void {
    db.run('DELETE FROM symbol_edges WHERE source_file = ?', [sourceFile]);
}

// Map nullable SQL values to optional strings used by SymbolInfo.
function toOptionalString(value: unknown): string | undefined {
    return value == null ? undefined : (value as string);
}

// Shared mapper for symbol edge query results.
function querySymbolEdges(db: SqliteDbLike, sql: string, params: unknown[]): SymbolEdge[] {
    const result = db.exec(sql, params);
    if (result.length === 0) return [];

    return result[0].values.map((row) => ({
        sourceFile: row[0] as string,
        sourceName: row[1] as string,
        targetFile: row[2] as string,
        targetName: row[3] as string,
        edgeType: row[4] as SymbolEdge['edgeType'],
        lineNumber: row[5] as number,
    }));
}
