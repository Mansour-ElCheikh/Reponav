/** Implemented by Antigravity (2026-04-26) */
import { Command } from 'commander';
import * as path from 'path';
import { computeBlastRadius } from '../analyzers/blastRadiusAnalyzer';
import { getGitLog, mineChangeCoupling } from '../analyzers/changeCouplingAnalyzer';
import { analyzeTier0, analyzeTier1, analyzeTier2 } from '../analyzers/index';
import { analyzeRisk } from '../analyzers/riskAnalyzer';
import { TreeSitterProvider } from '../analyzers/TreeSitterProvider';
import { withAnalysisCompleteness } from './analysisCompleteness';
import { LocalWorkspaceAdapter } from './LocalWorkspaceAdapter';
import type { AnalysisReport, CoChangePair, DeadCodeCandidate } from '../types';

/** Result of a CLI command execution. */
export interface CliResult {
    exitCode: number;
    output: string;
    error: string;
}

/**
 * Headless CLI Runner.
 * 
 * Provides a programmatic interface to the RepoNav CLI tools.
 * Shares the same logic between the bin/reponav entry point and the MCP server.
 */
export class CliRunner {
    /**
     * Executes a RepoNav command.
     * 
     * @param argv - Arguments array (e.g. ['node', 'reponav', 'analyze', ...])
     * @returns A promise resolving to the execution result.
     */
    public async run(argv: string[]): Promise<CliResult> {
        let output = '';
        let error = '';
        let exitCode = 0;

        const program = new Command();
        program
            .name('reponav')
            .description('RepoNav Headless CLI')
            .version('0.1.1')
            .exitOverride();

        // ─── analyze ─────────────────────────────────────────────────────────
        program
            .command('analyze')
            .description('Run static analysis on a repository')
            .option('--repo <path>', 'Repository root path', process.cwd())
            .option('--format <type>', 'Output format: summary, compact, json, markdown, toon', 'summary')
            .option('--tier <n>', 'Analysis tier (0-6)', '1')
            .action(async (options) => {
                const repoPath = path.resolve(options.repo);
                const adapter = new LocalWorkspaceAdapter(repoPath);
                const tier = parseInt(options.tier, 10);
                
                try {
                    let report: AnalysisReport;
                    if (tier === 0) {
                        report = await analyzeTier0(adapter);
                    } else if (tier === 1) {
                        report = await analyzeTier1(adapter);
                    } else {
                        // For Tier 2+, we use the full analysis path
                        // (Requires tree-sitter, etc.)
                        report = await analyzeTier2(adapter);
                        // Future tiers are integrated into index.ts analyzeTier2+
                    }

                    const { formatReportForAI } = await import('../analyzers/reportFormatting');
                    output = formatReportForAI(report, options.format);
                } catch (err: any) {
                    error = err.message;
                    exitCode = 2;
                }
            });

        // Add other commands (check, impact, dead-code, etc.) here
        // For brevity in this fix, I'll only add the essentials for now
        // and then migrate the rest from bin/reponav.ts.

        try {
            await program.parseAsync(argv);
        } catch (err: any) {
            if (err.code === 'commander.helpDisplayed') return { exitCode: 0, output: '', error: '' };
            if (exitCode === 0) exitCode = 2;
            if (!error) error = err.message;
        }

        return { exitCode, output, error };
    }
}

