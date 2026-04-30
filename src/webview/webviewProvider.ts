/**
 * WebView Provider
 *
 * Manages the RepoNav WebView panel that displays tour visualizations.
 * Communicates with the React app via postMessage protocol.
 *
 * Delegates analysis caching to AnalysisCache and analysis orchestration
 * to AnalysisOrchestrator. This facade owns panel lifecycle, message
 * handling, and VS Code API interactions.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { buildDeterministicTour } from '../ai/graphBuilder';
import { TourGenerator } from '../ai/tourGenerator';
import { partitionFlowsByEntrySurface } from '../analyzers/entrySurface';
import { partitionEntryPointsBySurface } from '../analyzers/entrySurface';
import type { SymbolEnricher } from '../analyzers/symbolEnrichment';
import { TreeSitterProvider } from '../analyzers/TreeSitterProvider';
import { GitProvider, nullGitProvider } from '../services/git/GitProvider';
import { TourSerializer } from '../services/tours/TourSerializer';
import {
    Tour,
    AnalysisReport,
    AppConfig,
    ExtensionToWebviewMessage,
    WebviewToExtensionMessage,
    TourType,
} from '../types';
import { WorkspaceAdapter } from '../WorkspaceAdapter';
import { AnalysisCache } from './AnalysisCache';
import { AnalysisOrchestrator } from './AnalysisOrchestrator';
import type { OrchestratorProgressReporter } from './AnalysisOrchestrator';
import { handleWebviewMessageDelegated } from './webviewMessageHandler';
import type { RouterContext } from './webviewMessageRouter';

const PERF_LOG_PREFIX = '[RepoNav][perf][webviewProvider]';
const DEBUG_LOG_PREFIX = '[RepoNav][debug][webviewProvider]';
const CACHE_INVALIDATION_DEBOUNCE_MS = 300;
const NONCE_LENGTH = 32;
const PERF_WARN_THRESHOLDS = {
    tier1Ms: 3_000,
    generationMs: 60_000,
    totalMs: 65_000,
};
const STREAM_TIMEOUT_MS = 60_000;
const DEV_STARTUP_WARMUP_THROTTLE_MS = 3_000;

/** Main extension-side controller for the RepoNav webview panel. */
export class RepoNavWebviewProvider {
    public static readonly viewType = 'reponav.tourView';

    private panel: vscode.WebviewPanel | undefined;
    private extensionUri: vscode.Uri;
    private serializer: TourSerializer | undefined;
    private invalidateTimer: ReturnType<typeof setTimeout> | undefined;
    private assetCache = new Map<string, string>();
    private readonly cache: AnalysisCache;
    private orchestrator: AnalysisOrchestrator | undefined;
    private lastWarmupOnReadyAtMs = 0;
    private lastProvisionalGraphSignature: string | null = null;

    constructor(
        private readonly context: vscode.ExtensionContext,
        private readonly tourGenerator: TourGenerator,
        private readonly workspace: WorkspaceAdapter,
        private readonly gitProvider: GitProvider = nullGitProvider,
        private readonly symbolEnricher?: SymbolEnricher
    ) {
        this.extensionUri = context.extensionUri;

        // Initialize serializer if workspace exists
        const wsRoot = workspace.getWorkspaceRoot();
        if (wsRoot) {
            this.serializer = new TourSerializer(wsRoot);
        }

        // Initialize analysis cache. Orchestrator (and TreeSitterProvider) are created lazily
        // on first show() call so the web-tree-sitter module is not required at activation.
        this.cache = new AnalysisCache();

        // Invalidate analysis cache whenever workspace contents change.
        context.subscriptions.push(
            vscode.workspace.onDidSaveTextDocument(() => this.invalidateAnalysisCache('save')),
            vscode.workspace.onDidCreateFiles(() => this.invalidateAnalysisCache('create')),
            vscode.workspace.onDidDeleteFiles(() => this.invalidateAnalysisCache('delete')),
            vscode.workspace.onDidRenameFiles(() => this.invalidateAnalysisCache('rename')),
            vscode.workspace.onDidChangeWorkspaceFolders(() => this.invalidateAnalysisCache('workspaceFolders'))
        );
    }

