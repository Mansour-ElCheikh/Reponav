/**
 * RepoNav Headless CLI (v5.1)
 *
 * Thin entry point that routes Tier 0 + Tier 1 analysis to stdout.
 * No VS Code dependency. Uses LocalWorkspaceAdapter over WorkspaceAdapter interface.
 *
 * Usage:
 *   node --experimental-strip-types bin/reponav.ts analyze --repo <path> [--format json|compact]
 *   node --experimental-strip-types bin/reponav.ts --help
 *
 * Exit codes:
 *   0 — clean (no boundary violations)
 *   1 — violations detected
 *   2 — invalid arguments or path not found
 */

// Redirect perf/info logs to stderr so stdout is clean JSON for CLI/MCP consumers.
// eslint-disable-next-line no-console
console.info = (...args: unknown[]) => { process.stderr.write(args.map(String).join(' ') + '\n'); };

import { promises as fs } from 'fs';
/** Implemented/Hardened by Antigravity (2026-04-26) */
import { Command } from 'commander';
import * as path from 'path';
import { computeBlastRadius } from '../src/analyzers/blastRadiusAnalyzer';
import { getGitLog, mineChangeCoupling } from '../src/analyzers/changeCouplingAnalyzer';
import { analyzeTier0, analyzeTier1, analyzeTier2 } from '../src/analyzers/index';
import { analyzeRisk } from '../src/analyzers/riskAnalyzer';
import { TreeSitterProvider } from '../src/analyzers/TreeSitterProvider';
import { withAnalysisCompleteness } from '../src/services/analysisCompleteness';
import { LocalWorkspaceAdapter } from '../src/services/LocalWorkspaceAdapter';
import type { DeadCodeCandidate, CoChangePair } from '../src/types';

const HEADLESS_ANALYSIS_OPTIONS = { scope: 'fullWorkspace' as const };

// ─── CLI Argument Parsing ────────────────────────────────────────────────────

const USAGE = `
Usage: reponav <command> [options]

Commands:
  analyze            Run RepoNav analysis on a repository
  check              Gate: exit 1 if analysis thresholds are breached
  coupling           Mine co-change pairs from git history
  dead-code          Detect unreachable symbols
  flows              Detect execution flow sequences
  impact             Blast radius BFS for a symbol — callers by hop depth
  layer-violations   List Tier 3 architectural layer violations as JSON
  risk               PR Risk Assessment for a diff
  seams              Detect architectural seams

Options:
  --repo <path>              Path to the repository to analyze (required)
  --format <fmt>             Output format: json (default) | summary | compact | table | toon
                             summary = first orientation with architecture/risk/confidence sections
  --tier <0-6>               Analysis depth: 0 (Fast) to 6 (Temporal) (default: 1)
  --help                     Print this help message

    check-specific:
    --max-violations <n>       Fail if layer violations exceed n (default: 132)
    --max-dead-code <n>        Fail if dead code candidates exceed n (default: 240)
    --max-blast-radius <n>     Fail if max blast radius score across all symbols exceeds n (default: 58)

  impact-specific:
  --symbol <name>            Symbol name to compute blast radius for (required)
  --file <path>              Narrow to a specific file path containing the symbol (optional)

  layer-violations-specific:
  --top <n>                  Return only the first N violations (omit for all)

Exit codes:
  0  Clean — all thresholds pass
  1  Violations detected / threshold breached
  2  Invalid arguments or path not found

Examples:
  reponav analyze --repo ./my-project --format summary
  reponav analyze --repo ./my-project --format json
  reponav analyze --repo ./my-project --format summary --tier 6
  reponav check --repo ./my-project --max-violations 5 --max-dead-code 20
  reponav impact --repo ./my-project --symbol analyzeFile
`.trim();

const DEFAULT_CONFIDENCE_THRESHOLD = 0.5;
const DEFAULT_MAX_VIOLATIONS = 132;
const DEFAULT_MAX_DEAD_CODE = 240;
const DEFAULT_MAX_BLAST_RADIUS = 58;
const PERCENTAGE_SCALE = 100;
const COUPLING_CONFIDENCE_DECIMALS = 3;
const IMPACT_SYMBOL_COLUMN_WIDTH = 100;

