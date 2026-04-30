/**
 * RepoNav Extension Entry Point
 *
 * Registers commands and initializes the extension.
 */

import * as vscode from 'vscode';
import { DynamicLLMProvider } from './ai/DynamicLLMProvider';
import { TourGenerator } from './ai/tourGenerator';
import { createAnalyzeWorkspaceHandler, createClearCacheHandler, createGenerateTourHandler, TOUR_TYPE_QUICK_PICK_OPTIONS } from './commands/commandHandlers';
import { RepoDatabase } from './db/RepoDatabase';
import { average, errorMessage, getErrorCategory, webviewAssetsReady, withTimeout } from './runtime/extensionUtils';
import { VSCodeGitProvider } from './VSCodeGitProvider';
import { VSCodeDocumentSymbolEnricher, VSCodeWorkspaceAdapter } from './VSCodeWorkspaceAdapter';
import { RepoNavWebviewProvider } from './webview/webviewProvider';

let repoDb: RepoDatabase | undefined;
const ANALYSIS_TIMEOUT_MS = 120_000;
const DEFERRED_DB_OPEN_MS = 15_000;
const DEV_AUTO_OPEN_PANEL_DELAY_MS = 250;
export const REQUIRED_COMMAND_IDS = [
    'reponav.openPanel',
    'reponav.generateTour',
    'reponav.showDependencyGraph',
    'reponav.analyzeWorkspace',
    'reponav.healthCheck',
    'reponav.clearCache',
];

interface RuntimeMetrics {
    activationStartedAtMs: number;
    activationCompletedAtMs?: number;
    commandInvocations: number;
    commandErrors: number;
    commandLatenciesMs: number[];
    commandErrorCategories: Record<string, number>;
}

