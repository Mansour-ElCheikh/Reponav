import { execSync } from 'child_process';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CoChangePair } from '../types';
vi.mock('child_process', () => ({
    execSync: vi.fn(() => ''),
}));
import {
    parseGitLog,
    computeSupport,
    computeConfidence,
    filterBySupport,
    getGitLog,
    mineChangeCoupling,
} from './changeCouplingAnalyzer';

beforeEach(() => {
    vi.clearAllMocks();
});

// ─── Task 1: Parse git log output into commit file sets ─────────────────────

describe('parseGitLog', () => {
    it('parses raw git log output into per-commit file-path sets', () => {
        const raw = [
            'abc123',
            'src/foo.ts',
            'src/bar.ts',
            '',
            'def456',
            'src/baz.ts',
            '',
            'ghi789',
            'src/foo.ts',
            'src/baz.ts',
        ].join('\n');

        const result = parseGitLog(raw);

        expect(result).toHaveLength(3);
        expect(result[0]).toEqual(new Set(['src/foo.ts', 'src/bar.ts']));
        expect(result[1]).toEqual(new Set(['src/baz.ts']));
        expect(result[2]).toEqual(new Set(['src/foo.ts', 'src/baz.ts']));
    });

    it('returns empty array for empty git log', () => {
        expect(parseGitLog('')).toEqual([]);
    });
});

// ─── Task 2: Compute pairwise support counts ────────────────────────────────

describe('computeSupport', () => {
    it('counts co-occurrences for all pairs', () => {
        const commitSets: Set<string>[] = [
            new Set(['A', 'B']),
            new Set(['A', 'B']),
            new Set(['A', 'C']),
        ];
        const support = computeSupport(commitSets);

        expect(support.get('A|B')).toBe(2);
        expect(support.get('A|C')).toBe(1);
        expect(support.get('B|C')).toBeUndefined();
    });

    it('single-file commits produce no pairs', () => {
        const support = computeSupport([new Set(['A'])]);
        expect(support.size).toBe(0);
    });
});

// ─── Task 3: Compute confidence scores ──────────────────────────────────────

describe('computeConfidence', () => {
    it('computes confidence as support / frequency of fileA', () => {
        // A appears in 3 commits, A+B co-occur in 2 → confidence = 2/3
        const freq = new Map([['A', 3], ['B', 2]]);
        const confidence = computeConfidence('A', 'B', 2, freq);
        expect(confidence).toBeCloseTo(2 / 3, 5);
    });
});

// ─── Task 4: Filter by minimum support threshold ────────────────────────────

describe('filterBySupport', () => {
    it('returns only pairs at or above minSupport threshold', () => {
        const pairs: CoChangePair[] = [
            { fileA: 'a', fileB: 'b', support: 1, confidence: 0.5 },
            { fileA: 'a', fileB: 'c', support: 2, confidence: 0.8 },
            { fileA: 'b', fileB: 'c', support: 3, confidence: 0.9 },
        ];
        const result = filterBySupport(pairs, 2);
        expect(result).toHaveLength(2);
        expect(result.map(p => p.support)).toEqual([3, 2]);
    });
});

// ─── Task 5: Exclude non-source extensions ──────────────────────────────────

describe('parseGitLog — extension filtering', () => {
    it('excludes non-source files from commit sets', () => {
        const raw = 'abc123\nlogo.png\ndist/bundle.js\nsrc/foo.ts\n';
        const result = parseGitLog(raw);
        expect(result[0]).toEqual(new Set(['src/foo.ts']));
    });
});

// ─── Task 6: Exclude node_modules / .git / dist paths ───────────────────────

describe('parseGitLog — path exclusion', () => {
    it('excludes node_modules paths', () => {
        const raw = 'abc123\nnode_modules/react/index.js\nsrc/app.ts\n';
        const result = parseGitLog(raw);
        expect(result[0]).not.toContain('node_modules/react/index.js');
        expect(result[0]).toContain('src/app.ts');
    });
});

// ─── Task 7: Single-file commit produces no pairs ───────────────────────────

describe('mineChangeCoupling — single-file commits', () => {
    it('produces no pairs from single-file commits', () => {
        const commitSets = [new Set(['A']), new Set(['B']), new Set(['C'])];
        const support = computeSupport(commitSets);
        expect(support.size).toBe(0);
    });
});

// ─── Task 8: Empty repo returns empty array ─────────────────────────────────

describe('mineChangeCoupling — empty input', () => {
    it('returns empty array without throwing for empty git log', () => {
        const result = mineChangeCoupling('', { minSupport: 2 });
        expect(result).toEqual([]);
    });
});

// ─── Task 9: Output sorted by support descending ────────────────────────────

describe('mineChangeCoupling — sort order', () => {
    it('returns pairs sorted by support descending', () => {
        // A.ts+B.ts co-occur 3×, A.ts+C.ts 1×, B.ts+C.ts 2×
        const raw = [
            'h1\nsrc/A.ts\nsrc/B.ts\n',
            'h2\nsrc/A.ts\nsrc/B.ts\n',
            'h3\nsrc/A.ts\nsrc/B.ts\n',
            'h4\nsrc/B.ts\nsrc/C.ts\n',
            'h5\nsrc/B.ts\nsrc/C.ts\n',
            'h6\nsrc/A.ts\nsrc/C.ts\n',
        ].join('');
        const result = mineChangeCoupling(raw, { minSupport: 1, ubiquityThreshold: 1.0 });
        expect(result[0].support).toBeGreaterThanOrEqual(result[1].support);
        expect(result[1].support).toBeGreaterThanOrEqual(result[2].support);
    });

    it('keeps the current three-decimal confidence rounding in mined pairs', () => {
        const raw = [
            'h1\nsrc/A.ts\nsrc/B.ts\n',
            'h2\nsrc/A.ts\nsrc/B.ts\n',
            'h3\nsrc/A.ts\nsrc/C.ts\n',
        ].join('');

        const result = mineChangeCoupling(raw, { minSupport: 1, ubiquityThreshold: 1.0 });
        const pair = result.find((entry) => entry.fileA === 'src/A.ts' && entry.fileB === 'src/B.ts');

        expect(pair?.confidence).toBe(0.667);
    });
});

