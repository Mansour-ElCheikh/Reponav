import { describe, expect, it } from 'vitest';
import { detectFrameworksFromRules } from './frameworkDetectionRules';

describe('frameworkDetectionRules', () => {
    it('detects multiple technologies from the same workspace manifests', () => {
        const files = new Map<string, string>([
            ['package.json', JSON.stringify({
                dependencies: { react: '^18.0.0' },
                devDependencies: { vite: '^5.4.1' },
                engines: { node: '>=20.0.0' },
            })],
            ['vite.config.ts', 'export default {}'],
        ]);

        const result = detectFrameworksFromRules(files);
        const names = result.map((framework) => framework.name);

        expect(names).toContain('React');
        expect(names).toContain('Vite');
        expect(names).toContain('Node.js');
    });

    it('tolerates malformed package.json while still detecting file-based signals', () => {
        const files = new Map<string, string>([
            ['package.json', '{ invalid json'],
            ['pnpm-lock.yaml', 'lockfileVersion: 9'],
        ]);

        const result = detectFrameworksFromRules(files);

        expect(result.some((framework) => framework.name === 'Node.js')).toBe(true);
        expect(result.some((framework) => framework.name === 'pnpm')).toBe(true);
        expect(result.some((framework) => framework.name === 'React')).toBe(false);
    });
});