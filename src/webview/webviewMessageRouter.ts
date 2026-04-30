/**
 * webviewMessageRouter — pure message dispatch for the RepoNav webview panel.
 *
 * Intentionally has NO vscode import so it can be tested without the VS Code API.
 * All vscode-backed operations are injected via RouterContext callbacks.
 * Extracted from RepoNavWebviewProvider to separate routing from panel lifecycle.
 */
import type { LLMProvider } from '../ai/LLMProvider';
import { formatReportForAI } from '../analyzers/reportFormatting';
import type { GitProvider } from '../services/git/GitProvider';
import type { TourSerializer } from '../services/tours/TourSerializer';
import type {
    AnalysisReport,
    ExtensionToWebviewMessage,
    Tour,
    TourType,
    WebviewToExtensionMessage,
} from '../types';
import type { WorkspaceAdapter } from '../WorkspaceAdapter';
import type { AnalysisCache } from './AnalysisCache';
import type { AnalysisOrchestrator } from './AnalysisOrchestrator';

/**
 * Static usability reference served by the reponavHelp handler.
 * Covers command palette, AI provider setup, BYOK options, CLI, and MCP tools.
 * Embedded at build time: no LLM call needed, works in any mode.
 */
// Rule: REPONAV_HELP_CONTEXT must not contain ' — ' (em dash with spaces).
// Use ':' or a newline instead. This keeps card body text clean and friendly.
const REPONAV_HELP_CONTEXT = `## RepoNav Usability Reference

### Command Palette
Open the VS Code command palette (Cmd+Shift+P) and try:
- \`RepoNav: Generate Architecture Tour\`: AI-guided walkthrough of your repo
- \`RepoNav: Health Check\`: extension readiness and activation metrics

### AI Provider Setup
By default RepoNav uses **\`auto\`** mode: it picks up any VS Code Language Model already installed (GitHub Copilot, Claude extension, etc.) with no API key needed. If that is unavailable it falls back to Groq automatically.

To switch provider: **Settings > RepoNav > AI Provider**

- \`auto\`: VS Code LM first, Groq fallback (no key needed)
- \`vscode-lm\`: VS Code LM only
- \`groq\`: Llama 3.3 70B, free tier available (key: \`reponav.groqApiKey\`)
- \`anthropic\`: Claude (key: \`reponav.anthropicApiKey\`)
- \`openai\`: GPT-4o (key: \`reponav.openAIApiKey\`)
- \`gemini\`: Google Gemini (key: \`reponav.geminiApiKey\`)
- \`mock\`: offline demo, no key needed

Preferred model family when using VS Code LM: \`reponav.preferredLMFamily\` (default: \`claude\`, then gpt-4o, then gemini, then any available).

### Other Settings
- \`reponav.tourCacheEnabled\`: saves tours in \`.reponav/tours/\` so they reload instantly (default: on)
- \`reponav.maxFilesToAnalyze\`: caps how many files are scanned (default: 500)
- \`reponav.demoMode\`: shows a bundled sample tour button in the webview

### CLI Commands
Run analysis from your terminal:
\`reponav <command> --repo <path>\`

- \`analyze\`: static analysis (start here); add \`--format summary\` for a quick overview
- \`check\`: CI gate, exits 1 if thresholds are exceeded
- \`dead-code\`: finds unreachable symbols
- \`coupling\`: detects files that change together in git history
- \`flows\`: traces execution paths from entry points
- \`impact --symbol <name>\`: shows what calls a given function (blast radius)

CI threshold flags: \`--max-violations N\`, \`--max-dead-code N\`, \`--max-blast-radius N\`
Exit codes: 0 = clean, 1 = threshold exceeded, 2 = bad arguments

### MCP Tools
Configure the RepoNav MCP server in \`.vscode/mcp.json\` to let AI agents query your repo directly.
Available tools: \`analyze\`, \`layer-violations\`, \`blast-radius\`, \`dead-code\`, \`coupling\`, \`flows\`, \`impact\`, \`check\`

Output formats: \`summary\` (100-500 tokens, best default) / \`compact\` (20K tokens) / \`json\` (full report, 114K tokens)`;

/**
 * Callbacks and dependencies injected by RepoNavWebviewProvider.
 * Keeps this module free of VS Code imports (R1 boundary rule).
 */
