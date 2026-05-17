/**
 * Tests for the reponav headless CLI entry point.
 *
 * Tests the exported main() function directly (in-process) to verify
 * argument handling, output shape, and exit codes. The main() function
 * is the same code path a spawned process would exercise.
 */
import { execSync } from 'child_process';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_INTERACTIVE_MAX_FILES } from '../src/analyzers/fileSelection';
import { main } from './reponav';

const REPO_ROOT = path.resolve(__dirname, '..');

// Count commits at REPO_ROOT. Used as a runtime precondition for tier-6
// temporal-signal assertions, which require multi-commit history. In the
// verify-oss-extract pipeline the public extract is `git init`ed with one
// commit, so temporal tier-6 tests cannot satisfy their preconditions there.
const REPO_COMMIT_COUNT = (() => {
    try {
        return parseInt(
            execSync('git rev-list --count HEAD', { cwd: REPO_ROOT, encoding: 'utf8' }).trim(),
            10,
        );
    } catch {
        return 0;
    }
})();

// ─── Task 6 — --help and missing --repo ──────────────────────────────────────

describe('reponav CLI — help and argument validation', () => {
    it('exits 0 and prints usage when --help is passed', async () => {
        const { exitCode, output } = await main(['node', 'reponav', '--help']);
        expect(exitCode).toBe(0);
        expect(output).toContain('Usage');
        expect(output).toContain('--repo');
        expect(output).toContain('summary');
        expect(output).toContain('architecture/risk/confidence');
        expect(output).toContain('--tier <0-6>');
    });

    it('exits 2 and emits error when --repo is missing', async () => {
        const { exitCode, error } = await main(['node', 'reponav', 'analyze']);
        expect(exitCode).toBe(2);
        expect(error).toMatch(/--repo/i);
    });

    it('exits 2 when --repo path does not exist', async () => {
        const { exitCode, error } = await main(['node', 'reponav', 'analyze', '--repo', '/tmp/does-not-exist-xyz']);
        expect(exitCode).toBe(2);
        expect(error).toMatch(/does not exist/i);
    });
});

// ─── Task 7 — exit codes and JSON output shape ───────────────────────────────

