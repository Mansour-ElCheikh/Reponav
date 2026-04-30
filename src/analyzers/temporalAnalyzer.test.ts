import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TemporalAnalyzer } from './temporalAnalyzer';
import { FileMetrics } from '../types';
import * as child_process from 'child_process';

vi.mock('child_process');

describe('TemporalAnalyzer', () => {
    const mockFileMetrics: FileMetrics[] = [
        { path: 'src/index.ts', lines: 100, importCount: 5, exportCount: 2, fanIn: 10, fanOut: 5 },
        { path: 'src/utils.ts', lines: 50, importCount: 2, exportCount: 10, fanIn: 2, fanOut: 2 },
    ];

    beforeEach(() => {
        vi.resetAllMocks();
    });

    it('should correctly parse git log and compute churn and risk', async () => {
        const mockLog = [
            'COMMIT|alice@example.com|Alice|1619445600',
            'src/index.ts',
            '',
            'COMMIT|bob@example.com|Bob|1619449200',
            'src/index.ts',
            'src/utils.ts',
            '',
            'COMMIT|alice@example.com|Alice|1619452800',
            'src/index.ts',
            ''
        ].join('\n');

        vi.mocked(child_process.execSync).mockReturnValue(mockLog as any);

        const analyzer = new TemporalAnalyzer('/mock/repo');
        const result = await analyzer.analyze(mockFileMetrics);

        expect(result.averageChurn).toBeGreaterThan(0);
        
        const indexHotspot = result.hotspots.find(h => h.filePath === 'src/index.ts');
        expect(indexHotspot).toBeDefined();
        expect(indexHotspot?.commitCount).toBe(3);
        expect(indexHotspot?.complexityScore).toBe(3); // (100/100) * 3 commits
        expect(indexHotspot?.riskScore).toBeGreaterThan(0);

        const utilsHotspot = result.hotspots.find(h => h.filePath === 'src/utils.ts');
        expect(utilsHotspot?.commitCount).toBe(1);

        const indexKnowledge = result.knowledge.find(k => k.filePath === 'src/index.ts');
        expect(indexKnowledge?.owners[0].name).toBe('Alice');
        expect(indexKnowledge?.owners[0].percentage).toBe(67); // 2 out of 3 commits
    });

    it('excludes bot commits from churn metrics', async () => {
        const mockLog = [
            'COMMIT|alice@example.com|Alice|1619452800',
            'src/index.ts',
            '',
            'COMMIT|dependabot[bot]@users.noreply.github.com|dependabot[bot]|1619449200',
            'src/index.ts',
            '',
        ].join('\n');

        vi.mocked(child_process.execSync).mockReturnValue(mockLog as any);

        const analyzer = new TemporalAnalyzer('/mock/repo');
        const result = await analyzer.analyze(mockFileMetrics);

        const hotspot = result.hotspots.find(h => h.filePath === 'src/index.ts')!;
        expect(hotspot.commitCount).toBe(1); // bot commit excluded
    });

    it('recently changed files get higher riskScore than old files with equal complexity', async () => {
        const now = Math.floor(Date.now() / 1000);
        const mockLog = [
            `COMMIT|alice@example.com|Alice|${now - 86400}`, // yesterday
            'src/recent.ts',
            '',
            `COMMIT|bob@example.com|Bob|${now - 86400 * 400}`, // 400 days ago
            'src/old.ts',
            '',
        ].join('\n');

        vi.mocked(child_process.execSync).mockReturnValue(mockLog as any);

        const metrics: FileMetrics[] = [
            { path: 'src/recent.ts', lines: 100, importCount: 1, exportCount: 1, fanIn: 1, fanOut: 1 },
            { path: 'src/old.ts', lines: 100, importCount: 1, exportCount: 1, fanIn: 1, fanOut: 1 },
        ];

        const analyzer = new TemporalAnalyzer('/mock/repo');
        const result = await analyzer.analyze(metrics);

        const recent = result.hotspots.find(h => h.filePath === 'src/recent.ts')!;
        const old = result.hotspots.find(h => h.filePath === 'src/old.ts')!;

        expect(recent.complexityScore).toBe(old.complexityScore); // same size + churn
        expect(recent.riskScore).toBeGreaterThan(old.riskScore);  // but recent ranks higher
    });

    it('should fail gracefully in non-git environments', async () => {
        vi.mocked(child_process.execSync).mockImplementation(() => {
            throw new Error('fatal: not a git repository');
        });

        const analyzer = new TemporalAnalyzer('/mock/repo');
        const result = await analyzer.analyze(mockFileMetrics);

        expect(result.hotspots).toHaveLength(0);
        expect(result.averageChurn).toBe(0);
        expect(result.mostUnstableFiles).toHaveLength(0);
    });
});