// ─── Task 10: Performance on 1,000 commits / 500 files ──────────────────────

describe('mineChangeCoupling — performance', () => {
    it('completes in under 300ms on 1,000-commit / 500-file fixture', () => {
        // Build raw git log string: 1000 commits, each touching 2–5 random files
        const files = Array.from({ length: 500 }, (_, i) => `src/file${i}.ts`);
        const lines: string[] = [];
        for (let i = 0; i < 1000; i++) {
            lines.push(`commit${i}`);
            const count = 2 + (i % 4);
            for (let j = 0; j < count; j++) {
                lines.push(files[(i * 3 + j) % 500]);
            }
            lines.push('');
        }
        const raw = lines.join('\n');

        const start = performance.now();
        mineChangeCoupling(raw, { minSupport: 2 });
        const elapsed = performance.now() - start;

        expect(elapsed).toBeLessThan(300);
    });
});

// ─── Task 11: Precision ≥ 75% on labeled fixture ────────────────────────────

describe('mineChangeCoupling — precision on labeled fixture', () => {
    it('achieves precision ≥ 0.75 on 20-pair labeled fixture', () => {
        // Build raw log: 15 truly coupled pairs (appear 5× each),
        //               5 noise pairs (appear 1× each, below threshold)
        const truePairs = Array.from({ length: 15 }, (_, i) => [`trueA${i}.ts`, `trueB${i}.ts`]);
        const noisePairs = Array.from({ length: 5 }, (_, i) => [`noiseA${i}.ts`, `noiseB${i}.ts`]);

        const lines: string[] = [];
        let commitIdx = 0;
        // true pairs: 5 co-occurrences each (above minSupport=3)
        for (const [a, b] of truePairs) {
            for (let k = 0; k < 5; k++) {
                lines.push(`commit${commitIdx++}`, a, b, '');
            }
        }
        // noise pairs: 1 co-occurrence each (below minSupport=3)
        for (const [a, b] of noisePairs) {
            lines.push(`commit${commitIdx++}`, a, b, '');
        }

        const raw = lines.join('\n');
        const result = mineChangeCoupling(raw, { minSupport: 3 });

        const truePairKeys = new Set(truePairs.map(([a, b]) => `${a}|${b}`));
        const tp = result.filter(p => truePairKeys.has(`${p.fileA}|${p.fileB}`) || truePairKeys.has(`${p.fileB}|${p.fileA}`)).length;
        const precision = tp / result.length;

        expect(precision).toBeGreaterThanOrEqual(0.75);
    });
});

// ─── Task 11a: Ubiquitous file excluded from pairs ──────────────────────────

describe('mineChangeCoupling — ubiquitous file exclusion', () => {
    it('excludes files present in > 80% of commits', () => {
        // package.json in 90 of 100 commits — should be excluded
        const lines: string[] = [];
        for (let i = 0; i < 100; i++) {
            lines.push(`commit${i}`);
            if (i < 90) lines.push('package.json');
            lines.push(`src/module${i % 10}.ts`);
            lines.push('');
        }
        const raw = lines.join('\n');
        const result = mineChangeCoupling(raw, { minSupport: 2 });
        const mentionsPackageJson = result.some(p => p.fileA === 'package.json' || p.fileB === 'package.json');
        expect(mentionsPackageJson).toBe(false);
    });
});

// ─── Task 11b: Large repo capped at 2,000 commits ───────────────────────────

describe('mineChangeCoupling — commit cap', () => {
    it('uses only the most-recent 2,000 commits when repo has more', () => {
        // Build 2,500 commits; only commits 500+ (most-recent 2,000) contain pair src/X.ts + src/Y.ts
        const lines: string[] = [];
        for (let i = 0; i < 2500; i++) {
            lines.push(`commit${i}`);
            if (i >= 500) {
                // These 2,000 commits are the "most recent" → should be included
                lines.push('src/X.ts', 'src/Y.ts');
            } else {
                lines.push('src/old.ts', 'src/other.ts');
            }
            lines.push('');
        }
        const raw = lines.join('\n');
        const result = mineChangeCoupling(raw, { minSupport: 5 });
        // X+Y pair should appear (from cap window), old+other should not (outside cap)
        const xyPair = result.find(p =>
            (p.fileA === 'src/X.ts' && p.fileB === 'src/Y.ts') ||
            (p.fileA === 'src/Y.ts' && p.fileB === 'src/X.ts')
        );
        expect(xyPair).toBeDefined();
    });
});

describe('getGitLog', () => {
    it('uses the current command and max buffer size', () => {
        vi.mocked(execSync).mockReturnValue('raw-log' as never);

        const result = getGitLog('/repo');

        expect(result).toBe('raw-log');
        expect(execSync).toHaveBeenCalledWith(
            'git log --name-only --pretty=format:"%H" --diff-filter=AM',
            { cwd: '/repo', encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 }
        );
    });
});