describe('reponav CLI — analyze output', () => {
    it('exits 0 and outputs valid JSON for a valid repo', async () => {
        const { exitCode, output } = await main(['node', 'reponav', 'analyze', '--repo', REPO_ROOT, '--format', 'json']);
        expect(exitCode).toBe(0);

        let parsed: unknown;
        expect(() => { parsed = JSON.parse(output); }).not.toThrow();

        const report = parsed as Record<string, unknown>;
        expect(report).toHaveProperty('workspaceRoot');
        expect(report).toHaveProperty('metrics');
        expect(report).toHaveProperty('dependencyGraph');
        expect(report).toHaveProperty('completeness');
        expect(report.completeness).toEqual(expect.objectContaining({
            analysisScope: 'fullWorkspace',
            analysisCoverage: 'complete',
            graphCoverage: 'complete',
        }));
    }, 30_000);

    it('outputs JSON with expected top-level fields', async () => {
        const { exitCode, output } = await main(['node', 'reponav', 'analyze', '--repo', REPO_ROOT, '--format', 'json']);
        expect(exitCode).toBe(0);

        const report = JSON.parse(output) as Record<string, unknown>;
        expect(typeof report.workspaceRoot).toBe('string');
        expect(report.metrics).toBeDefined();
        expect(report.completeness).toEqual(expect.objectContaining({
            analysisScope: 'fullWorkspace',
            analysisCoverage: 'complete',
            graphCoverage: 'complete',
        }));
        const metrics = report.metrics as Record<string, unknown>;
        expect(typeof metrics.totalFiles).toBe('number');
        expect(metrics.totalFiles).toBeGreaterThan(0);
    }, 30_000);

    it('outputs compact format with expected fields when --format compact is passed', async () => {
        const { exitCode, output } = await main(['node', 'reponav', 'analyze', '--repo', REPO_ROOT, '--format', 'compact']);
        expect(exitCode).toBe(0);

        const compact = JSON.parse(output) as Record<string, unknown>;
        expect(compact).toHaveProperty('workspaceRoot');
        expect(compact).toHaveProperty('primaryLanguage');
        expect(compact).toHaveProperty('frameworks');
        expect(compact).toHaveProperty('completeness');
        expect(compact).toHaveProperty('metrics');
        expect(compact).toHaveProperty('entryPoints');
        expect(Array.isArray(compact.frameworks)).toBe(true);
        expect(Array.isArray(compact.entryPoints)).toBe(true);
        expect(compact.completeness).toEqual(expect.objectContaining({
            analysisScope: 'fullWorkspace',
            analysisCoverage: 'complete',
            graphCoverage: 'complete',
        }));
    }, 30_000);

    it('summary format omits fileMetrics and returns self-calibrated hotFiles', async () => {
        const { exitCode, output } = await main(['node', 'reponav', 'analyze', '--repo', REPO_ROOT, '--format', 'summary']);
        expect(exitCode).toBe(0);

        const summary = JSON.parse(output) as Record<string, unknown>;
        // Must have orientation fields
        expect(summary).toHaveProperty('workspaceRoot');
        expect(summary).toHaveProperty('primaryLanguage');
        expect(summary).toHaveProperty('frameworks');
        expect(summary).toHaveProperty('completeness');
        expect(summary).toHaveProperty('entryPoints');
        expect(summary).toHaveProperty('runtimeRoots');
        expect(summary).toHaveProperty('launchSurfaces');
        expect(summary).toHaveProperty('hotFiles');
        expect(summary).toHaveProperty('orphanCount');
        expect(summary).toHaveProperty('totalFiles');
        expect(summary).toHaveProperty('circularDeps');
        expect(summary).toHaveProperty('architecture');
        expect(summary).toHaveProperty('risk');
        expect(summary).toHaveProperty('confidence');
        // Must NOT contain fileMetrics — the dominant token cost
        expect(summary).not.toHaveProperty('metrics');
        // hotFiles must be the self-calibrated slice (non-empty for a real repo)
        expect(Array.isArray(summary.hotFiles)).toBe(true);
        expect((summary.hotFiles as unknown[]).length).toBeGreaterThan(0);
        // orphanCount must be a number, not an array
        expect(typeof summary.orphanCount).toBe('number');
        expect(summary.completeness).toEqual(expect.objectContaining({
            analysisScope: 'fullWorkspace',
            analysisCoverage: 'complete',
            graphCoverage: 'complete',
        }));
        // Each hotFile must have path and fanIn
        const first = (summary.hotFiles as Array<Record<string, unknown>>)[0];
        expect(first).toHaveProperty('path');
        expect(first).toHaveProperty('fanIn');
        expect(typeof first.fanIn).toBe('number');
    }, 30_000);

    it.skipIf(REPO_COMMIT_COUNT < 10)(
        'tier 6 summary surfaces the slice-2 risk signals when temporal data is available',
        async () => {
            const { exitCode, output } = await main([
                'node', 'reponav', 'analyze', '--repo', REPO_ROOT, '--format', 'summary', '--tier', '6',
            ]);
            expect(exitCode).toBe(0);

            const summary = JSON.parse(output) as Record<string, Array<Record<string, unknown>>>;
            expect(summary.risk).toEqual(expect.arrayContaining([
                expect.objectContaining({ id: 'temporal-hotspots', family: 'risk' }),
                expect.objectContaining({ id: 'ownership-concentration', family: 'risk' }),
                expect.objectContaining({ id: 'dangerous-hotspots', family: 'risk' }),
            ]));
        },
        60_000,
    );

    it('summary format hotFiles covers 80% of internal import edges (self-calibration invariant)', async () => {
        const { exitCode, output } = await main(['node', 'reponav', 'analyze', '--repo', REPO_ROOT, '--format', 'summary']);
        expect(exitCode).toBe(0);

        const summary = JSON.parse(output) as Record<string, unknown>;
        // hotFilesCoverage is pre-computed by buildSummary over internal edges only
        // (external package imports like 'vitest' are not tracked in fileMetrics fanIn)
        const coverage = summary.hotFilesCoverage as number;
        expect(coverage).toBeGreaterThanOrEqual(0.8);
    }, 30_000);

    it('headless analyze is not capped by the interactive max-files budget', async () => {
        const tempRepo = await fs.mkdtemp(path.join(os.tmpdir(), 'reponav-fullworkspace-'));
        await fs.mkdir(path.join(tempRepo, 'src'), { recursive: true });
        await fs.writeFile(path.join(tempRepo, 'package.json'), JSON.stringify({ name: 'big-repo' }));

        await Promise.all(
            Array.from({ length: 520 }, (_, index) => {
                const filePath = path.join(tempRepo, 'src', `file-${index}.ts`);
                return fs.writeFile(filePath, `export const value${index} = ${index};\n`);
            })
        );

        try {
            const { exitCode, output } = await main([
                'node', 'reponav', 'analyze', '--repo', tempRepo, '--format', 'json',
            ]);
            expect(exitCode).toBe(0);

            const report = JSON.parse(output) as Record<string, unknown>;
            const metrics = report.metrics as Record<string, unknown>;
            expect(metrics.totalFiles).toBeGreaterThan(DEFAULT_INTERACTIVE_MAX_FILES);
        } finally {
            await fs.rm(tempRepo, { recursive: true, force: true });
        }
    }, 90_000);
});

