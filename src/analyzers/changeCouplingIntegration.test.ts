/**
 * Tests for C002 — report-integration
 * T12: CoChangePair type resolves with all required fields
 * T13: AnalysisReport.changeCoupling is optional CoChangePair[]
 * T14: analyzeTier2 populates changeCoupling from miner
 * T15: Non-git repo: changeCoupling omitted, no throw
 * T16: Tier 0/1 have no changeCoupling
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { CoChangePair, AnalysisReport, DeadCodeCandidate } from '../types';
import type { WorkspaceAdapter } from '../WorkspaceAdapter';
import { analyzeTier0, analyzeTier1, analyzeTier2 } from './index';

// ─── Minimal mock adapter ───────────────────────────────────────────────────

function makeAdapter(root = '/test/repo'): WorkspaceAdapter {
    return {
        getWorkspaceRoot: () => root,
        readFile: async () => '',
        findFiles: async (pattern: string) => {
            if (pattern.includes('package.json') || pattern.includes('lock')) return [];
            return ['src/a.ts', 'src/b.ts', 'src/c.ts'];
        },
        exists: async () => false,
        getGitChangedFiles: async () => ({ changedFiles: [], analyzedFiles: [] }),
        getConfig: <T>(_section: string, _key: string, defaultValue: T) => defaultValue,
    } as unknown as WorkspaceAdapter;
}

// ─── Shared Tier 1 report fixture for T14, T15 ──────────────────────────────

function makeTier1Report(root = '/test/repo'): AnalysisReport {
    return {
        timestamp: new Date().toISOString(),
        workspaceRoot: root,
        indexTier: 1,
        frameworks: [],
        primaryLanguage: 'TypeScript',
        entryPoints: [],
        dependencyGraph: { nodes: [], edges: [], circularDependencies: [] },
        fileClassifications: [],
        metrics: { totalFiles: 3, totalLines: 100, fileMetrics: [], hotFiles: [], orphanFiles: [] },
        fileTree: {},
        keyFileContents: {},
    };
}

// ─── T12 — CoChangePair type resolves with all required fields ───────────────

describe('C002 — report-integration', () => {
    it('T12: CoChangePair interface has fileA, fileB, support, confidence', () => {
        // Compile-time check — if this compiles, the fields exist
        const pair: CoChangePair = {
            fileA: 'src/a.ts',
            fileB: 'src/b.ts',
            support: 5,
            confidence: 0.83,
        };
        expect(pair.fileA).toBe('src/a.ts');
        expect(pair.fileB).toBe('src/b.ts');
        expect(pair.support).toBe(5);
        expect(pair.confidence).toBeCloseTo(0.83);
    });

    // ─── T13 — AnalysisReport.changeCoupling is optional CoChangePair[] ─────

    it('T13: AnalysisReport accepts changeCoupling as optional CoChangePair[]', () => {
        const report: AnalysisReport = {
            ...makeTier1Report(),
            changeCoupling: [{ fileA: 'src/a.ts', fileB: 'src/b.ts', support: 3, confidence: 0.9 }],
        };
        expect(report.changeCoupling).toHaveLength(1);

        // Also valid without the field
        const reportWithout: AnalysisReport = { ...makeTier1Report() };
        expect(reportWithout.changeCoupling).toBeUndefined();
    });

    // ─── T14 — analyzeTier2 populates changeCoupling from miner ─────────────

    it('T14: analyzeTier2 populates changeCoupling when git log returns pairs', async () => {
        // Build raw git log with 3 files co-occurring in 4+ commits
        // so we get pairs above minSupport=2 default
        const commits = [
            ['src/a.ts', 'src/b.ts'],
            ['src/a.ts', 'src/b.ts'],
            ['src/a.ts', 'src/c.ts'],
            ['src/b.ts', 'src/c.ts'],
            ['src/a.ts', 'src/b.ts'],
        ];
        const rawLog = commits.map((files, i) =>
            `commit${i}\n${files.join('\n')}`
        ).join('\n\n');

        // Mock getGitLog to return our fixture instead of running git
        const mod = await import('./changeCouplingAnalyzer');
        vi.spyOn(mod, 'getGitLog').mockReturnValue(rawLog);

        const adapter = makeAdapter();
        const files = new Map([
            ['src/a.ts', 'export const a = 1;'],
            ['src/b.ts', 'export const b = 2;'],
            ['src/c.ts', 'export const c = 3;'],
        ]);
        const tier1 = makeTier1Report();

        const report = await analyzeTier2(adapter, files, tier1);

        expect(report.changeCoupling).toBeDefined();
        expect(Array.isArray(report.changeCoupling)).toBe(true);
        // a+b co-occur 3 times, above default minSupport=2 → should be present
        const abPair = report.changeCoupling!.find(
            p => (p.fileA === 'src/a.ts' && p.fileB === 'src/b.ts') ||
                 (p.fileA === 'src/b.ts' && p.fileB === 'src/a.ts')
        );
        expect(abPair).toBeDefined();
        expect(abPair!.support).toBe(3);

        vi.restoreAllMocks();
    });

    // ─── T15 — Non-git repo: changeCoupling omitted, no throw ───────────────

    it('T15: non-git repo omits changeCoupling and does not throw', async () => {
        const mod = await import('./changeCouplingAnalyzer');
        vi.spyOn(mod, 'getGitLog').mockImplementation(() => {
            throw new Error('not a git repository');
        });

        const adapter = makeAdapter('/tmp/not-a-git-repo');
        const files = new Map([['src/a.ts', 'export const a = 1;']]);
        const tier1 = makeTier1Report('/tmp/not-a-git-repo');

        let report: AnalysisReport | undefined;
        let threw = false;
        try {
            report = await analyzeTier2(adapter, files, tier1);
        } catch {
            threw = true;
        }

        expect(threw).toBe(false);
        expect(report).toBeDefined();
        expect(report!.changeCoupling).toBeUndefined();

        vi.restoreAllMocks();
    });

    // ─── T16 — Tier 0/1 reports have no changeCoupling ──────────────────────

    it('T16: analyzeTier0 report has no changeCoupling field', async () => {
        const adapter = makeAdapter();
        const { report } = await analyzeTier0(adapter);
        expect((report as AnalysisReport).changeCoupling).toBeUndefined();
    });
});
