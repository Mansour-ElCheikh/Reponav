/**
 * MCP Server — RepoNav analyze tool adapter (v6.0)
 *
 * Thin MCP wrapper over the headless CLI analyzer pipeline.
 * All analysis logic lives in bin/reponav.ts main(); this file is
 * pure plumbing (tool registration + response shaping).
 *
 * Design: every tool routes through main() from bin/reponav.ts so it
 * shares the same full LocalWorkspaceAdapter (file-walker) rather than
 * the stub adapter that was previously inlined here.
 *
 * Token economy: high-volume list tools (layer-violations, dead-code,
 * coupling) accept an optional `top` param to cap output length.
 *
 * NO vscode imports (R1). Exports: createMcpServer.
 */

import * as fs from 'fs';
import * as path from 'path';
/** Implemented/Hardened by Antigravity (2026-04-26) */
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as Commands from '../commands/reponavCommands';
import { LocalWorkspaceAdapter } from '../services/LocalWorkspaceAdapter';
import { TreeSitterProvider } from '../analyzers/TreeSitterProvider';

// ─── Usage logger ─────────────────────────────────────────────────────────────

const USAGE_LOG = path.resolve(__dirname, '../../.reponav/mcp-usage.jsonl');

/**
 * Append one JSON line to .reponav/mcp-usage.jsonl.
 * Fields: timestamp, tool, repo, params (sanitized), duration_ms, output_chars, approx_tokens.
 * Never throws — logging must never block tool execution.
 */
function logUsage(entry: {
    tool: string;
    repo: string;
    params: Record<string, unknown>;
    durationMs: number;
    outputChars: number;
}): void {
    const line = JSON.stringify({
        ts: new Date().toISOString(),
        tool: entry.tool,
        repo: entry.repo,
        params: entry.params,
        duration_ms: entry.durationMs,
        output_chars: entry.outputChars,
        approx_tokens: Math.round(entry.outputChars / 4),
    });
    try {
        fs.appendFileSync(USAGE_LOG, line + '\n');
    } catch {
        // silent — log directory may not exist in test environments
    }
}

// ─── Shared helper ────────────────────────────────────────────────────────────

type ToolResult = { isError: boolean; content: Array<{ type: 'text'; text: string }> };

/**
 * Wrap a tool handler with timing and usage logging.
 * Extracts repo from args (if present) and logs duration + output size after the call.
 */
function withLogging<T extends Record<string, unknown>>(
    toolName: string,
    handler: (args: T) => Promise<ToolResult>
): (args: T) => Promise<ToolResult> {
    return async (args: T): Promise<ToolResult> => {
        const t0 = Date.now();
        const result = await handler(args);
        const outputText = result.content[0]?.text ?? '';
        const { repo, ...rest } = args;
        logUsage({
            tool: toolName,
            repo: String(repo ?? ''),
            params: rest,
            durationMs: Date.now() - t0,
            outputChars: outputText.length,
        });
        return result;
    };
}

/** Run a CLI command via handler and parse JSON output. Returns parsed data or throws on error. */
async function runCommand(
    handler: (...args: any[]) => Promise<Commands.CommandResult>,
    ...args: any[]
): Promise<{ data: unknown; isError: boolean; errorText: string }> {
    const { exitCode, output, error } = await handler(...args);
    if (exitCode === 2) {
        return { data: null, isError: true, errorText: error.trim() || 'Invalid arguments or path not found' };
    }
    try {
        return { data: JSON.parse(output), isError: false, errorText: '' };
    } catch {
        return { data: null, isError: true, errorText: `Failed to parse output: ${output.slice(0, 200)}` };
    }
}