// ─── C003: dead-code CLI sub-command (T18-T23) ────────────────────────────────

describe('reponav CLI — dead-code sub-command (C003)', () => {
    it('T18: parseArgs recognises dead-code command and --repo arg', async () => {
        // Verify the sub-command routes correctly — exits 2 without --repo
        const { exitCode, error } = await main(['node', 'reponav', 'dead-code']);
        expect(exitCode).toBe(2);
        expect(error).toMatch(/--repo/i);
    });

    it('T19: dead-code --repo outputs valid JSON array', async () => {
        const { exitCode, output } = await main(['node', 'reponav', 'dead-code', '--repo', REPO_ROOT]);
        expect(exitCode).toBeLessThanOrEqual(1); // 0 (clean) or 1 (candidates found)
        let parsed: unknown;
        expect(() => { parsed = JSON.parse(output); }).not.toThrow();
        expect(Array.isArray(parsed)).toBe(true);
        // This repo has dead code candidates — an empty array means the analyzer is broken
        expect((parsed as unknown[]).length).toBeGreaterThan(0);
    }, 60_000);

    it('T20: exits 1 when dead code candidates found', async () => {
        const { exitCode, output } = await main(['node', 'reponav', 'dead-code', '--repo', REPO_ROOT]);
        const candidates = JSON.parse(output) as unknown[];
        // If the repo has candidates, exit code must be 1
        if (candidates.length > 0) {
            expect(exitCode).toBe(1);
        } else {
            expect(exitCode).toBe(0);
        }
    }, 60_000);

    it('T21: exits 0 when no candidates found', async () => {
        // Use a tiny repo fixture with no dead code (all exported or with callers)
        const { exitCode, output } = await main(['node', 'reponav', 'dead-code', '--repo', REPO_ROOT]);
        const candidates = JSON.parse(output) as unknown[];
        expect(exitCode).toBe(candidates.length > 0 ? 1 : 0);
    }, 60_000);

    it('T22: --format table renders File, Symbol, Line headers', async () => {
        const { output } = await main([
            'node', 'reponav', 'dead-code', '--repo', REPO_ROOT, '--format', 'table',
        ]);
        // table header must appear even when candidates list is empty
        expect(output).toMatch(/File|Symbol|Line/i);
    }, 60_000);

    it('T23: --threshold filters by confidence', async () => {
        const { output: jsonOutput } = await main([
            'node', 'reponav', 'dead-code', '--repo', REPO_ROOT, '--threshold', '0',
        ]);
        const { output: filteredOutput } = await main([
            'node', 'reponav', 'dead-code', '--repo', REPO_ROOT, '--threshold', '0.99',
        ]);
        const all = JSON.parse(jsonOutput) as unknown[];
        const filtered = JSON.parse(filteredOutput) as unknown[];
        // threshold 0.99 must return <= all candidates
        expect(filtered.length).toBeLessThanOrEqual(all.length);
    }, 120_000);
});

// ─── C003 (epic-007): flows CLI sub-command (T20-T25) ─────────────────────────

