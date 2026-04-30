import { describe, it, expect } from 'vitest';
import { buildFileTree, extractKeyFileContents, PREVIEW_CONTENT_PATHS, readWorkspaceFiles } from './fileReading';

const KEY_FILE_CONTENT_LIMIT = 5_000;
const MAX_TEXT_FILE_BYTES = 100_000;

function makeAnalysisOptions(candidatePaths: string[]) {
    return {
        scope: 'interactive' as const,
        maxFiles: candidatePaths.length,
        preferredRoots: [],
        candidatePaths,
    };
}

function makeAdapter(readFileImpl: (absolutePath: string) => Promise<string | null>) {
    return {
        getWorkspaceRoot: () => '/repo',
        readFile: readFileImpl,
    };
}

describe('fileReading', () => {
    it('buildFileTree produces nested structure from flat paths', () => {
        const tree = buildFileTree(['src/a.ts', 'src/b.ts', 'lib/c.ts']);
        expect(tree).toHaveProperty('src');
        expect(tree).toHaveProperty('lib');
    });

    it('extractKeyFileContents extracts package.json and README.md', () => {
        const files = new Map<string, string>([
            ['package.json', '{"name":"test"}'],
            ['README.md', '# Hello'],
            ['src/index.ts', 'export {}'],
        ]);
        const result = extractKeyFileContents(files);
        expect(result['package.json']).toBe('{"name":"test"}');
        expect(result['README.md']).toBe('# Hello');
        expect(result['src/index.ts']).toBeUndefined();
    });

    it('extractKeyFileContents truncates long key files to the current context limit', () => {
        const readmeContent = 'a'.repeat(KEY_FILE_CONTENT_LIMIT + 100);
        const files = new Map<string, string>([
            ['README.md', readmeContent],
        ]);

        const result = extractKeyFileContents(files);

        expect(result['README.md']).toHaveLength(KEY_FILE_CONTENT_LIMIT);
        expect(result['README.md']).toBe(readmeContent.slice(0, KEY_FILE_CONTENT_LIMIT));
    });

    it('readWorkspaceFiles keeps files at the current large-file threshold and skips larger ones', async () => {
        const filesByPath = new Map<string, string>([
            ['README.md', 'a'.repeat(MAX_TEXT_FILE_BYTES)],
            ['package.json', 'b'.repeat(MAX_TEXT_FILE_BYTES + 1)],
        ]);
        const adapter = makeAdapter(async (absolutePath) => filesByPath.get(absolutePath.replace('/repo/', '')) ?? null);

        const result = await readWorkspaceFiles(adapter as any, makeAnalysisOptions(['README.md', 'package.json']));

        expect(result.get('README.md')).toHaveLength(MAX_TEXT_FILE_BYTES);
        expect(result.has('package.json')).toBe(false);
    });

    it('readWorkspaceFiles skips files with null bytes in the current binary sniff window', async () => {
        const adapter = makeAdapter(async (absolutePath) => {
            const relativePath = absolutePath.replace('/repo/', '');
            if (relativePath === 'README.md') {
                return `hello\0world`;
            }
            return null;
        });

        const result = await readWorkspaceFiles(adapter as any, makeAnalysisOptions(['README.md']));

        expect(result.has('README.md')).toBe(false);
    });

    it('PREVIEW_CONTENT_PATHS contains expected key files', () => {
        expect(PREVIEW_CONTENT_PATHS.has('package.json')).toBe(true);
    });
});