/** Wrap a parsed result as an MCP text content response. */
function ok(data: unknown): { isError: false; content: Array<{ type: 'text'; text: string }> } {
    return { isError: false, content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

/** Wrap an error message as an MCP error response. */
function err(text: string): { isError: true; content: Array<{ type: 'text'; text: string }> } {
    return { isError: true, content: [{ type: 'text', text: text }] };
}

// ─── Server factory ───────────────────────────────────────────────────────────

/**
 * Create and return a configured McpServer with all RepoNav tools registered.
 * Caller is responsible for connecting the server to a transport.
 */
export function createMcpServer(): McpServer {
    const server = new McpServer({ name: 'reponav', version: '0.1.0' });

    // ── analyze ──────────────────────────────────────────────────────────────

    server.tool(
        'analyze',
        'Run Tier 0 + Tier 1 static analysis on a repository. ' +
        'summary format (~200-500 tokens, DEFAULT): self-calibrating hotFiles covering 80% of import traffic + orphan count + entry points. Start here. ' +
        'compact format (~20K tokens): all per-file metrics, frameworks, entry points, circular deps. ' +
        'json format (~114K tokens): full dependency graph, file classifications, layer violations, boundary roles. ' +
        'Use tier parameter to control depth (0-6). Tier 5 includes multi-repo federation. Tier 6 includes temporal intelligence (git history).',
        {
            repo: z.string().describe('Absolute or relative path to the repository root to analyze'),
            format: z
                .enum(['summary', 'compact', 'json', 'toon'])
                .optional()
                .default('summary')
                .describe('summary (~200-500 tokens, default) | compact (~20K tokens) | json (~114K tokens, full report) | toon (High-density for agents)'),
            tier: z
                .number()
                .int()
                .min(0)
                .max(6)
                .optional()
                .default(1)
                .describe('Analysis depth: 0 (Fast) to 6 (Temporal) (default: 1)'),
        },
        withLogging('analyze', async ({ repo, format, tier }) => {
            if (!repo) return err('repo argument is required');
            const resolvedRepo = path.resolve(repo);
            if (!fs.existsSync(resolvedRepo)) return err(`cannot access path "${resolvedRepo}" — does not exist`);
            const adapter = new LocalWorkspaceAdapter(resolvedRepo);
            const treeSitter = new TreeSitterProvider();
            const { exitCode, output, error } = await Commands.runAnalyze(resolvedRepo, format, tier, adapter, treeSitter);
            if (exitCode === 2) return err(error.trim() || 'Invalid arguments or path not found');
            return { isError: false, content: [{ type: 'text', text: output }] };
        })
    );

    // ── layer-violations ─────────────────────────────────────────────────────

    server.tool(
        'layer-violations',
        'Return architectural layer violations: files that import from a higher or skipped layer. ' +
        'Use top to cap output (default: all). Each violation is ~200 tokens; this repo has ~114 violations.',
        {
            repo: z.string().describe('Absolute or relative path to the repository root'),
            top: z
                .number()
                .int()
                .positive()
                .optional()
                .describe('Return only the first N violations (omit for all)'),
        },
        withLogging('layer-violations', async ({ repo, top }) => {
            if (!repo) return err('repo argument is required');
            const resolvedRepo = path.resolve(repo);
            const adapter = new LocalWorkspaceAdapter(resolvedRepo);
            const treeSitter = new TreeSitterProvider();
            
            const { data, isError, errorText } = await runCommand(
                Commands.runAnalyze, resolvedRepo, 'json', 3, adapter, treeSitter
            );
            if (isError) return err(errorText);
            const report = data as Record<string, unknown>;
            let violations = (report.layerViolations as unknown[]) ?? [];
            if (top !== undefined) violations = violations.slice(0, top);
            return ok({ layerViolations: violations });
        })
    );

    // ── blast-radius ──────────────────────────────────────────────────────────

    server.tool(
        'blast-radius',
        'Compute which files depend (directly or transitively) on a given file. ' +
        'Uses the import graph edges — paths must be relative to the repo root (e.g. src/analyzers/index.ts).',
        {
            repo: z.string().describe('Absolute or relative path to the repository root'),
            file: z.string().describe('Relative path from repo root of the file to analyse (e.g. src/foo/bar.ts)'),
        },
        withLogging('blast-radius', async ({ repo, file }) => {
            if (!repo) return err('repo argument is required');
            if (!file) return err('file argument is required');
            const resolvedRepo = path.resolve(repo);
            const adapter = new LocalWorkspaceAdapter(resolvedRepo);
            const treeSitter = new TreeSitterProvider();

            const { data, isError, errorText } = await runCommand(
                Commands.runAnalyze, resolvedRepo, 'json', 3, adapter, treeSitter
            );
            if (isError) return err(errorText);
            const report = data as Record<string, unknown>;
            const graph = report.dependencyGraph as { edges: Array<{ source: string; target: string }> };
            const edges = graph?.edges ?? [];

            // Build reverse adjacency using the relative path format edges already use
            const reverseAdj = new Map<string, Set<string>>();
            for (const edge of edges) {
                if (!reverseAdj.has(edge.target)) reverseAdj.set(edge.target, new Set());
                reverseAdj.get(edge.target)!.add(edge.source);
            }

            const direct = new Set<string>(reverseAdj.get(file) ?? []);
            const transitive = new Set<string>(direct);
            const queue = [...direct];
            while (queue.length > 0) {
                const current = queue.shift()!;
                for (const upstream of reverseAdj.get(current) ?? []) {
                    if (!transitive.has(upstream)) {
                        transitive.add(upstream);
                        queue.push(upstream);
                    }
                }
            }
            for (const d of direct) transitive.delete(d);

            return ok({
                directDependents: [...direct],
                transitiveDependents: [...transitive],
            });
        })
    );

    // ── dead-code ─────────────────────────────────────────────────────────────

    server.tool(
        'dead-code',
        'Detect unreachable symbols (Tier 2 analysis). ' +
        'Returns symbols with no callers, not exported, not entry points. ' +
        'top defaults to 25 to keep agent token spend bounded — pass an explicit ' +
        'larger value for a wider sweep.',
        {
            repo: z.string().describe('Absolute or relative path to the repository root'),
            top: z
                .number()
                .int()
                .positive()
                .optional()
                .describe('Return only the first N candidates by confidence (default 25; raise explicitly for full output)'),
            threshold: z
                .number()
                .min(0)
                .max(1)
                .optional()
                .default(0.5)
                .describe('Minimum confidence threshold (0-1, default 0.5)'),
        },
        withLogging('dead-code', async ({ repo, top, threshold }) => {
            if (!repo) return err('repo argument is required');
            const resolvedRepo = path.resolve(repo);
            const adapter = new LocalWorkspaceAdapter(resolvedRepo);
            const treeSitter = new TreeSitterProvider();

            const { data, isError, errorText } = await runCommand(
                Commands.runDeadCode, resolvedRepo, 'json', threshold ?? 0.5, adapter, treeSitter
            );
            if (isError) return err(errorText);
            let candidates = (data as unknown[]) ?? [];
            const cap = top ?? 25;
            candidates = candidates.slice(0, cap);
            return ok({ deadCode: candidates });
        })
    );

    // ── coupling ──────────────────────────────────────────────────────────────

    server.tool(
        'coupling',
        'Mine git history for co-change pairs: files that frequently change together. ' +
        'High coupling often signals hidden shared responsibility. ' +
        'top defaults to 25 to keep agent token spend bounded — pass an explicit ' +
        'larger value for a wider sweep.',
        {
            repo: z.string().describe('Absolute or relative path to the repository root'),
            top: z
                .number()
                .int()
                .positive()
                .optional()
                .describe('Return only the top N pairs by support count (default 25; raise explicitly for full output)'),
            minSupport: z
                .number()
                .int()
                .positive()
                .optional()
                .default(2)
                .describe('Minimum co-change frequency to include a pair (default 2)'),
        },
        withLogging('coupling', async ({ repo, top, minSupport }) => {
            if (!repo) return err('repo argument is required');
            const resolvedRepo = path.resolve(repo);
            const { data, isError, errorText } = await runCommand(
                Commands.runCoupling, resolvedRepo, 'json', minSupport ?? 2
            );
            if (isError) return err(errorText);
            let pairs = (data as unknown[]) ?? [];
            const cap = top ?? 25;
            pairs = pairs.slice(0, cap);
            return ok({ coupling: pairs });
        })
    );

    // ── flows ─────────────────────────────────────────────────────────────────

    server.tool(
        'flows',
        'Detect execution flow sequences from entry points through architectural layers (Tier 2). ' +
        'Useful for understanding how requests propagate through the system.',
        {
            repo: z.string().describe('Absolute or relative path to the repository root'),
        },
        withLogging('flows', async ({ repo }) => {
            if (!repo) return err('repo argument is required');
            const resolvedRepo = path.resolve(repo);
            const adapter = new LocalWorkspaceAdapter(resolvedRepo);
            const treeSitter = new TreeSitterProvider();
            const { data, isError, errorText } = await runCommand(
                Commands.runFlows, resolvedRepo, 'json', adapter, treeSitter
            );
            if (isError) return err(errorText);
            return ok({ flows: data });
        })
    );

    // ── impact ────────────────────────────────────────────────────────────────

    server.tool(
        'impact',
        'Compute symbol-level blast radius: direct and transitive callers of a function/class by hop depth. ' +
        'More precise than file-level blast-radius — use before refactoring a specific symbol.',
        {
            repo: z.string().describe('Absolute or relative path to the repository root'),
            symbol: z.string().describe('Symbol name to analyse (function, class, method, etc.)'),
            file: z.string().optional().describe('Relative file path to disambiguate symbols with the same name'),
        },
        withLogging('impact', async ({ repo, symbol, file }) => {
            if (!repo) return err('repo argument is required');
            if (!symbol) return err('symbol argument is required');
            const resolvedRepo = path.resolve(repo);
            const adapter = new LocalWorkspaceAdapter(resolvedRepo);
            const treeSitter = new TreeSitterProvider();
            const { data, isError, errorText } = await runCommand(
                Commands.runImpact, resolvedRepo, symbol, file ?? null, adapter, treeSitter
            );
            if (isError) return err(errorText);
            return ok(data);
        })
    );

    // ── risk ──────────────────────────────────────────────────────────────────

    server.tool(
        'risk',
        'PR Risk Assessment: analyze a git diff to identify high-impact changes, blast radius of touched symbols, and historical change coupling. ' +
        'Returns a risk score (0-100) and narrative summary.',
        {
            repo: z.string().describe('Absolute or relative path to the repository root'),
            diff: z.string().optional().describe('Optional path to a .diff file. If omitted, runs git diff HEAD.'),
        },
        withLogging('risk', async ({ repo, diff }) => {
            if (!repo) return err('repo argument is required');
            const resolvedRepo = path.resolve(repo);
            const adapter = new LocalWorkspaceAdapter(resolvedRepo);
            const treeSitter = new TreeSitterProvider();
            
            let diffText = '';
            try {
                if (diff) {
                    diffText = fs.readFileSync(path.resolve(diff), 'utf8');
                } else {
                    const { execSync } = await import('child_process');
                    diffText = execSync('git diff HEAD', { cwd: resolvedRepo, encoding: 'utf8' });
                }
            } catch (err: any) {
                return err(`Error reading diff: ${err.message}`);
            }

            const { data, isError, errorText } = await runCommand(
                Commands.runRisk, resolvedRepo, diffText, adapter, treeSitter
            );
            if (isError) return err(errorText);
            return ok(data);
        })
    );

    // ── seams ─────────────────────────────────────────────────────────────────

    server.tool(
        'seams',
        'Architectural Seam Detection: identifies "cut points" where a monolith or highly coupled cluster can be split. ' +
        'Ranks seams by structural betweenness and low change coupling. Use to plan decoupling refactors.',
        {
            repo: z.string().describe('Absolute or relative path to the repository root'),
        },
        withLogging('seams', async ({ repo }) => {
            if (!repo) return err('repo argument is required');
            const resolvedRepo = path.resolve(repo);
            const adapter = new LocalWorkspaceAdapter(resolvedRepo);
            const treeSitter = new TreeSitterProvider();
            const { data, isError, errorText } = await runCommand(
                Commands.runSeams, resolvedRepo, adapter, treeSitter
            );
            if (isError) return err(errorText);
            return ok(data);
        })
    );

    // ── check ─────────────────────────────────────────────────────────────────

    server.tool(
        'check',
        'Gate check: run full Tier 0+1+2 analysis and report whether thresholds are breached. ' +
        'Returns { violations, deadCode, blastRadius, breaches }. ' +
        'Useful in CI or before merging to verify the repo stays within governance bounds.',
        {
            repo: z.string().describe('Absolute or relative path to the repository root'),
            maxViolations: z
                .number()
                .int()
                .nonnegative()
                .optional()
                .describe('Fail if layer violations exceed this count'),
            maxDeadCode: z
                .number()
                .int()
                .nonnegative()
                .optional()
                .describe('Fail if dead code candidates exceed this count'),
            maxBlastRadius: z
                .number()
                .nonnegative()
                .optional()
                .describe('Fail if max blast radius score across all symbols exceeds this'),
        },
        withLogging('check', async ({ repo, maxViolations, maxDeadCode, maxBlastRadius }) => {
            if (!repo) return err('repo argument is required');
            const resolvedRepo = path.resolve(repo);
            const adapter = new LocalWorkspaceAdapter(resolvedRepo);
            const treeSitter = new TreeSitterProvider();
            
            const { exitCode, output, error } = await Commands.runCheck(
                resolvedRepo, 
                maxViolations ?? 132, 
                maxDeadCode ?? 240, 
                maxBlastRadius ?? 58, 
                adapter, 
                treeSitter
            );
            // exit 1 = threshold breached (not an error, just a gate result)
            if (exitCode === 2) return err(error.trim() || 'Invalid arguments or path not found');
            try {
                return ok(JSON.parse(output));
            } catch {
                return err(`Failed to parse output: ${output.slice(0, 200)}`);
            }
        })
    );

    return server;
}