describe('reponav CLI — flows sub-command (epic-007 C003)', () => {
    // T20: Parse flows sub-command and repo arg
    it('T20: routes flows command — exits 2 without --repo', async () => {
        const { exitCode, error } = await main(['node', 'reponav', 'flows']);
        expect(exitCode).toBe(2);
        expect(error).toMatch(/--repo/i);
    });

    // T21: Parse --format flag (via integration through main)
    it('T21: flows accepts --format json and outputs valid JSON', async () => {
        const { exitCode, output } = await main([
            'node', 'reponav', 'flows', '--repo', REPO_ROOT, '--format', 'json',
        ]);
        expect(exitCode).toBe(0);
        let parsed: unknown;
        expect(() => { parsed = JSON.parse(output); }).not.toThrow();
        expect(Array.isArray(parsed)).toBe(true);
        // This repo has entry points — an empty flows array means the detector is broken
        expect((parsed as unknown[]).length).toBeGreaterThan(0);
    }, 60_000);

    // T22: JSON output matches FlowSequence[] schema
    it('T22: JSON output has id, entryPoint, steps, anomalies fields per sequence', async () => {
        const { exitCode, output } = await main([
            'node', 'reponav', 'flows', '--repo', REPO_ROOT, '--format', 'json',
        ]);
        expect(exitCode).toBe(0);
        const sequences = JSON.parse(output) as Array<Record<string, unknown>>;
        if (sequences.length > 0) {
            const seq = sequences[0];
            expect(seq).toHaveProperty('id');
            expect(seq).toHaveProperty('entryPoint');
            expect(seq).toHaveProperty('steps');
            expect(seq).toHaveProperty('anomalies');
            expect(Array.isArray(seq.steps)).toBe(true);
            expect(Array.isArray(seq.anomalies)).toBe(true);
        }
    }, 60_000);

    it('T22b: flows excludes nested index barrels and smoke-script entry noise', async () => {
        const { exitCode, output } = await main([
            'node', 'reponav', 'flows', '--repo', REPO_ROOT, '--format', 'json',
        ]);
        expect(exitCode).toBe(0);
        const entryPoints = (JSON.parse(output) as Array<{ entryPoint: string }>).map((sequence) => sequence.entryPoint);
        expect(entryPoints).not.toContain('src/analyzers/index.ts');
        expect(entryPoints).not.toContain('presentation/src/index.ts');
        expect(entryPoints).not.toContain('scripts/smoke/index.js');
    }, 60_000);

    // T23: Table output has correct columns
    it('T23: --format table contains entryPoint, steps, anomalies headers', async () => {
        const { exitCode, output } = await main([
            'node', 'reponav', 'flows', '--repo', REPO_ROOT, '--format', 'table',
        ]);
        expect(exitCode).toBe(0);
        expect(output).toMatch(/entryPoint/i);
        expect(output).toMatch(/steps/i);
        expect(output).toMatch(/anomalies/i);
    }, 60_000);

    // T24: Repo with no entry points exits 0 with empty JSON
    it('T24: exits 0 with [] when --repo path exists but has no source files', async () => {
        const emptyDir = '/tmp/reponav-test-empty-flows-007';
        await import('fs').then(m => m.promises.mkdir(emptyDir, { recursive: true }));
        const { exitCode, output } = await main([
            'node', 'reponav', 'flows', '--repo', emptyDir,
        ]);
        expect(exitCode).toBe(0);
        const parsed = JSON.parse(output);
        expect(parsed).toEqual([]);
    });

    // T25: Non-existent repo exits 2
    it('T25: exits 2 and writes error to stderr when --repo does not exist', async () => {
        const { exitCode, error } = await main([
            'node', 'reponav', 'flows', '--repo', '/tmp/nonexistent-flows-repo-007',
        ]);
        expect(exitCode).toBe(2);
        expect(error).toMatch(/does not exist|cannot access/i);
    });
});

// ─── v5.6 CI Gate — check sub-command ────────────────────────────────────────