    /**
     * Returns the AnalysisOrchestrator, creating it (and TreeSitterProvider) on first call.
     * Deferred so the web-tree-sitter module is not required at extension activation.
     */
    private ensureOrchestrator(): AnalysisOrchestrator {
        if (!this.orchestrator) {
            const progressReporter: OrchestratorProgressReporter = {
                withProgress: async <T>(
                    title: string,
                    task: (report: (value: { message?: string; increment?: number }) => void) => Promise<T>
                ): Promise<T> => {
                    return vscode.window.withProgress(
                        { location: vscode.ProgressLocation.Notification, title, cancellable: false },
                        async (progress) => task((value) => progress.report(value))
                    ) as Promise<T>;
                },
            };
            this.orchestrator = new AnalysisOrchestrator(
                this.cache,
                this.workspace,
                new TreeSitterProvider(),
                progressReporter,
                this.symbolEnricher
            );
        }
        return this.orchestrator;
    }

    /**
     * Show or create the WebView panel.
     */
    public show() {
        if (this.panel) {
            this.panel.reveal(vscode.ViewColumn.Beside);
            return;
        }

        this.panel = vscode.window.createWebviewPanel(
            RepoNavWebviewProvider.viewType,
            'RepoNav Tour',
            vscode.ViewColumn.Beside,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [
                    vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview'),
                    vscode.Uri.joinPath(this.extensionUri, 'media'),
                ],
            }
        );
        // Handle messages from the WebView before booting content to avoid losing early messages.
        this.panel.webview.onDidReceiveMessage(
            (message: WebviewToExtensionMessage) => this.handleWebviewMessage(message),
            undefined,
            this.context.subscriptions
        );

        this.panel.webview.html = this.getWebviewContent(this.panel.webview);
        this.panel.iconPath = vscode.Uri.joinPath(this.extensionUri, 'media', 'icon.svg');
        this.sendAppConfig();

