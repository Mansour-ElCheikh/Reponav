import { describe, it, expect } from 'vitest';
import { RegexAnalysisProvider } from './importAnalyzer';

describe('importAnalyzer', () => {
    it('RegexAnalysisProvider resolves JS/TS imports', async () => {
        const provider = new RegexAnalysisProvider();
        const files = new Map<string, string>([
            ['src/index.ts', "import { foo } from './utils';"],
            ['src/utils.ts', 'export const foo = 1;'],
        ]);
        const result = await provider.analyzeImports('/workspace', files);
        expect(result.edges.length).toBeGreaterThan(0);
        expect(result.edges[0].source).toContain('index');
    });

    it('RegexAnalysisProvider handles Python imports', async () => {
        const provider = new RegexAnalysisProvider();
        const files = new Map<string, string>([
            ['app/main.py', 'from app.utils import helper'],
            ['app/utils.py', 'def helper(): pass'],
        ]);
        const result = await provider.analyzeImports('/workspace', files);
        expect(result.edges.length).toBeGreaterThan(0);
    });

    it('RegexAnalysisProvider returns empty edges for empty workspace', async () => {
        const provider = new RegexAnalysisProvider();
        const result = await provider.analyzeImports('/workspace', new Map());
        expect(result.edges).toEqual([]);
    });
});