export interface RouterContext {
    /** Open a workspace file in the editor at an optional 1-based line number. */
    openFile(filePath: string, line?: number): Promise<void>;
    /** Open the RepoNav settings panel in the VS Code UI. */
    openSettings(): void;
    /** Run the full analysis → LLM tour generation pipeline. */
    generateAndShowTour(query: string, tourType: TourType): Promise<void>;
    /** Post an analysis report to the webview. */
    sendAnalysis(report: AnalysisReport): void;
    /** Post a tour to the webview. */
    sendTour(tour: Tour): void;
    /** Post the current app config to the webview. */
    sendAppConfig(): void;
    /** Post the saved tours list to the webview. */
    sendSavedTours(): void;
    /** Kick off startup warmup behavior for ready events. */
    warmStartupAnalysis(): void;
    /** Post any extension→webview message directly. */
    postMessage(msg: ExtensionToWebviewMessage): void;
    /** Lazy-initialise and return the AnalysisOrchestrator. */
    ensureOrchestrator(): AnalysisOrchestrator;
    /** Read-only access to the analysis cache (for cache hits + report forwarding). */
    readonly cache: AnalysisCache;
    /** Read-only access to the tour serializer (may be undefined if no workspace root). */
    readonly serializer: TourSerializer | undefined;
    /** Workspace adapter for config reads and workspace root queries. */
    readonly workspace: WorkspaceAdapter;
    /** Git provider for branch / change-set queries. */
    readonly gitProvider: GitProvider;
    /** LLM provider for direct analyzer Q&A queries. */
    readonly llm: LLMProvider;
}

/**
 * Route a single webview→extension message to the appropriate handler.
 * Pure dispatch — zero vscode dependencies, fully unit-testable.
 */
export async function routeWebviewMessage(
    message: WebviewToExtensionMessage,
    ctx: RouterContext,
): Promise<void> {
    switch (message.type) {
        case 'requestTour':
            await ctx.generateAndShowTour(message.query, message.tourType);
            break;

        case 'openFile':
            await ctx.openFile(message.path, message.line);
            break;

        case 'openSettings':
            ctx.openSettings();
            break;

        case 'requestAnalysis':
            if (ctx.workspace.getWorkspaceRoot()) {
                await ctx.ensureOrchestrator().runScoped('fullWorkspace', {
                    notificationTitle: 'RepoNav: Analyzing workspace',
                    publishTier0: true,
                }, (r) => ctx.sendAnalysis(r));
            }
            break;

        case 'ready':
            // Send current config and saved tours immediately
            ctx.sendAppConfig();
            if (ctx.cache.report) {
                ctx.sendAnalysis(ctx.cache.report);
            }
            ctx.sendSavedTours();
            // Warm a lightweight Tier 0 report in the background for startup stats.
            ctx.warmStartupAnalysis();
            break;

        case 'webviewLog':
            console.info(`[RepoNav][${message.level}][webview] ${message.message}`, message.data ?? '');
            break;

        case 'loadTour':
            if (ctx.serializer) {
                const loadedTour = ctx.serializer.load(message.tourId);
                if (loadedTour) {
                    // Rebuild stale saved tours when cache has richer graph data (more nodes or cycle markers).
                    const cachedReport = ctx.cache.getCachedTier1('interactive');
                    const reportNodeCount = cachedReport?.dependencyGraph.nodes.length ?? 0;
                    const tourNodeCount = loadedTour.graph.nodes.length;
                    const reportCycleCount = cachedReport?.dependencyGraph.circularDependencies.length ?? 0;
                    const tourHasCircularMarkers = loadedTour.graph.edges.some((edge) => edge.isCircular);
                    if (cachedReport && (tourNodeCount < reportNodeCount || (!tourHasCircularMarkers && reportCycleCount > 0))) {
                        const { buildDeterministicTour } = await import('../ai/graphBuilder');
                        const freshGraph = buildDeterministicTour(cachedReport);
                        ctx.sendTour({ ...loadedTour, graph: freshGraph.graph });
                    } else {
                        ctx.sendTour(loadedTour);
                    }
                } else {
                    ctx.postMessage({ type: 'error', message: 'Tour not found' });
                }
            }
            break;

        case 'deleteTour':
            if (ctx.serializer) {
                ctx.serializer.delete(message.tourId);
                ctx.sendSavedTours();
            }
            break;

        case 'analyzerQuery': {
            const report = ctx.cache.report;
            if (!report) {
                ctx.postMessage({
                    type: 'analyzerError',
                    message: 'No analysis available yet. Open a workspace and wait for analysis to complete.',
                });
                break;
            }
            try {
                const systemPrompt =
                    'You are a codebase assistant. Answer questions about the repository based solely on the analysis report provided. ' +
                    'Be concise and reference specific files, modules, or metrics from the report when relevant.';
                const userPrompt = `Analysis report:\n${formatReportForAI(report)}\n\nQuestion: ${message.text}`;
                const result = await ctx.llm.generate(systemPrompt, userPrompt);
                ctx.postMessage({ type: 'analyzerReply', text: result.text });
            } catch (err) {
                ctx.postMessage({
                    type: 'analyzerError',
                    message: `Analysis query failed: ${err instanceof Error ? err.message : String(err)}`,
                });
            }
            break;
        }

        // chatAboutStep is not yet handled — silently ignored until v2

        case 'reponavHelp':
            ctx.postMessage({ type: 'analyzerReply', text: REPONAV_HELP_CONTEXT });
            break;
    }
}