        this.panel.onDidDispose(() => {
            this.panel = undefined;
            if (this.invalidateTimer) {
                clearTimeout(this.invalidateTimer);
                this.invalidateTimer = undefined;
            }
        });
    }

    /**
     * Send a tour to the WebView for display.
     */
    public sendTour(tour: Tour) {
        this.postMessage({ type: 'tourGenerated', tour });
    }

    /**
     * Send an analysis report to the WebView.
     * Projects only the fields the webview needs (Summary shape) so the full AnalysisReport
     * never bleeds across the boundary, but circular dependency count IS included.
     */
    public sendAnalysis(report: AnalysisReport) {
        const reviewFlows = report.flows ? partitionFlowsByEntrySurface(report.flows) : undefined;
        const entryPoints = partitionEntryPointsBySurface(report.entryPoints);
        const summary: import('../../shared/types').AnalysisReportSummary = {
            indexTier: report.indexTier,
            frameworks: report.frameworks,
            completeness: report.completeness,
            entryPoints: entryPoints.runtimeEntryPoints,
            ...(entryPoints.launchSurfaces.length > 0 ? { launchSurfaces: entryPoints.launchSurfaces } : {}),
            metrics: { totalFiles: report.metrics.totalFiles, totalLines: report.metrics.totalLines },
            dependencyGraph: {
                edges: report.dependencyGraph.edges.map(e => ({ source: e.source, target: e.target })),
                circularDependencies: report.dependencyGraph.circularDependencies.length,
            },
            deadCodeFiles: report.deadCode?.map(c => c.filePath),
            changeCouplingCount: report.changeCoupling?.length,
            analysisHints: report.analysisHints?.map(h => h.message),
            ...(reviewFlows !== undefined
                ? {
                    flowCount: reviewFlows.runtimeFlows.length,
                    flows: reviewFlows.runtimeFlows,
                    ...(reviewFlows.toolingFlows.length > 0
                        ? {
                            toolingFlowCount: reviewFlows.toolingFlows.length,
                            toolingEntryPoints: reviewFlows.toolingFlows.map((flow) => flow.entryPoint),
                        }
                        : {}),
                }
                : {}),
        };
        this.postMessage({ type: 'analysisComplete', report: summary });
    }

    /**
     * Show the deterministic dependency graph without LLM narration.
     * Runs analysis if needed, then sends a graph-only Tour to the webview.
     */
    public async showDeterministicGraph() {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            vscode.window.showErrorMessage('No workspace folder open');
            return;
        }

        this.show();
        this.postMessage({ type: 'tourGenerating', status: 'Analyzing dependencies...' });

        try {
            const cachedReport = this.cache.getCachedTier1('interactive');
            let report: AnalysisReport;

            if (cachedReport) {
                report = cachedReport;
                this.sendAnalysis(report);
            } else {
                const analysis = await this.ensureOrchestrator().runScoped('interactive', {
                    notificationTitle: 'RepoNav: Analyzing dependencies',
                    publishTier0: true,
                    includeTier2: false,
                    onStatus: (status) => {
                        this.postMessage({ type: 'tourGenerating', status });
                    },
                }, (r) => this.sendAnalysis(r));
                report = analysis.report;
            }

            const { buildDeterministicTour } = await import('../ai/graphBuilder');
            this.sendTour(buildDeterministicTour(report));
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            this.postMessage({ type: 'error', message: msg });
        }
    }

    /**
     * Run the full flow: analyze -> generate -> display.
     */
    public async generateAndShowTour(query: string, tourType: TourType = 'custom') {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            vscode.window.showErrorMessage('No workspace folder open');
            return;
        }

        if (!this.tourGenerator.isReady()) {
            const config = vscode.workspace.getConfiguration('reponav');
            const providerSetting = config.get<string>('aiProvider', 'gemini');
            const providerLabels: Record<string, string> = {
                groq: 'Groq', gemini: 'Gemini', anthropic: 'Anthropic', openai: 'OpenAI', mock: 'Mock'
            };
            const settingsKeys: Record<string, string> = {
                groq: 'reponav.groqApiKey', gemini: 'reponav.geminiApiKey', anthropic: 'reponav.anthropicApiKey',
                openai: 'reponav.openAIApiKey', mock: 'reponav.aiProvider'
            };
            const label = providerLabels[providerSetting] || 'AI';
            const settingsKey = settingsKeys[providerSetting] || 'reponav.geminiApiKey';
            const setKey = 'Set API Key';
            const result = await vscode.window.showErrorMessage(
                `${label} API key not configured. Please set it in RepoNav settings.`,
                setKey
            );
            if (result === setKey) {
                vscode.commands.executeCommand('workbench.action.openSettings', settingsKey);
            }
            return;
        }

        // Show the panel
        this.show();
        const workflowStart = Date.now();
        const workspaceId = path.basename(workspaceFolder.uri.fsPath);
        const providerName = this.tourGenerator.getProviderName();
        console.info(`${DEBUG_LOG_PREFIX} generateAndShowTour:start`, {
            workspaceId,
            providerName,
            query,
            tourType,
        });

        try {
            const cachedReport = this.cache.getCachedTier1('interactive');
            let tier0Ms = 0;
            let tier1Ms = 0;
            let tier2Ms = 0;
            let report: AnalysisReport;
            let provisionalGraphSent = false;

            const sendAnalysisAndMaybePreviewGraph = (analysisReport: AnalysisReport) => {
                this.sendAnalysis(analysisReport);

                if (provisionalGraphSent || analysisReport.indexTier < 1) {
                    return;
                }

                const graphSignature = this.buildProvisionalGraphSignature(analysisReport);
                if (this.lastProvisionalGraphSignature === graphSignature) {
                    // The current view already shows this deterministic graph.
                    // Mark as sent so AI graph chunks are still suppressed for this request.
                    provisionalGraphSent = true;
                    return;
                }

                const deterministicTour = buildDeterministicTour(analysisReport, { maxNodes: 200, graphMode: 'file' });
                this.postMessage({
                    type: 'tour.stream_chunk',
                    payload: {
                        type: 'graph',
                        data: {
                            ...deterministicTour,
                            query,
                            tourType,
                            steps: [],
                        },
                    },
                });
                this.lastProvisionalGraphSignature = graphSignature;
                provisionalGraphSent = true;
            };

            if (cachedReport) {
                report = cachedReport;
                this.postMessage({ type: 'tourGenerating', status: 'Using cached analysis...' });
                console.info(`${DEBUG_LOG_PREFIX} phase=analysisCache:hit`, {
                    workspaceId,
                    workspaceVersion: this.cache.workspaceVersion,
                    totalFiles: report.metrics.totalFiles,
                    totalEdges: report.dependencyGraph.edges.length,
                });
                sendAnalysisAndMaybePreviewGraph(report);
            } else {
                console.info(`${DEBUG_LOG_PREFIX} phase=analysisCache:miss`, {
                    workspaceId,
                    workspaceVersion: this.cache.workspaceVersion,
                    hasCurrentReport: this.cache.report !== undefined,
                });

                const analysis = await this.ensureOrchestrator().runScoped('interactive', {
                    notificationTitle: 'RepoNav: Analyzing dependencies',
                    publishTier0: true,
                    includeTier2: true,
                    onStatus: (status) => {
                        this.postMessage({ type: 'tourGenerating', status });
                    },
                }, (r) => sendAnalysisAndMaybePreviewGraph(r));
                tier0Ms = analysis.tier0Ms;
                tier1Ms = analysis.tier1Ms;
                tier2Ms = analysis.tier2Ms;
                report = analysis.report;
            }

            // Tour Generation — streaming path
            this.postMessage({ type: 'tourGenerating', status: 'Generating tour with AI...' });
            const generationStart = Date.now();
            console.info(`${DEBUG_LOG_PREFIX} phase=tourGeneration:start`, { workspaceId, providerName });

            await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: 'RepoNav: Generating tour',
                    cancellable: false,
                },
                async () => {
                    const postStreamingMessage = (message: ExtensionToWebviewMessage) => {
                        if (
                            provisionalGraphSent &&
                            message.type === 'tour.stream_chunk' &&
                            message.payload.type === 'graph'
                        ) {
                            return;
                        }

                        this.postMessage(message);
                    };

                    await this.withTimeout(
                        this.tourGenerator.generateTourStream(
                            report,
                            query,
                            tourType,
                            postStreamingMessage
                        ),
                        STREAM_TIMEOUT_MS,
                        'tour stream',
                    );
                }
            );

            const generationMs = Date.now() - generationStart;
            console.info(`${DEBUG_LOG_PREFIX} phase=tourGeneration:done`, {
                workspaceId,
                providerName,
                generationMs,
            });

            // Show provider-aware completion message.
            // Re-read provider name in case DynamicLLMProvider cascaded to a fallback.
            const finalProviderName = this.tourGenerator.getProviderName();
            vscode.window.showInformationMessage(
                `Tour generated via ${finalProviderName}.`
            );

            const perfMetrics = {
                workspaceId,
                providerName,
                tourType,
                totalMs: Date.now() - workflowStart,
                tier0Ms,
                tier1Ms,
                tier2Ms,
                generationMs,
                totalFiles: report.metrics.totalFiles,
                totalEdges: report.dependencyGraph.edges.length,
            };

            console.info(`${PERF_LOG_PREFIX} summary`, perfMetrics);

            if (perfMetrics.tier1Ms > PERF_WARN_THRESHOLDS.tier1Ms) {
                console.warn(
                    `${PERF_LOG_PREFIX} warn threshold=tier1Ms value=${perfMetrics.tier1Ms} limit=${PERF_WARN_THRESHOLDS.tier1Ms}`,
                    { workspaceId, providerName, tourType }
                );
            }

            if (perfMetrics.generationMs > PERF_WARN_THRESHOLDS.generationMs) {
                console.warn(
                    `${PERF_LOG_PREFIX} warn threshold=generationMs value=${perfMetrics.generationMs} limit=${PERF_WARN_THRESHOLDS.generationMs}`,
                    { workspaceId, providerName, tourType }
                );
            }

            if (perfMetrics.totalMs > PERF_WARN_THRESHOLDS.totalMs) {
                console.warn(
                    `${PERF_LOG_PREFIX} warn threshold=totalMs value=${perfMetrics.totalMs} limit=${PERF_WARN_THRESHOLDS.totalMs}`,
                    { workspaceId, providerName, tourType }
                );
            }
        } catch (error: any) {
            console.error('Tour generation failed:', error);
            console.error(`${PERF_LOG_PREFIX} failed`, {
                workspaceId,
                providerName,
                tourType,
                totalMs: Date.now() - workflowStart,
            });
            console.error(`${DEBUG_LOG_PREFIX} generateAndShowTour:failed`, {
                workspaceId,
                providerName,
                tourType,
                errorMessage: error?.message,
            });
            this.postMessage({
                type: 'error',
                message: error.message || 'Tour generation failed',
            });
            vscode.window.showErrorMessage(`RepoNav: ${error.message}`);
        }
    }

    // ─── Private Methods ────────────────────────────────────────────────────

    private async handleWebviewMessage(message: WebviewToExtensionMessage) {
        console.info(`${DEBUG_LOG_PREFIX} webview->extension`, { type: message.type });
        const ctx: RouterContext = {
            openFile: (p, l) => this.openFileInternal(p, l),
            openSettings: () => this.openSettingsInternal(),
            generateAndShowTour: (q, t) => this.generateAndShowTour(q, t),
            sendAnalysis: (r) => this.sendAnalysis(r),
            sendTour: (t) => this.sendTour(t),
            sendAppConfig: () => this.sendAppConfig(),
            sendSavedTours: () => this.sendSavedTours(),
            warmStartupAnalysis: () => this.warmStartupAnalysis(),
            postMessage: (m) => this.postMessage(m),
            ensureOrchestrator: () => this.ensureOrchestrator(),
            cache: this.cache,
            serializer: this.serializer,
            workspace: this.workspace,
            gitProvider: this.gitProvider,
            llm: this.tourGenerator.getLLMProvider(),
        };
        await handleWebviewMessageDelegated(message, ctx);
    }

    // Run startup warmup and throttle duplicate ready-triggered warmups in development mode.
    private warmStartupAnalysis(): void {
        if (this.context.extensionMode === vscode.ExtensionMode.Development) {
            const now = Date.now();
            if (now - this.lastWarmupOnReadyAtMs < DEV_STARTUP_WARMUP_THROTTLE_MS) {
                return;
            }
            this.lastWarmupOnReadyAtMs = now;
        }

        void this.ensureOrchestrator().ensureWarmTier0((r) => this.sendAnalysis(r));
    }

    // Build a deterministic signature for deciding whether a provisional graph is already on screen.
    private buildProvisionalGraphSignature(report: AnalysisReport): string {
        const edgeKey = report.dependencyGraph.edges
            .map((edge) => `${edge.source}->${edge.target}`)
            .join('|');
        return `${report.indexTier}:${report.dependencyGraph.nodes.join('|')}:${edgeKey}`;
    }

    // Fail a long-running async operation after `ms` to prevent stuck streaming sessions.
    private withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
        return new Promise<T>((resolve, reject) => {
            const timeoutId = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
            promise.then(
                (value) => {
                    clearTimeout(timeoutId);
                    resolve(value);
                },
                (error) => {
                    clearTimeout(timeoutId);
                    reject(error);
                },
            );
        });
    }

    // Open a file in the editor — vscode-backed, not exported to router
    private async openFileInternal(filePath: string, line?: number): Promise<void> {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) return;
        const fileUri = vscode.Uri.joinPath(workspaceFolder.uri, filePath);
        try {
            const doc = await vscode.workspace.openTextDocument(fileUri);
            const editor = await vscode.window.showTextDocument(doc, {
                viewColumn: vscode.ViewColumn.One,
                preserveFocus: true,
                preview: false,
            });
            if (line) {
                const range = new vscode.Range(
                    new vscode.Position(line - 1, 0),
                    new vscode.Position(line - 1, 0)
                );
                editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
                editor.selection = new vscode.Selection(range.start, range.end);
            }
        } catch {
            vscode.window.showWarningMessage(`Could not open file: ${filePath}`);
        }
    }

    // Open the RepoNav settings panel — vscode-backed, not exported to router
    private openSettingsInternal(): void {
        vscode.commands.executeCommand('workbench.action.openSettings', 'reponav');
    }

    private postMessage(message: ExtensionToWebviewMessage) {
        if (message.type === 'tourGenerating' || message.type === 'error' || message.type === 'tourGenerated') {
            console.info(`${DEBUG_LOG_PREFIX} extension->webview`, {
                type: message.type,
                ...(message.type === 'tourGenerating' ? { status: message.status } : {}),
                ...(message.type === 'error' ? { error: message.message } : {}),
            });
        }
        this.panel?.webview.postMessage(message);
    }

    private invalidateAnalysisCache(reason: string) {
        if (this.invalidateTimer) clearTimeout(this.invalidateTimer);
        this.invalidateTimer = setTimeout(() => {
            this.invalidateTimer = undefined;
            this.cache.markStale();
            this.assetCache.clear();
            console.info(`${DEBUG_LOG_PREFIX} cache:stale`, {
                reason,
                workspaceVersion: this.cache.workspaceVersion,
            });
            // Only revalidate in the background if the webview panel is open.
            if (this.panel) {
                this.ensureOrchestrator().scheduleRevalidation('interactive', (report) => this.sendAnalysis(report));
            }
        }, CACHE_INVALIDATION_DEBOUNCE_MS);
    }

    /** Clear all in-memory caches immediately (analysis cache + asset cache). */
    clearAllCaches(): void {
        if (this.invalidateTimer) clearTimeout(this.invalidateTimer);
        this.invalidateTimer = undefined;
        this.cache.invalidate();
        this.assetCache.clear();
        console.info(`${DEBUG_LOG_PREFIX} cache:cleared`, {
            reason: 'clearCache command',
            workspaceVersion: this.cache.workspaceVersion,
        });
    }

    private getAppConfig(): AppConfig {
        return {
            demoMode: this.workspace.getConfig<boolean>('reponav', 'demoMode', false),
        };
    }

    private sendAppConfig(): void {
        this.postMessage({ type: 'appConfig', config: this.getAppConfig() });
    }

    private async cacheTour(tour: Tour, _workspaceRoot: string) {
        if (this.serializer) {
            try {
                this.serializer.save(tour);
                this.sendSavedTours();
            } catch {
                // Cache failure is non-critical
            }
        }
    }

    private sendSavedTours(): void {
        if (this.serializer) {
            const tours = this.serializer.listAll();
            this.postMessage({ type: 'savedTours', tours });
        }
    }

    private async sendGitStatus(): Promise<void> {
        const wsRoot = this.workspace.getWorkspaceRoot();
        if (!wsRoot) return;

        try {
            const state = await this.gitProvider.getState(wsRoot);
            if (state.isGitRepo) {
                this.postMessage({
                    type: 'gitStatus',
                    branch: state.branch,
                    changes: state.changes,
                });
            }
        } catch {
            // Git status is non-critical
        }
    }

    private getWebviewContent(webview: vscode.Webview): string {
        const scriptName = this.resolveWebviewAsset('js');
        const styleName = this.resolveWebviewAsset('css');
        const scriptUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview', scriptName)
        );
        const styleUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview', styleName)
        );

        const nonce = getNonce();

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; font-src ${webview.cspSource}; img-src ${webview.cspSource} data:;">
    <link href="${styleUri}" rel="stylesheet">
    <title>RepoNav Tour</title>