function parseArgs(argv: string[]): { command: string | null; repo: string | null; format: string; help: boolean; threshold: number; minSupport: number; maxViolations: number; maxDeadCode: number; maxBlastRadius: number; symbol: string | null; file: string | null; diff: string | null; tier: number; top: number | null } {
    const args = argv.slice(2);
    const help = args.includes('--help') || args.includes('-h');
    const repoIdx = args.indexOf('--repo');
    const repo = repoIdx !== -1 ? args[repoIdx + 1] ?? null : null;
    const fmtIdx = args.indexOf('--format');
    const format = fmtIdx !== -1 ? args[fmtIdx + 1] ?? 'json' : 'json';
    const tierIdx = args.indexOf('--tier');
    const tier = tierIdx !== -1 ? parseInt(args[tierIdx + 1] ?? '1', 10) : 1;
    const threshIdx = args.indexOf('--threshold');
    const threshold = threshIdx !== -1 ? parseFloat(args[threshIdx + 1] ?? String(DEFAULT_CONFIDENCE_THRESHOLD)) : DEFAULT_CONFIDENCE_THRESHOLD;
    const minSupportIdx = args.indexOf('--min-support');
    const minSupport = minSupportIdx !== -1 ? parseInt(args[minSupportIdx + 1] ?? '2', 10) : 2;
    const maxViolationsIdx = args.indexOf('--max-violations');
    const maxViolations = maxViolationsIdx !== -1
        ? parseInt(args[maxViolationsIdx + 1] ?? String(DEFAULT_MAX_VIOLATIONS), 10)
        : DEFAULT_MAX_VIOLATIONS;
    const maxDeadCodeIdx = args.indexOf('--max-dead-code');
    const maxDeadCode = maxDeadCodeIdx !== -1
        ? parseInt(args[maxDeadCodeIdx + 1] ?? String(DEFAULT_MAX_DEAD_CODE), 10)
        : DEFAULT_MAX_DEAD_CODE;
    const maxBlastRadiusIdx = args.indexOf('--max-blast-radius');
    const maxBlastRadius = maxBlastRadiusIdx !== -1
        ? parseFloat(args[maxBlastRadiusIdx + 1] ?? String(DEFAULT_MAX_BLAST_RADIUS))
        : DEFAULT_MAX_BLAST_RADIUS;
    const symbolIdx = args.indexOf('--symbol');
    const symbol = symbolIdx !== -1 ? args[symbolIdx + 1] ?? null : null;
    const fileIdx = args.indexOf('--file');
    const file = fileIdx !== -1 ? args[fileIdx + 1] ?? null : null;
    const diffIdx = args.indexOf('--diff');
    const diff = diffIdx !== -1 ? args[diffIdx + 1] ?? null : null;
    const topIdx = args.indexOf('--top');
    const top = topIdx !== -1 ? parseInt(args[topIdx + 1] ?? '0', 10) || null : null;
    const command = args.find(a => !a.startsWith('-') && args.indexOf(a) === 0) ?? null;
    return { command, repo, format, help, threshold, minSupport, maxViolations, maxDeadCode, maxBlastRadius, symbol, file, diff, tier, top };
}

import * as Commands from '../src/commands/reponavCommands';

// ─── Main ────────────────────────────────────────────────────────────────────

/** Run the CLI. Exported for testing. */
export async function main(argv: string[]): Promise<{ exitCode: number; output: string; error: string }> {
    const { command, repo, format, help, threshold, minSupport, maxViolations, maxDeadCode, maxBlastRadius, symbol, file, diff, tier, top } = parseArgs(argv);

    if (help) return { exitCode: 0, output: USAGE, error: '' };

    if (!repo) {
        if (command === 'coupling') return Commands.runCoupling(null, format, minSupport);
        return { exitCode: 2, output: '', error: `Error: --repo <path> is required.\n` };
    }

    const resolvedRepo = path.resolve(repo);
    try {
        await fs.access(resolvedRepo);
    } catch {
        return { exitCode: 2, output: '', error: `Error: cannot access path "${resolvedRepo}" — does not exist.\n` };
    }

    const adapter = new LocalWorkspaceAdapter(resolvedRepo);
    const treeSitter = new TreeSitterProvider();

    // Route commands to handlers
    switch (command) {
        case 'check':
            return Commands.runCheck(resolvedRepo, maxViolations, maxDeadCode, maxBlastRadius, adapter, treeSitter);
        case 'layer-violations':
            return Commands.runLayerViolations(resolvedRepo, top, adapter, treeSitter);
        case 'impact':
            if (!symbol) return { exitCode: 2, output: '', error: 'Error: --symbol <name> is required.\n' };
            return Commands.runImpact(resolvedRepo, symbol, file, adapter, treeSitter);
        case 'risk': {
            let diffText = '';
            try {
                if (diff) {
                    diffText = await fs.readFile(path.resolve(diff), 'utf8');
                } else {
                    const { execSync } = await import('child_process');
                    diffText = execSync('git diff HEAD', { cwd: resolvedRepo, encoding: 'utf8' });
                }
            } catch (err: any) {
                return { exitCode: 2, output: '', error: `Error reading diff: ${err.message}\n` };
            }
            return Commands.runRisk(resolvedRepo, diffText, adapter, treeSitter);
        }
        case 'seams':
            return Commands.runSeams(resolvedRepo, adapter, treeSitter);
        case 'flows':
            return Commands.runFlows(resolvedRepo, format, adapter, treeSitter);
        case 'dead-code':
            return Commands.runDeadCode(resolvedRepo, format, threshold, adapter, treeSitter);
        case 'coupling':
            return Commands.runCoupling(resolvedRepo, format, minSupport);
        case 'analyze':
            return Commands.runAnalyze(resolvedRepo, format, tier, adapter, treeSitter);
        default:
            return { exitCode: 2, output: '', error: `Unknown command. Run with --help for usage.\n` };
    }
}

// ─── Entry Point ─────────────────────────────────────────────────────────────

if (process.argv[1] && (path.resolve(process.argv[1]).includes('reponav') || process.argv[1].endsWith('vite-node'))) {
    main(process.argv).then(({ exitCode, output, error }) => {
        if (output) process.stdout.write(output + '\n');
        if (error) process.stderr.write(error);
        process.exitCode = exitCode;
    }).catch((err: Error) => {
        process.stderr.write(`Fatal: ${err.message}\n`);
        process.exitCode = 2;
    });
}
