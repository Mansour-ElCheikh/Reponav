import { describe, expect, it } from 'vitest';
import {
    CREATE_TABLES,
    CREATE_TABLES_V1,
    MIGRATE_V1_TO_V2,
    MIGRATE_V2_TO_V3,
    SCHEMA_VERSION,
} from './schema';

describe('schema', () => {
    it('tracks the current schema version', () => {
        expect(SCHEMA_VERSION).toBe(3);
    });

    it('keeps the full schema as the ordered concatenation of all migrations', () => {
        expect(CREATE_TABLES).toBe(CREATE_TABLES_V1 + MIGRATE_V1_TO_V2 + MIGRATE_V2_TO_V3);
    });

    it('includes the original file graph tables and indexes', () => {
        expect(CREATE_TABLES_V1).toContain('CREATE TABLE IF NOT EXISTS nodes');
        expect(CREATE_TABLES_V1).toContain('CREATE TABLE IF NOT EXISTS edges');
        expect(CREATE_TABLES_V1).toContain('CREATE INDEX IF NOT EXISTS idx_edges_source');
    });

    it('adds symbol analysis and chunk retrieval tables in later migrations', () => {
        expect(MIGRATE_V1_TO_V2).toContain('CREATE TABLE IF NOT EXISTS symbols');
        expect(MIGRATE_V1_TO_V2).toContain('CREATE TABLE IF NOT EXISTS symbol_edges');
        expect(MIGRATE_V2_TO_V3).toContain('CREATE TABLE IF NOT EXISTS file_chunks');
        expect(MIGRATE_V2_TO_V3).toContain('CREATE VIRTUAL TABLE IF NOT EXISTS file_chunks_fts USING fts4(content)');
    });
});