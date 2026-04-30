import { describe, it, expect } from 'vitest';
import type { ImportEdge } from '../types';
import { collectMetrics } from './metricsCollector';

describe('metricsCollector', () => {
    it('collectMetrics counts files and lines', async () => {
        const files = new Map<string, string>([
            ['src/a.ts', 'const a = 1;\nconst b = 2;\n'],
            ['src/b.ts', 'export default {};'],
        ]);
        const result = await collectMetrics(files, []);
        expect(result.totalFiles).toBe(2);
        expect(result.totalLines).toBeGreaterThan(0);
        expect(result.fileMetrics.length).toBe(2);
    });

    it('collectMetrics identifies orphan files (zero fan-in and fan-out)', async () => {
        const files = new Map<string, string>([
            ['src/orphan.ts', 'const x = 1;'],
        ]);
        const result = await collectMetrics(files, []);
        expect(result.orphanFiles).toContain('src/orphan.ts');
    });

    it('collectMetrics returns empty for empty workspace', async () => {
        const result = await collectMetrics(new Map(), []);
        expect(result.totalFiles).toBe(0);
        expect(result.fileMetrics).toEqual([]);
    });

    it('collectMetrics self-calibrates hotFiles to 80% Pareto coverage with min/max bounds', async () => {
        const files = new Map<string, string>(
            Array.from({ length: 25 }, (_, index) => [
                `src/file-${index}.ts`,
                `export const value${index} = ${index};\n`,
            ])
        );
        const edges: ImportEdge[] = Array.from({ length: 25 }, (_, index) => ({
            source: `src/file-${index}.ts`,
            target: 'src/file-0.ts',
            specifiers: ['value0'],
            isDynamic: false,
            rawStatement: "import { value0 } from './file-0';",
        }));

        const result = await collectMetrics(files, edges);

        expect(result.hotFiles[0]?.path).toBe('src/file-0.ts');
        expect(result.hotFiles.length).toBeGreaterThanOrEqual(5);
        expect(result.hotFiles.length).toBeLessThanOrEqual(100);
        const totalFanIn = result.fileMetrics.reduce((acc, m) => acc + m.fanIn, 0);
        const hotFanIn = result.hotFiles.reduce((acc, m) => acc + m.fanIn, 0);
        expect(hotFanIn / totalFanIn).toBeGreaterThanOrEqual(0.8);
    });
});
