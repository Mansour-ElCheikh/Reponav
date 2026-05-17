/**
 * Tests for C003 — coupling CLI sub-command (T17-T23)
 * T17: Parse coupling sub-command and repo arg
 * T18: Parse --min-support flag
 * T19: Parse --format table flag
 * T20: JSON output matches CoChangePair[] schema
 * T21: Table output has correct columns
 * T22a: Git repo with zero qualifying pairs exits 0
 * T22b: Non-git directory exits 0
 * T23: Non-existent repo exits 1
 */
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import { main } from './reponav';

const REPO_ROOT = path.resolve(__dirname, '..');

describe('reponav CLI — coupling sub-command (C003)', () => {
    // ── T17 — coupling routed, missing --repo exits 2 ────────────────────────
    it('T17: coupling command exits 2 when --repo is missing', async () => {
        const { exitCode, error } = await main(['node', 'reponav', 'coupling']);
        expect(exitCode).toBe(2);
        expect(error).toMatch(/--repo/i);
    });

    // ── T18 — --min-support flag parsed and applied ───────────────────────────
    it('T18: --min-support filters pairs — high threshold returns empty array', async () => {
        // minSupport=9999 should always return an empty array
        const { exitCode, output } = await main([
            'node', 'reponav', 'coupling',
            '--repo', REPO_ROOT,
            '--min-support', '9999',
        ]);
        expect(exitCode).toBe(0);
        const parsed = JSON.parse(output) as unknown[];
        expect(Array.isArray(parsed)).toBe(true);
        expect(parsed.length).toBe(0);
    }, 60_000);

    // ── T19 — --format table flag parsed ─────────────────────────────────────
    it('T19: --format table outputs column headers', async () => {
        const { exitCode, output } = await main([
            'node', 'reponav', 'coupling',
            '--repo', REPO_ROOT,
            '--format', 'table',
            '--min-support', '9999',
        ]);
        expect(exitCode).toBe(0);
        expect(output).toContain('fileA');
        expect(output).toContain('fileB');
        expect(output).toContain('support');
        expect(output).toContain('confidence');
    }, 60_000);

    // ── T20 — JSON output matches CoChangePair[] schema ──────────────────────
    it('T20: JSON output is valid CoChangePair[] with required fields', async () => {
        const { exitCode, output } = await main([
            'node', 'reponav', 'coupling',
            '--repo', REPO_ROOT,
            '--min-support', '2',
        ]);
        expect(exitCode).toBe(0);
        let parsed: unknown;
        expect(() => { parsed = JSON.parse(output); }).not.toThrow();
        expect(Array.isArray(parsed)).toBe(true);
        // If any pairs, verify schema
        const pairs = parsed as Record<string, unknown>[];
        for (const pair of pairs.slice(0, 3)) {
            expect(typeof pair['fileA']).toBe('string');
            expect(typeof pair['fileB']).toBe('string');
            expect(typeof pair['support']).toBe('number');
            expect(typeof pair['confidence']).toBe('number');
        }
    }, 60_000);

    // ── T21 — table output has all four column headers ───────────────────────
    it('T21: table output includes fileA, fileB, support, confidence headers', async () => {
        const { output } = await main([
            'node', 'reponav', 'coupling',
            '--repo', REPO_ROOT,
            '--format', 'table',
            '--min-support', '2',
        ]);
        expect(output).toContain('fileA');
        expect(output).toContain('fileB');
        expect(output).toContain('support');
        expect(output).toContain('confidence');
    }, 60_000);

    // ── T22a — valid git repo with no pairs exits 0 ───────────────────────────
    it('T22a: git repo with zero qualifying pairs exits 0 with empty array', async () => {
        const { exitCode, output } = await main([
            'node', 'reponav', 'coupling',
            '--repo', REPO_ROOT,
            '--min-support', '9999',
        ]);
        expect(exitCode).toBe(0);
        const parsed = JSON.parse(output) as unknown[];
        expect(parsed).toEqual([]);
    }, 60_000);

    // ── T22b — non-git directory exits 0 with empty array ────────────────────
    it('T22b: non-git directory exits 0 and outputs []', async () => {
        // Use /tmp which is guaranteed to not be a git repo
        const { exitCode, output } = await main([
            'node', 'reponav', 'coupling',
            '--repo', '/tmp',
        ]);
        expect(exitCode).toBe(0);
        const parsed = JSON.parse(output) as unknown[];
        expect(Array.isArray(parsed)).toBe(true);
        // non-git repo → no coupling data → empty array
        expect(parsed.length).toBe(0);
    }, 30_000);

    // ── T23 — non-existent repo exits 2 with stderr message ──────────────────
    it('T23: --repo /nonexistent exits 2 and emits error to stderr', async () => {
        const { exitCode, error } = await main([
            'node', 'reponav', 'coupling',
            '--repo', '/nonexistent-coupling-test-path-xyz',
        ]);
        expect(exitCode).toBe(2);
        expect(error).toBeTruthy();
    });
});
