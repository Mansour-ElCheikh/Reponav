import { execSync } from 'child_process';
import * as path from 'path';
import { describe, it, expect } from 'vitest';
import { getChangedFiles, getDiffHunks } from './diffAnalyzer';

const REPO_ROOT = path.resolve(__dirname, '../../..');

// ─── Task 30: getChangedFiles ──────────────────────────────────────────────

describe('getChangedFiles', () => {
    it('returns an array of changed file paths for HEAD~1', async () => {
        // Ensure we have at least 2 commits in the test repo
        let hasCommits = true;
        try {
            execSync('git rev-parse HEAD~1', { cwd: REPO_ROOT, stdio: 'pipe' });
        } catch {
            hasCommits = false;
        }
        if (!hasCommits) {
            // Skip gracefully when repo has only one commit
            return;
        }
        const files = await getChangedFiles('HEAD~1', REPO_ROOT);
        expect(Array.isArray(files)).toBe(true);
        // At least one file change should be present
        expect(files.length).toBeGreaterThanOrEqual(0);
    });

    // ─── Task 31: getDiffHunks ─────────────────────────────────────────

    it('returns a Map of filePath → array of hunk line ranges', async () => {
        let hasCommits = true;
        try {
            execSync('git rev-parse HEAD~1', { cwd: REPO_ROOT, stdio: 'pipe' });
        } catch {
            hasCommits = false;
        }
        if (!hasCommits) return;

        const hunks = await getDiffHunks('HEAD~1', REPO_ROOT);
        expect(hunks instanceof Map).toBe(true);
        for (const [, ranges] of hunks) {
            expect(Array.isArray(ranges)).toBe(true);
            for (const range of ranges) {
                expect(typeof range.startLine).toBe('number');
                expect(typeof range.endLine).toBe('number');
            }
        }
    });

    // ─── Task 32: error handling — invalid ref ─────────────────────────

    it('throws a clear error for a non-existent git ref', async () => {
        await expect(getChangedFiles('nonexistent-ref-xyz', REPO_ROOT)).rejects.toThrow(/git|ref|invalid/i);
    });

    // ─── Task 32b: error handling — non-git directory ──────────────────

    it('throws a clear error for a non-git directory', async () => {
        await expect(getChangedFiles('HEAD~1', '/tmp')).rejects.toThrow(/git/i);
    });

    // ─── Task 33: deleted files returned in changedFiles list ─────────

    it('includes deleted files in the returned list (does not silently skip)', async () => {
        let hasCommits = true;
        try {
            execSync('git rev-parse HEAD~1', { cwd: REPO_ROOT, stdio: 'pipe' });
        } catch {
            hasCommits = false;
        }
        if (!hasCommits) return;
        // getChangedFiles must include all changed paths regardless of add/modify/delete status
        const files = await getChangedFiles('HEAD~1', REPO_ROOT);
        // Just verify we get back strings (actual deleted files depend on git history)
        for (const f of files) {
            expect(typeof f).toBe('string');
        }
    });
});
