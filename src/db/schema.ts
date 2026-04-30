/**
 * Database Schema
 *
 * SQL statements for creating and migrating the RepoNav index database.
 * Stored at `.reponav/index.db` in the workspace root.
 */

export const SCHEMA_VERSION = 3;

/** V1 tables — file-level graph, tours, metadata. */
export const CREATE_TABLES_V1 = `
-- Analyzed file nodes
CREATE TABLE IF NOT EXISTS nodes (
    path TEXT PRIMARY KEY,
    category TEXT NOT NULL DEFAULT 'unknown',
    label TEXT NOT NULL,
    fan_in INTEGER DEFAULT 0,
    fan_out INTEGER DEFAULT 0,
    lines INTEGER DEFAULT 0,
    mtime INTEGER NOT NULL,
    content_hash TEXT,
    updated_at TEXT NOT NULL
);

-- Import edges
CREATE TABLE IF NOT EXISTS edges (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source TEXT NOT NULL,
    target TEXT NOT NULL,
    raw_statement TEXT,
    is_dynamic INTEGER DEFAULT 0,
    UNIQUE(source, target, raw_statement)
);

-- External npm packages
CREATE TABLE IF NOT EXISTS external_deps (
    name TEXT PRIMARY KEY
);

-- Cached tours
CREATE TABLE IF NOT EXISTS tours (
    id TEXT PRIMARY KEY,
    query TEXT NOT NULL,
    tour_type TEXT NOT NULL,
    state_hash TEXT NOT NULL,
    data TEXT NOT NULL,
    created_at TEXT NOT NULL
);

-- Key-value metadata
CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value TEXT
);

-- Indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_edges_source ON edges(source);
CREATE INDEX IF NOT EXISTS idx_edges_target ON edges(target);
CREATE INDEX IF NOT EXISTS idx_tours_state_hash ON tours(state_hash);
CREATE INDEX IF NOT EXISTS idx_nodes_mtime ON nodes(mtime);
`;

/** V2 migration — symbol-level analysis tables. Additive, no data loss. */
export const MIGRATE_V1_TO_V2 = `
-- Symbols extracted from source (functions, classes, interfaces, etc.)
CREATE TABLE IF NOT EXISTS symbols (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    file_path TEXT NOT NULL,
    name TEXT NOT NULL,
    kind TEXT NOT NULL,
    line_start INTEGER NOT NULL,
    line_end INTEGER NOT NULL,
    signature TEXT,
    is_exported INTEGER DEFAULT 0,
    is_entry_point INTEGER DEFAULT 0,
    parent_symbol TEXT,
    UNIQUE(file_path, name, kind, line_start)
);

-- Edges between symbols (calls, extends, implements, uses_type)
CREATE TABLE IF NOT EXISTS symbol_edges (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_file TEXT NOT NULL,
    source_name TEXT NOT NULL,
    target_file TEXT NOT NULL,
    target_name TEXT NOT NULL,
    edge_type TEXT NOT NULL,
    line_number INTEGER,
    UNIQUE(source_file, source_name, target_file, target_name, edge_type)
);

CREATE INDEX IF NOT EXISTS idx_symbols_file ON symbols(file_path);
CREATE INDEX IF NOT EXISTS idx_symbols_name ON symbols(name);
CREATE INDEX IF NOT EXISTS idx_symbols_kind ON symbols(kind);
CREATE INDEX IF NOT EXISTS idx_symbol_edges_source ON symbol_edges(source_file, source_name);
CREATE INDEX IF NOT EXISTS idx_symbol_edges_target ON symbol_edges(target_file, target_name);
`;

/** V3 migration — semantic chunk indexing for BM25 hybrid retrieval. Additive, no data loss. */
export const MIGRATE_V2_TO_V3 = `
-- Base table for chunk metadata
CREATE TABLE IF NOT EXISTS file_chunks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    path TEXT NOT NULL,
    chunk_id TEXT NOT NULL UNIQUE,
    symbol_name TEXT,
    line_start INTEGER NOT NULL,
    line_end INTEGER NOT NULL
);

-- FTS4 virtual table for full-text search over chunk content.
-- NOTE: sql.js 1.14.0 does not include FTS5; FTS4 provides equivalent MATCH support.
CREATE VIRTUAL TABLE IF NOT EXISTS file_chunks_fts USING fts4(content);

CREATE INDEX IF NOT EXISTS idx_file_chunks_path ON file_chunks(path);
CREATE INDEX IF NOT EXISTS idx_file_chunks_chunk_id ON file_chunks(chunk_id);
`;

/** Full schema creation — runs V1 + V2 + V3. Used for fresh databases. */
export const CREATE_TABLES = CREATE_TABLES_V1 + MIGRATE_V1_TO_V2 + MIGRATE_V2_TO_V3;