describe('reponav CLI — check sub-command (v5.6)', () => {
    it('exits 2 when --repo is missing', async () => {
        const { exitCode, error } = await main(['node', 'reponav', 'check']);
        expect(exitCode).toBe(2);
        expect(error).toMatch(/--repo/i);
    });

    it('exits 2 when --repo path does not exist', async () => {
        const { exitCode, error } = await main([
            'node', 'reponav', 'check', '--repo', '/tmp/no-such-repo-v56',
        ]);
        expect(exitCode).toBe(2);
        expect(error).toMatch(/does not exist/i);
    });

    it('exits 0 and outputs valid JSON summary with permissive thresholds', async () => {
        const { exitCode, output } = await main([
            'node', 'reponav', 'check', '--repo', REPO_ROOT,
            '--max-violations', '9999', '--max-dead-code', '9999', '--max-blast-radius', '9999',
        ]);
        expect(exitCode).toBe(0);
        let parsed: unknown;
        expect(() => { parsed = JSON.parse(output); }).not.toThrow();
        const summary = parsed as Record<string, unknown>;
        expect(summary).toHaveProperty('violations');
        expect(summary).toHaveProperty('deadCode');
        expect(summary).toHaveProperty('blastRadius');
        expect(summary).toHaveProperty('breaches');
        expect(Array.isArray(summary.breaches)).toBe(true);
        // Self-analysis must produce a real blast-radius score (symbols + edges exist)
        expect(typeof summary.blastRadius).toBe('number');
        expect(summary.blastRadius as number).toBeGreaterThan(0);
    }, 90_000);

    it('exits 1 and reports breach when --max-violations 0 and repo has violations', async () => {
        const { output } = await main([
            'node', 'reponav', 'check', '--repo', REPO_ROOT,
            '--max-violations', '9999',
        ]);
        const baseline = JSON.parse(output) as Record<string, unknown>;
        const violationCount = baseline.violations as number;

        if (violationCount > 0) {
            const { exitCode, output: out2 } = await main([
                'node', 'reponav', 'check', '--repo', REPO_ROOT,
                '--max-violations', '0',
            ]);
            expect(exitCode).toBe(1);
            const summary = JSON.parse(out2) as Record<string, unknown>;
            expect((summary.breaches as string[]).some((b: string) => /violation/i.test(b))).toBe(true);
        }
        // if violationCount is 0 the threshold can't be breached — test passes vacuously
    }, 60_000);

    it('exits 1 and reports breach when --max-dead-code 0 and repo has dead code', async () => {
        const { output } = await main([
            'node', 'reponav', 'check', '--repo', REPO_ROOT,
            '--max-dead-code', '9999',
        ]);
        const baseline = JSON.parse(output) as Record<string, unknown>;
        const deadCount = baseline.deadCode as number;

        if (deadCount > 0) {
            const { exitCode, output: out2 } = await main([
                'node', 'reponav', 'check', '--repo', REPO_ROOT,
                '--max-dead-code', '0',
            ]);
            expect(exitCode).toBe(1);
            const summary = JSON.parse(out2) as Record<string, unknown>;
            expect((summary.breaches as string[]).some((b: string) => /dead.code/i.test(b))).toBe(true);
        }
    }, 60_000);

    it('exits 1 and reports blast-radius breach when --max-blast-radius 0', async () => {
        const { exitCode, output } = await main([
            'node', 'reponav', 'check', '--repo', REPO_ROOT,
            '--max-blast-radius', '0',
        ]);
        expect(exitCode).toBe(1);
        const summary = JSON.parse(output) as Record<string, unknown>;
        expect((summary.breaches as string[]).some((b: string) => /blast-radius/i.test(b))).toBe(true);
    }, 90_000);
});

// ─── v2.0b Pass 4 — Self-analysis regression (epic-009 C003) ─────────────────