</head>
<body>
    <div id="root"></div>
    <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
    }

    private resolveWebviewAsset(kind: 'js' | 'css'): string {
        const cached = this.assetCache.get(kind);
        if (cached) return cached;

        const resolveStart = performance.now();
        const fallback = `index.${kind}`;
        const assetsDir = path.join(this.extensionUri.fsPath, 'dist', 'webview');

        try {
            const entries = fs.readdirSync(assetsDir, { withFileTypes: true });
            const candidates = entries
                .filter((entry) => entry.isFile() && new RegExp(`^index(?: \\d+)?\\.${kind}$`).test(entry.name))
                .map((entry) => {
                    const fullPath = path.join(assetsDir, entry.name);
                    const stat = fs.statSync(fullPath);
                    return { name: entry.name, fullPath, size: stat.size, mtimeMs: stat.mtimeMs };
                })
                .filter((candidate) => {
                    if (kind !== 'js') return true;

                    const content = fs.readFileSync(candidate.fullPath, 'utf8').trimStart();
                    return !content.startsWith('{');
                })
                .sort((a, b) => b.mtimeMs - a.mtimeMs || b.size - a.size);

            if (candidates.length > 0) {
                console.info(`${PERF_LOG_PREFIX} resolveWebviewAsset(${kind}): ${(performance.now() - resolveStart).toFixed(1)}ms`);
                this.assetCache.set(kind, candidates[0].name);
                return candidates[0].name;
            }
        } catch (error) {
            console.warn(`${DEBUG_LOG_PREFIX} asset:resolve:failed`, {
                kind,
                fallback,
                errorMessage: (error as Error)?.message,
            });
        }

        console.info(`${PERF_LOG_PREFIX} resolveWebviewAsset(${kind}): ${(performance.now() - resolveStart).toFixed(1)}ms (fallback)`);
        return fallback;
    }
}

function getNonce() {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < NONCE_LENGTH; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}
