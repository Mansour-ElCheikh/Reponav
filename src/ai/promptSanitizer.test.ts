import { describe, it, expect } from 'vitest';
import { sanitizeForProvider } from './promptSanitizer';

describe('sanitizeForProvider', () => {
    const workspaceRoot = '/Users/alice/projects/my-repo';

    it('strips the workspace root prefix from absolute paths in the text', () => {
        const text = `## File: /Users/alice/projects/my-repo/src/extension.ts\nSome content`;
        const result = sanitizeForProvider(text, 'Groq', workspaceRoot);
        expect(result).not.toContain('/Users/alice/projects/my-repo');
        expect(result).toContain('src/extension.ts');
    });

    it('is a no-op when text already contains only relative paths', () => {
        const text = `## File: src/extension.ts\nSome content`;
        const result = sanitizeForProvider(text, 'Anthropic', workspaceRoot);
        expect(result).toBe(text);
    });

    it('is a no-op for VS Code Language Model provider', () => {
        const text = `/Users/alice/projects/my-repo/src/extension.ts and more`;
        const result = sanitizeForProvider(text, 'VS Code Language Model', workspaceRoot);
        expect(result).toBe(text);
    });

    it('handles workspaceRoot with trailing slash', () => {
        const text = `/Users/alice/projects/my-repo/src/db/RepoDatabase.ts`;
        const result = sanitizeForProvider(text, 'OpenAI', workspaceRoot + '/');
        expect(result).not.toContain('/Users/alice/projects/my-repo/');
        expect(result).toContain('src/db/RepoDatabase.ts');
    });

    it('replaces multiple occurrences in a single text', () => {
        const text = [
            `## File: /Users/alice/projects/my-repo/src/a.ts`,
            `## File: /Users/alice/projects/my-repo/src/b.ts`,
        ].join('\n');
        const result = sanitizeForProvider(text, 'Gemini', workspaceRoot);
        expect(result).not.toContain('/Users/alice/projects/my-repo');
        expect(result).toContain('src/a.ts');
        expect(result).toContain('src/b.ts');
    });
});
