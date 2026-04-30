import { describe, expect, it } from 'vitest';
import { mapGitStatus, nullGitProvider } from './GitProvider';

describe('GitProvider helpers', () => {
    it('nullGitProvider returns a clean non-repo state', async () => {
        await expect(nullGitProvider.getState('/workspace')).resolves.toEqual({
            branch: undefined,
            changes: [],
            isGitRepo: false,
        });
    });

    it.each<readonly [number, string]>([
        [0, 'modified'],
        [5, 'modified'],
        [1, 'added'],
        [2, 'deleted'],
        [6, 'deleted'],
        [3, 'renamed'],
        [7, 'untracked'],
        [99, 'modified'],
    ])('maps git status %d to %s', (status, expected) => {
        expect(mapGitStatus(status)).toBe(expected);
    });
});