export function activate(context: vscode.ExtensionContext) {
    const output = vscode.window.createOutputChannel('RepoNav');
    context.subscriptions.push(output);

    const metrics: RuntimeMetrics = {
        activationStartedAtMs: Date.now(),
        commandInvocations: 0,
        commandErrors: 0,
        commandLatenciesMs: [],
        commandErrorCategories: {},
    };

    const logEvent = (event: string, data: Record<string, unknown> = {}) => {
        output.appendLine(
            JSON.stringify({
                timestamp: new Date().toISOString(),
                event,
                ...data,
            })
        );
    };

    logEvent('activation.start', { extensionVersion: context.extension.packageJSON.version });

    // ─── Dependency Injection Wiring ─────────────────────────────────────
    const workspace = new VSCodeWorkspaceAdapter();
    const dynamicLlm = new DynamicLLMProvider(workspace, (msg) => output.appendLine(msg));
    const cacheEnabled = workspace.getConfig<boolean>('reponav', 'tourCacheEnabled', true);

    // Defer SQLite open so it never blocks startup or the first tour request.
    const workspaceRoot = workspace.getWorkspaceRoot();
    if (workspaceRoot && cacheEnabled) {
        repoDb = new RepoDatabase(workspaceRoot);
        const dbOpenTimer = setTimeout(() => {
            const dbOpenStart = Date.now();
            repoDb?.open().then(() => {
                logEvent('db.open.success', { durationMs: Date.now() - dbOpenStart, deferredMs: DEFERRED_DB_OPEN_MS });
            }).catch((err) => {
                logEvent('db.open.failed', { durationMs: Date.now() - dbOpenStart, error: err.message });
                console.warn('RepoNav: Failed to open database, running without cache:', err.message);
                repoDb = undefined;
            });
        }, DEFERRED_DB_OPEN_MS);
        context.subscriptions.push({ dispose: () => clearTimeout(dbOpenTimer) });
    }

    const tourGenerator = new TourGenerator(dynamicLlm, repoDb, { cacheEnabled });
    const gitProvider = new VSCodeGitProvider();
    const symbolEnricher = new VSCodeDocumentSymbolEnricher(workspace);
    const webviewProvider = new RepoNavWebviewProvider(context, tourGenerator, workspace, gitProvider, symbolEnricher);

    const registerInstrumentedCommand = <TArgs extends unknown[]>(
        commandId: string,
        handler: (...args: TArgs) => Thenable<unknown> | unknown
    ) => {
        return vscode.commands.registerCommand(commandId, async (...args: TArgs) => {
            const startedAt = Date.now();
            metrics.commandInvocations += 1;
            logEvent('command.start', { commandId });

            try {
                const result = await handler(...args);
                const durationMs = Date.now() - startedAt;
                metrics.commandLatenciesMs.push(durationMs);
                logEvent('command.success', { commandId, durationMs });
                return result;
            } catch (error) {
                const durationMs = Date.now() - startedAt;
                metrics.commandLatenciesMs.push(durationMs);
                metrics.commandErrors += 1;

                const category = getErrorCategory(error);
                metrics.commandErrorCategories[category] = (metrics.commandErrorCategories[category] || 0) + 1;

                logEvent('command.error', {
                    commandId,
                    durationMs,
                    errorCategory: category,
                    errorMessage: errorMessage(error),
                });

                throw error;
            }
        });
    };

    const generateTourCmd = registerInstrumentedCommand(
        'reponav.generateTour',
        createGenerateTourHandler({
            promptForTourType: async () => vscode.window.showQuickPick(TOUR_TYPE_QUICK_PICK_OPTIONS, {
                placeHolder: 'What kind of tour do you want?',
                title: 'RepoNav — Architecture Tour',
            }),
            promptForCustomQuery: async () => vscode.window.showInputBox({
                prompt: 'What do you want to understand about this codebase?',
                placeHolder: 'e.g., "How does authentication work?" or "Explain the database layer"',
                title: 'RepoNav — Custom Tour',
            }),
            generateAndShowTour: (query, tourType) => webviewProvider.generateAndShowTour(query, tourType),
        })
    );

    // ─── Command: Show Dependency Graph ───────────────────────────────────

    const showGraphCmd = registerInstrumentedCommand(
        'reponav.showDependencyGraph',
        async () => {
            await webviewProvider.showDeterministicGraph();
        }
    );

    const analyzeCmd = registerInstrumentedCommand(
        'reponav.analyzeWorkspace',
        createAnalyzeWorkspaceHandler({
            getWorkspaceRoot: () => workspace.getWorkspaceRoot() ?? undefined,
            showNoWorkspaceError: () => {
                vscode.window.showErrorMessage('No workspace folder open');
            },
            runAnalysis: async () => {
                const { analyzeWorkspace } = await import('./analyzers/index');

                return vscode.window.withProgress(
                    {
                        location: vscode.ProgressLocation.Notification,
                        title: 'RepoNav: Analyzing workspace',
                        cancellable: false,
                    },
                    async (progress) => withTimeout(
                        analyzeWorkspace(workspace, progress, { scope: 'fullWorkspace' }),
                        ANALYSIS_TIMEOUT_MS,
                        'Workspace analysis'
                    )
                );
            },
            promptAfterAnalysis: (message) => Promise.resolve(vscode.window.showInformationMessage(
                message,
                'Generate Tour',
                'Dismiss'
            )),
            executeGenerateTour: async () => { await vscode.commands.executeCommand('reponav.generateTour'); },
        })
    );

    // ─── Command: Open Panel ──────────────────────────────────────────────

    const openPanelCmd = registerInstrumentedCommand(
        'reponav.openPanel',
        () => webviewProvider.show()
    );

    // ─── Command: Health Check ────────────────────────────────────────────

    const healthCheckCmd = registerInstrumentedCommand(
        'reponav.healthCheck',
        async () => {
            const allCommands = await vscode.commands.getCommands(true);
            const missingCommands = REQUIRED_COMMAND_IDS.filter((commandId) => !allCommands.includes(commandId));

            const readiness = {
                activationSucceeded: Boolean(metrics.activationCompletedAtMs),
                commandsRegistered: missingCommands.length === 0,
                missingCommands,
                webviewAssetsReady: await webviewAssetsReady(context.extensionPath),
                providerName: dynamicLlm.name,
                providerConfigured: dynamicLlm.isConfigured(),
            };

            const status = readiness.activationSucceeded && readiness.commandsRegistered && readiness.webviewAssetsReady
                ? 'ok'
                : 'degraded';

            const observability = {
                activationDurationMs: metrics.activationCompletedAtMs
                    ? metrics.activationCompletedAtMs - metrics.activationStartedAtMs
                    : Date.now() - metrics.activationStartedAtMs,
                commandInvocations: metrics.commandInvocations,
                commandErrors: metrics.commandErrors,
                averageCommandLatencyMs: Number(average(metrics.commandLatenciesMs).toFixed(2)),
                commandErrorCategories: metrics.commandErrorCategories,
            };

            const report = {
                status,
                readiness,
                observability,
                timestamp: new Date().toISOString(),
            };

            logEvent('health.report', {
                status,
                commandsRegistered: readiness.commandsRegistered,
                webviewAssetsReady: readiness.webviewAssetsReady,
                providerConfigured: readiness.providerConfigured,
                commandErrors: observability.commandErrors,
            });

            const message =
                status === 'ok'
                    ? 'RepoNav Health Check: status ok'
                    : 'RepoNav Health Check: status degraded';

            const action =
                status === 'ok'
                    ? await vscode.window.showInformationMessage(message, 'Show Report')
                    : await vscode.window.showWarningMessage(message, 'Show Report');

            if (action === 'Show Report') {
                output.show(true);
                output.appendLine(
                    JSON.stringify(
                        {
                            timestamp: new Date().toISOString(),
                            event: 'health.report.full',
                            report,
                        },
                        null,
                        2
                    )
                );
            }

            return report;
        }
    );

    // ─── Command: Clear Cache ─────────────────────────────────────────────

    const clearCacheCmd = registerInstrumentedCommand(
        'reponav.clearCache',
        createClearCacheHandler({
            getWorkspaceRoot: () => workspace.getWorkspaceRoot() ?? undefined,
            showNoWorkspaceError: () => {
                vscode.window.showErrorMessage('No workspace folder open');
            },
            deleteDbFile: async (dbPath) => {
                // Close in-memory DB handle first
                if (repoDb) {
                    await repoDb.close();
                    repoDb = undefined;
                }
                // Delete the file on disk
                try {
                    await require('fs').promises.unlink(dbPath);
                } catch {
                    // File may not exist yet — that's fine
                }
            },
            invalidateMemoryCache: () => {
                webviewProvider.clearAllCaches();
            },
            showConfirmation: (message) => {
                vscode.window.showInformationMessage(message);
            },
        })
    );

    // Register all commands
    context.subscriptions.push(generateTourCmd, showGraphCmd, analyzeCmd, openPanelCmd, healthCheckCmd, clearCacheCmd);

    if (context.extensionMode === vscode.ExtensionMode.Development) {
        const autoOpenTimer = setTimeout(() => {
            webviewProvider.show();
        }, DEV_AUTO_OPEN_PANEL_DELAY_MS);
        context.subscriptions.push({ dispose: () => clearTimeout(autoOpenTimer) });
    }

    // Status bar item
    const statusBar = vscode.window.createStatusBarItem(
        vscode.StatusBarAlignment.Right,
        100
    );
    statusBar.text = '$(compass) RepoNav';
    statusBar.tooltip = 'Generate Architecture Tour';
    statusBar.command = 'reponav.generateTour';
    statusBar.show();
    context.subscriptions.push(statusBar);

    metrics.activationCompletedAtMs = Date.now();
    const activationMem = process.memoryUsage();
    logEvent('activation.complete', {
        activationDurationMs: metrics.activationCompletedAtMs - metrics.activationStartedAtMs,
        heapUsedMB: (activationMem.heapUsed / 1_048_576).toFixed(1),
        heapTotalMB: (activationMem.heapTotal / 1_048_576).toFixed(1),
        externalMB: (activationMem.external / 1_048_576).toFixed(1),
    });
}

export async function deactivate() {
    if (repoDb) {
        await repoDb.close();
        repoDb = undefined;
    }
    console.log('RepoNav extension deactivated');
}