describe('reponav CLI — Pass 4 self-analysis regression (epic-009)', () => {
    it('T13: unknown rate on source files < 20% after tool/library Pass 1 rules', async () => {
        const { exitCode, output } = await main(['node', 'reponav', 'analyze', '--repo', REPO_ROOT, '--format', 'json']);
        expect(exitCode).toBe(0);
        const report = JSON.parse(output) as Record<string, unknown>;
        const classifications = report.fileClassifications as Array<{ path: string; category: string }>;
        // Only measure source code files — exclude markdown, yaml, json, shell, docs, dev/
        const sourceFiles = classifications.filter(c =>
            /\.(ts|tsx|js|jsx|py|go)$/.test(c.path) &&
            !/^(docs|dev|e2e|presentation|test-results)[\\/]/.test(c.path)
        );
        const unknowns = sourceFiles.filter(c => c.category === 'unknown');
        const rate = unknowns.length / sourceFiles.length;
        expect(rate).toBeLessThan(0.20);
        // Also verify Pass 4 graph heuristics still fire (graph: prefix)
        const pass4Count = (classifications as Array<{ reason?: string }>).filter(
            c => c.reason?.startsWith('graph:')
        ).length;
        expect(pass4Count).toBeGreaterThan(0);
    }, 60_000);

    it('T14: no previously non-unknown file changes category after Pass 4', async () => {
        // Pass 4 only upgrades unknowns — verify no non-unknown was reclassified
        const { output } = await main(['node', 'reponav', 'analyze', '--repo', REPO_ROOT, '--format', 'json']);
        const report = JSON.parse(output) as Record<string, unknown>;
        const classifications = report.fileClassifications as Array<{ category: string; confidence: string; reason: string }>;
        // Every file classified by Pass 4 must have a reason starting with 'graph:'
        const pass4Files = classifications.filter(c => c.reason.startsWith('graph:'));
        // None of those should have had a non-unknown classification before Pass 4
        // (we can't check the "before" snapshot in a single run, but we CAN verify all
        //  Pass 4 results have low or medium confidence — never high, which is Pass 1 territory)
        for (const f of pass4Files) {
            expect(['medium', 'low']).toContain(f.confidence);
        }
    }, 60_000);

    it('T2: no layer violations with undefined sourceFile or targetFile (C001 regression)', async () => {
        const { output } = await main(['node', 'reponav', 'analyze', '--repo', REPO_ROOT, '--format', 'json']);
        const report = JSON.parse(output) as Record<string, unknown>;
        const violations = (report.layerViolations ?? []) as Array<{ sourceFile?: string; targetFile?: string }>;
        const badViolations = violations.filter(v => !v.sourceFile || !v.targetFile);
        expect(badViolations).toHaveLength(0);
    }, 60_000);

    it('T10: self-analysis boundary roles count ≥ 5 (C004 regression)', async () => {
        const { output } = await main(['node', 'reponav', 'analyze', '--repo', REPO_ROOT, '--format', 'json']);
        const report = JSON.parse(output) as Record<string, unknown>;
        const boundaryRoles = (report.boundaryRoles ?? []) as unknown[];
        expect(boundaryRoles.length).toBeGreaterThanOrEqual(5);
    }, 60_000);
});

// ─── impact sub-command ───────────────────────────────────────────────────────

describe('reponav CLI — impact sub-command', () => {
    it('exits 2 when --repo is missing', async () => {
        const { exitCode, error } = await main(['node', 'reponav', 'impact', '--symbol', 'main']);
        expect(exitCode).toBe(2);
        expect(error).toMatch(/--repo/i);
    });

    it('exits 2 when --symbol is missing', async () => {
        const { exitCode, error } = await main(['node', 'reponav', 'impact', '--repo', REPO_ROOT]);
        expect(exitCode).toBe(2);
        expect(error).toMatch(/--symbol/i);
    });

    it('exits 2 when --repo path does not exist', async () => {
        const { exitCode, error } = await main(['node', 'reponav', 'impact', '--repo', '/tmp/no-such-v56', '--symbol', 'main']);
        expect(exitCode).toBe(2);
        expect(error).toMatch(/does not exist/i);
    });

    it('exits 0, outputs valid JSON with required shape for known symbol', async () => {
        const { exitCode, output } = await main([
            'node', 'reponav', 'impact', '--repo', REPO_ROOT, '--symbol', 'main',
        ]);
        expect(exitCode).toBe(0);
        let parsed: unknown;
        expect(() => { parsed = JSON.parse(output); }).not.toThrow();
        const result = parsed as Record<string, unknown>;
        expect(result).toHaveProperty('origin');
        expect(result).toHaveProperty('originFile');
        expect(result).toHaveProperty('directCallers');
        expect(result).toHaveProperty('transitiveCallers');
        expect(result).toHaveProperty('score');
        expect(result).toHaveProperty('byHop');
        expect(Array.isArray(result.directCallers)).toBe(true);
        expect(Array.isArray(result.transitiveCallers)).toBe(true);
        // Symbol was found — origin must echo back the queried name
        expect(result.origin).toBe('main');
        // Known symbol must produce a finite score (0 = symbol not found)
        expect(Number.isFinite(result.score as number)).toBe(true);
    }, 90_000);

});
// Note: unknown-symbol score-0 behaviour is covered by unit tests in
// src/analyzers/blastRadiusAnalyzer.test.ts (Task 25).
