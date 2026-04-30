import { describe, it, expect } from 'vitest';
import { detectFrameworks, detectPrimaryLanguage } from './frameworkDetector';

describe('frameworkDetector', () => {
    it('detectFrameworks finds React in a package.json', async () => {
        const files = new Map<string, string>([
            ['package.json', JSON.stringify({ dependencies: { react: '^18.0.0' } })],
        ]);
        const result = await detectFrameworks(files);
        expect(result.length).toBeGreaterThan(0);
        expect(result.some((f) => f.name.toLowerCase().includes('react'))).toBe(true);
    });

    it('detectFrameworks returns empty for empty workspace', async () => {
        const result = await detectFrameworks(new Map());
        expect(result).toEqual([]);
    });

    it('detectPrimaryLanguage identifies TypeScript', () => {
        const lang = detectPrimaryLanguage(['src/a.ts', 'src/b.ts', 'readme.md']);
        expect(lang).toBe('TypeScript');
    });

    it('detectPrimaryLanguage identifies Python', () => {
        const lang = detectPrimaryLanguage(['app.py', 'utils.py', 'readme.md']);
        expect(lang).toBe('Python');
    });
});
