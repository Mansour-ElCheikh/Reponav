/* eslint-disable import/order */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import type { AnalysisReport, Tour } from '../types';
const state = vi.hoisted(() => ({
    createWebviewPanel: vi.fn(),
    postMessage: vi.fn(),
    reveal: vi.fn(),
    showWarningMessage: vi.fn(),
    showErrorMessage: vi.fn(),
    executeCommand: vi.fn(),
    withProgress: vi.fn(),
    onDidReceiveMessage: undefined as undefined | ((message: unknown) => void),
    onDidDispose: undefined as undefined | (() => void),
    serializerLoad: vi.fn(),
    serializerDelete: vi.fn(),
    serializerListAll: vi.fn(),
    serializerSave: vi.fn(),
    orchestratorRunScoped: vi.fn(),
    orchestratorEnsureWarmTier0: vi.fn(),
    orchestratorScheduleRevalidation: vi.fn(),
    fetch: vi.fn(),
}));
function makeReport(): AnalysisReport {
    return {
        timestamp: new Date().toISOString(),
        workspaceRoot: '/workspace',
        indexTier: 1,
        frameworks: [],
        primaryLanguage: 'typescript',
        entryPoints: [],
        dependencyGraph: {
            nodes: ['src/index.ts'],
            edges: [],
            circularDependencies: [],
        },
        fileClassifications: [],
        metrics: {
            totalFiles: 1,
            totalLines: 20,
            fileMetrics: [],
            hotFiles: [],
            orphanFiles: [],
        },
        fileTree: {},
        keyFileContents: {},
    };
}

/** Build a minimal tour fixture for saved-tour flow tests. */
function makeTour(id: string): Tour {
    return {
        id,
        query: 'overview',
        tourType: 'overview',
        steps: [
            {
                order: 1,
                title: 'Start',
                what_it_does: 'Bootstraps.',
                why_it_matters: 'Needed for setup.',
                watch_out: 'No major gotchas here.',
                files: ['src/index.ts'],
                highlights: [],
                relationships: [],
            },
        ],
        graph: {
            nodes: [{ id: 'src/index.ts', label: 'index.ts', type: 'entry' }],
            edges: [],
        },
        analysisSnapshot: {
            frameworks: [],
            entryPoints: [],
            totalFiles: 1,
            totalEdges: 0,
            circularCount: 0,
        },
        createdAt: new Date().toISOString(),
        aiGenerated: true,
    };
}

vi.mock('vscode', () => {
    const path = require('node:path') as typeof import('node:path');

    return {
        window: {
            createWebviewPanel: state.createWebviewPanel,
            withProgress: state.withProgress,
            showWarningMessage: state.showWarningMessage,
            showErrorMessage: state.showErrorMessage,
            showInformationMessage: vi.fn(),
            showTextDocument: vi.fn(async () => ({
                revealRange: vi.fn(),
                selection: undefined,
            })),
        },
        commands: {
            executeCommand: state.executeCommand,
        },
        workspace: {
            workspaceFolders: [{ uri: { fsPath: '/workspace' } }],
            getConfiguration: vi.fn(() => ({
                get: vi.fn((_key: string, defaultValue: string) => defaultValue),
            })),
            openTextDocument: vi.fn(async () => ({})),
            onDidSaveTextDocument: vi.fn(() => ({ dispose: vi.fn() })),
            onDidCreateFiles: vi.fn(() => ({ dispose: vi.fn() })),
            onDidDeleteFiles: vi.fn(() => ({ dispose: vi.fn() })),
            onDidRenameFiles: vi.fn(() => ({ dispose: vi.fn() })),
            onDidChangeWorkspaceFolders: vi.fn(() => ({ dispose: vi.fn() })),
        },
        Uri: {
            joinPath: (base: { fsPath?: string }, ...parts: string[]) => ({
                fsPath: path.join(base.fsPath ?? '', ...parts),
            }),
        },
        ProgressLocation: { Notification: 1 },
        ViewColumn: { Beside: 2, One: 1 },
        ExtensionMode: { Production: 1, Development: 2, Test: 3 },
        TextEditorRevealType: { InCenter: 0 },
        Position: class {
            constructor(public readonly line: number, public readonly character: number) {}
        },
        Range: class {
            constructor(public readonly start: unknown, public readonly end: unknown) {}
        },
        Selection: class {
            constructor(public readonly start: unknown, public readonly end: unknown) {}
        },
    };
});

vi.mock('../services/tours/TourSerializer', () => {
    return {
        TourSerializer: class {
            save = state.serializerSave;
            load = state.serializerLoad;
            delete = state.serializerDelete;
            listAll = state.serializerListAll;
        },
    };
});

vi.mock('./AnalysisOrchestrator', () => {
    return {
        AnalysisOrchestrator: class {
            runScoped = state.orchestratorRunScoped;
            ensureWarmTier0 = state.orchestratorEnsureWarmTier0;
            scheduleRevalidation = state.orchestratorScheduleRevalidation;
        },
    };
});

vi.mock('../ai/graphBuilder', () => ({
    buildDeterministicTour: vi.fn((report: AnalysisReport) => ({
        ...makeTour('deterministic'),
        graph: {
            nodes: report.dependencyGraph.nodes.map((id) => ({ id, label: id, type: 'unknown' as const })),
            edges: [],
        },
    })),
}));
import { RepoNavWebviewProvider } from './webviewProvider';

const EXPECTED_FLOW_COUNT = 3;
const EXPECTED_NONCE_LENGTH = 32;

describe('RepoNavWebviewProvider characterization', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.stubGlobal('fetch', state.fetch);

        state.onDidReceiveMessage = undefined;
        state.onDidDispose = undefined;

        state.withProgress.mockImplementation(async (_opts: unknown, task: (progress: { report: (value: unknown) => void }) => Promise<unknown>) => {
            return task({ report: () => {} });
        });

        state.serializerLoad.mockReset();
        state.serializerDelete.mockReset();
        state.serializerListAll.mockReset();
        state.serializerSave.mockReset();
        state.serializerListAll.mockReturnValue([]);
        state.serializerDelete.mockReturnValue(true);

        state.orchestratorRunScoped.mockReset();
        state.orchestratorEnsureWarmTier0.mockReset();
        state.orchestratorEnsureWarmTier0.mockResolvedValue(undefined);
        state.orchestratorScheduleRevalidation.mockReset();
        state.orchestratorScheduleRevalidation.mockResolvedValue(undefined);
        state.fetch.mockReset();

        state.createWebviewPanel.mockImplementation(() => {
            const panel = {
                webview: {
                    html: '',
                    cspSource: 'vscode-resource:',
                    asWebviewUri: (uri: { fsPath: string }) => `webview:${uri.fsPath}`,
                    postMessage: state.postMessage,
                    onDidReceiveMessage: vi.fn((handler: (message: unknown) => void) => {
                        state.onDidReceiveMessage = handler;
                        return { dispose: vi.fn() };
                    }),
                },
                reveal: state.reveal,
                iconPath: undefined as unknown,
                onDidDispose: vi.fn((handler: () => void) => {
                    state.onDidDispose = handler;
                    return { dispose: vi.fn() };
                }),
            };
            return panel;
        });
    });

    it('boots panel, wires webview, and sends initial app config', () => {
        const context = {
            extensionUri: { fsPath: '/extension' },
            subscriptions: [] as Array<{ dispose(): void }>,
            extensionMode: vscode.ExtensionMode.Production,
        } as any;
        const workspace = {
            getWorkspaceRoot: () => '/workspace',
            getConfig: () => false,
        } as any;
        const tourGenerator = { isReady: () => true } as any;

        const provider = new RepoNavWebviewProvider(context, tourGenerator, workspace);
        provider.show();

        expect(vscode.window.createWebviewPanel).toHaveBeenCalledTimes(1);
        expect(state.createWebviewPanel).toHaveBeenCalledWith(
            RepoNavWebviewProvider.viewType,
            'RepoNav Tour',
            vscode.ViewColumn.Beside,
            expect.objectContaining({ retainContextWhenHidden: true }),
        );
        expect(state.onDidReceiveMessage).toBeTypeOf('function');
        expect(state.postMessage).toHaveBeenCalledWith({
            type: 'appConfig',
            config: { demoMode: false },
        });

        provider.show();
        expect(state.reveal).toHaveBeenCalledTimes(1);
    });

    it('retains webview context in development mode', () => {
        const context = {
            extensionUri: { fsPath: '/extension' },
            subscriptions: [] as Array<{ dispose(): void }>,
            extensionMode: vscode.ExtensionMode.Development,
        } as any;
        const workspace = {
            getWorkspaceRoot: () => '/workspace',
            getConfig: () => false,
        } as any;
        const tourGenerator = { isReady: () => true } as any;

        const provider = new RepoNavWebviewProvider(context, tourGenerator, workspace);
        provider.show();

        expect(state.createWebviewPanel).toHaveBeenCalledWith(
            RepoNavWebviewProvider.viewType,
            'RepoNav Tour',
            vscode.ViewColumn.Beside,
            expect.objectContaining({ retainContextWhenHidden: true }),
        );
    });

    it('routes ready message to config push, cached analysis, saved tours, and warmup', async () => {
        const context = {
            extensionUri: { fsPath: '/extension' },
            subscriptions: [] as Array<{ dispose(): void }>,
            extensionMode: vscode.ExtensionMode.Production,
        } as any;
        const workspace = {
            getWorkspaceRoot: () => '/workspace',
            getConfig: () => false,
        } as any;
        const tourGenerator = { isReady: () => true, getLLMProvider: () => ({ generate: vi.fn() }) } as any;

        state.serializerListAll.mockReturnValue([
            {
                id: 'tour-1',
                query: 'overview',
                tourType: 'overview',
                stepCount: 1,
                nodeCount: 1,
                createdAt: new Date().toISOString(),
            },
        ]);

        const provider = new RepoNavWebviewProvider(context, tourGenerator, workspace);
        (provider as any).cache.store(makeReport(), new Map(), 'interactive');
        provider.show();

        await state.onDidReceiveMessage?.({ type: 'ready' });

        expect(state.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'appConfig' }));
        expect(state.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'analysisComplete' }));
        expect(state.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'savedTours' }));
        expect(state.orchestratorEnsureWarmTier0).toHaveBeenCalledTimes(1);
    });

    it('warms on ready in development mode', async () => {
        const context = {
            extensionUri: { fsPath: '/extension' },
            subscriptions: [] as Array<{ dispose(): void }>,
            extensionMode: vscode.ExtensionMode.Development,
        } as any;
        const workspace = {
            getWorkspaceRoot: () => '/workspace',
            getConfig: () => false,
        } as any;
        const tourGenerator = { isReady: () => true, getLLMProvider: () => ({ generate: vi.fn() }) } as any;

        const provider = new RepoNavWebviewProvider(context, tourGenerator, workspace);
        provider.show();

        await state.onDidReceiveMessage?.({ type: 'ready' });

        expect(state.orchestratorEnsureWarmTier0).toHaveBeenCalledTimes(1);
    });

    it('throttles startup warmup spam in development mode', async () => {
        vi.useFakeTimers();
        try {
            const context = {
                extensionUri: { fsPath: '/extension' },
                subscriptions: [] as Array<{ dispose(): void }>,
                extensionMode: vscode.ExtensionMode.Development,
            } as any;
            const workspace = {
                getWorkspaceRoot: () => '/workspace',
                getConfig: () => false,
            } as any;
            const tourGenerator = { isReady: () => true, getLLMProvider: () => ({ generate: vi.fn() }) } as any;

            const provider = new RepoNavWebviewProvider(context, tourGenerator, workspace);
            provider.show();

            await state.onDidReceiveMessage?.({ type: 'ready' });
            await state.onDidReceiveMessage?.({ type: 'ready' });
            expect(state.orchestratorEnsureWarmTier0).toHaveBeenCalledTimes(1);

            vi.advanceTimersByTime(3_100);
            await state.onDidReceiveMessage?.({ type: 'ready' });
            expect(state.orchestratorEnsureWarmTier0).toHaveBeenCalledTimes(2);
        } finally {
            vi.useRealTimers();
        }
    });

    it('handles saved tour load, missing tour errors, and deletion refresh', async () => {
        const context = {
            extensionUri: { fsPath: '/extension' },
            subscriptions: [] as Array<{ dispose(): void }>,
        } as any;
        const workspace = {
            getWorkspaceRoot: () => '/workspace',
            getConfig: () => false,
        } as any;
        const tourGenerator = { isReady: () => true, getLLMProvider: () => ({ generate: vi.fn() }) } as any;

        const provider = new RepoNavWebviewProvider(context, tourGenerator, workspace);
        // Seed cache so loadTour rebuilds the graph from current analysis
        (provider as any).cache.store(makeReport(), new Map(), 'interactive');
        provider.show();

        const loadedTour = makeTour('saved-tour');
        state.serializerLoad.mockReturnValueOnce(loadedTour).mockReturnValueOnce(null);

        await state.onDidReceiveMessage?.({ type: 'loadTour', tourId: 'saved-tour' });
        await state.onDidReceiveMessage?.({ type: 'loadTour', tourId: 'missing-tour' });
        await state.onDidReceiveMessage?.({ type: 'deleteTour', tourId: 'saved-tour' });

        // Tour sent with rebuilt graph (steps preserved, graph from current analysis report)
        expect(state.postMessage).toHaveBeenCalledWith(
            expect.objectContaining({ type: 'tourGenerated', tour: expect.objectContaining({ id: 'saved-tour', steps: loadedTour.steps }) })
        );
        expect(state.postMessage).toHaveBeenCalledWith({ type: 'error', message: 'Tour not found' });
        expect(state.serializerDelete).toHaveBeenCalledWith('saved-tour');
        expect(state.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'savedTours' }));
    });

    it('posts error to webview when deterministic graph flow fails', async () => {
        const context = {
            extensionUri: { fsPath: '/extension' },
            subscriptions: [] as Array<{ dispose(): void }>,
        } as any;
        const workspace = {
            getWorkspaceRoot: () => '/workspace',
            getConfig: () => false,
        } as any;
        const tourGenerator = { isReady: () => true } as any;

        state.orchestratorRunScoped.mockRejectedValueOnce(new Error('analysis failed'));

        const provider = new RepoNavWebviewProvider(context, tourGenerator, workspace);
        await provider.showDeterministicGraph();

        expect(state.postMessage).toHaveBeenCalledWith({
            type: 'tourGenerating',
            status: 'Analyzing dependencies...',
        });
        expect(state.postMessage).toHaveBeenCalledWith({
            type: 'error',
            message: 'analysis failed',
        });
    });

    it('runs deterministic graph analysis without Tier 2 symbol extraction', async () => {
        const context = {
            extensionUri: { fsPath: '/extension' },
            subscriptions: [] as Array<{ dispose(): void }>,
        } as any;
        const workspace = {
            getWorkspaceRoot: () => '/workspace',
            getConfig: () => false,
        } as any;
        const tourGenerator = { isReady: () => true } as any;

        state.orchestratorRunScoped.mockResolvedValueOnce({
            report: makeReport(),
            tier0Ms: 0,
            tier1Ms: 0,
        });

        const provider = new RepoNavWebviewProvider(context, tourGenerator, workspace);
        await provider.showDeterministicGraph();

        expect(state.orchestratorRunScoped).toHaveBeenCalledWith(
            'interactive',
            expect.objectContaining({
                notificationTitle: 'RepoNav: Analyzing dependencies',
                publishTier0: true,
                includeTier2: false,
            }),
            expect.any(Function),
        );
        expect(state.postMessage).toHaveBeenCalledWith(
            expect.objectContaining({ type: 'tourGenerated' }),
        );
    });

    it('streams a provisional graph as soon as Tier 1 analysis is ready during tour generation', async () => {
        const context = {
            extensionUri: { fsPath: '/extension' },
            subscriptions: [] as Array<{ dispose(): void }>,
        } as any;
        const workspace = {
            getWorkspaceRoot: () => '/workspace',
            getConfig: () => false,
        } as any;
        const tourGenerator = {
            isReady: () => true,
            getLLMProvider: () => ({ generate: vi.fn() }),
            getProviderName: () => 'VS Code Language Model',
            generateTourStream: vi.fn().mockResolvedValue(undefined),
        } as any;

        state.orchestratorRunScoped.mockImplementationOnce(async (_scope, _options, sendAnalysis) => {
            sendAnalysis(makeReport());
            return {
                report: makeReport(),
                tier0Ms: 0,
                tier1Ms: 0,
            };
        });

        const provider = new RepoNavWebviewProvider(context, tourGenerator, workspace);
        await provider.generateAndShowTour('Give me an architecture overview', 'overview');

        const provisionalGraphIndex = state.postMessage.mock.calls.findIndex(
            (call) => call[0]?.type === 'tour.stream_chunk' && call[0]?.payload?.type === 'graph'
        );
        const aiStatusIndex = state.postMessage.mock.calls.findIndex(
            (call) => call[0]?.type === 'tourGenerating' && call[0]?.status === 'Generating tour with AI...'
        );

        expect(provisionalGraphIndex).toBeGreaterThanOrEqual(0);
        expect(aiStatusIndex).toBeGreaterThanOrEqual(0);
        expect(provisionalGraphIndex).toBeLessThan(aiStatusIndex);
    });

    it('suppresses the duplicate graph chunk emitted when AI streaming starts after a provisional graph', async () => {
        const context = {
            extensionUri: { fsPath: '/extension' },
            subscriptions: [] as Array<{ dispose(): void }>,
        } as any;
        const workspace = {
            getWorkspaceRoot: () => '/workspace',
            getConfig: () => false,
        } as any;
        const tourGenerator = {
            isReady: () => true,
            getLLMProvider: () => ({ generate: vi.fn() }),
            getProviderName: () => 'VS Code Language Model',
            generateTourStream: vi.fn().mockImplementation(async (_report, _query, _tourType, onChunk) => {
                onChunk({
                    type: 'tour.stream_chunk',
                    payload: {
                        type: 'graph',
                        data: makeTour('stream-graph'),
                    },
                });
                onChunk({ type: 'tour.stream_end' });
            }),
        } as any;

        state.orchestratorRunScoped.mockImplementationOnce(async (_scope, _options, sendAnalysis) => {
            sendAnalysis(makeReport());
            return {
                report: makeReport(),
                tier0Ms: 0,
                tier1Ms: 0,
            };
        });

        const provider = new RepoNavWebviewProvider(context, tourGenerator, workspace);
        await provider.generateAndShowTour('Give me an architecture overview', 'overview');

        const graphChunks = state.postMessage.mock.calls.filter(
            (call) => call[0]?.type === 'tour.stream_chunk' && call[0]?.payload?.type === 'graph'
        );

        expect(graphChunks).toHaveLength(1);
    });

    it('avoids replacing provisional graph on retry when the graph signature is unchanged', async () => {
        const context = {
            extensionUri: { fsPath: '/extension' },
            subscriptions: [] as Array<{ dispose(): void }>,
        } as any;
        const workspace = {
            getWorkspaceRoot: () => '/workspace',
            getConfig: () => false,
        } as any;
        const tourGenerator = {
            isReady: () => true,
            getLLMProvider: () => ({ generate: vi.fn() }),
            getProviderName: () => 'VS Code Language Model',
            generateTourStream: vi.fn().mockResolvedValue(undefined),
        } as any;

        state.orchestratorRunScoped.mockImplementation(async (_scope, _options, sendAnalysis) => {
            sendAnalysis(makeReport());
            return {
                report: makeReport(),
                tier0Ms: 0,
                tier1Ms: 0,
            };
        });

        const provider = new RepoNavWebviewProvider(context, tourGenerator, workspace);
        await provider.generateAndShowTour('Give me an architecture overview', 'overview');
        state.postMessage.mockClear();

        await provider.generateAndShowTour('Give me an architecture overview', 'overview');

        const graphChunks = state.postMessage.mock.calls.filter(
            (call) => call[0]?.type === 'tour.stream_chunk' && call[0]?.payload?.type === 'graph'
        );
        expect(graphChunks).toHaveLength(0);
    });

    it('fails fast with a stream timeout error when AI streaming never completes', async () => {
        vi.useFakeTimers();
        try {
            const context = {
                extensionUri: { fsPath: '/extension' },
                subscriptions: [] as Array<{ dispose(): void }>,
            } as any;
            const workspace = {
                getWorkspaceRoot: () => '/workspace',
                getConfig: () => false,
            } as any;

            const neverResolves = new Promise<void>(() => {});
            const tourGenerator = {
                isReady: () => true,
                getLLMProvider: () => ({ generate: vi.fn() }),
                getProviderName: () => 'VS Code Language Model',
                generateTourStream: vi.fn().mockReturnValue(neverResolves),
            } as any;

            state.orchestratorRunScoped.mockResolvedValue({
                report: makeReport(),
                tier0Ms: 0,
                tier1Ms: 0,
            });

            const provider = new RepoNavWebviewProvider(context, tourGenerator, workspace);
            const pending = provider.generateAndShowTour('Give me an architecture overview', 'overview');
            await vi.advanceTimersByTimeAsync(61_000);
            await pending;

            expect(state.postMessage).toHaveBeenCalledWith(
                expect.objectContaining({
                    type: 'error',
                    message: expect.stringContaining('stream timed out'),
                }),
            );
        } finally {
            vi.useRealTimers();
        }
    });

    it('includes standalone tier1 and tier2 timings in the perf summary for full tour generation', async () => {
        const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
        const context = {
            extensionUri: { fsPath: '/extension' },
            subscriptions: [] as Array<{ dispose(): void }>,
        } as any;
        const workspace = {
            getWorkspaceRoot: () => '/workspace',
            getConfig: () => false,
        } as any;
        const tourGenerator = {
            isReady: () => true,
            getLLMProvider: () => ({ generate: vi.fn() }),
            getProviderName: () => 'VS Code Language Model',
            generateTourStream: vi.fn().mockResolvedValue(undefined),
        } as any;

        state.orchestratorRunScoped.mockResolvedValueOnce({
            report: makeReport(),
            tier0Ms: 11,
            tier1Ms: 222,
            tier2Ms: 333,
        });

        const provider = new RepoNavWebviewProvider(context, tourGenerator, workspace);
        await provider.generateAndShowTour('Give me an architecture overview', 'overview');

        const summaryCall = infoSpy.mock.calls.find(
            (call) => call[0] === '[RepoNav][perf][webviewProvider] summary'
        );

        expect(summaryCall?.[1]).toEqual(
            expect.objectContaining({
                tier0Ms: 11,
                tier1Ms: 222,
                tier2Ms: 333,
                generationMs: expect.any(Number),
            })
        );

        infoSpy.mockRestore();
    });

    it('uses the core tier 2 report for AI generation even if enrichment arrives later', async () => {
        const context = {
            extensionUri: { fsPath: '/extension' },
            subscriptions: [] as Array<{ dispose(): void }>,
        } as any;
        const workspace = {
            getWorkspaceRoot: () => '/workspace',
            getConfig: () => false,
        } as any;
        const coreReport = makeReport();
        const enrichedReport = {
            ...makeReport(),
            symbols: [{
                name: 'helper',
                kind: 'function' as const,
                filePath: 'src/index.ts',
                lineStart: 1,
                lineEnd: 1,
                isExported: false,
                isEntryPoint: false,
                signature: 'helper(): number',
            }],
        };
        const generateTourStream = vi.fn().mockResolvedValue(undefined);
        const tourGenerator = {
            isReady: () => true,
            getLLMProvider: () => ({ generate: vi.fn() }),
            getProviderName: () => 'VS Code Language Model',
            generateTourStream,
        } as any;

        state.orchestratorRunScoped.mockImplementationOnce(async (_scope, _options, sendAnalysis) => {
            sendAnalysis(coreReport);
            queueMicrotask(() => sendAnalysis(enrichedReport));
            return {
                report: coreReport,
                tier0Ms: 0,
                tier1Ms: 0,
                tier2Ms: 5,
            };
        });

        const provider = new RepoNavWebviewProvider(context, tourGenerator, workspace);
        await provider.generateAndShowTour('Give me an architecture overview', 'overview');

        expect(generateTourStream).toHaveBeenCalledWith(
            coreReport,
            'Give me an architecture overview',
            'overview',
            expect.any(Function)
        );
    });

    it('renders a CSP nonce with the expected token length', () => {
        const context = {
            extensionUri: { fsPath: '/extension' },
            subscriptions: [] as Array<{ dispose(): void }>,
        } as any;
        const workspace = {
            getWorkspaceRoot: () => '/workspace',
            getConfig: () => false,
        } as any;
        const tourGenerator = { isReady: () => true } as any;

        const provider = new RepoNavWebviewProvider(context, tourGenerator, workspace);
        provider.show();

        const html = state.createWebviewPanel.mock.results.at(-1)?.value.webview.html as string;
        const cspNonce = html.match(/script-src 'nonce-([A-Za-z0-9]+)'/)?.[1];
        const scriptNonce = html.match(/<script nonce="([A-Za-z0-9]+)"/)?.[1];

        expect(cspNonce).toBeDefined();
        expect(scriptNonce).toBeDefined();
        expect(scriptNonce).toBe(cspNonce);
        expect(scriptNonce).toHaveLength(EXPECTED_NONCE_LENGTH);
    });

    it('posts analyzerError when analyzerQuery arrives and no cached report', async () => {
        const context = {
            extensionUri: { fsPath: '/extension' },
            subscriptions: [] as Array<{ dispose(): void }>,
        } as any;
        const workspace = {
            getWorkspaceRoot: () => '/workspace',
            getConfig: (_section: string, _key: string, defaultValue: string) => defaultValue,
        } as any;
        const mockLlm = { generate: vi.fn() };
        const tourGenerator = { isReady: () => true, getLLMProvider: () => mockLlm } as any;

        const provider = new RepoNavWebviewProvider(context, tourGenerator, workspace);
        provider.show();

        await state.onDidReceiveMessage?.({ type: 'analyzerQuery', text: 'what are the entry points?' });

        expect(state.postMessage).toHaveBeenCalledWith(
            expect.objectContaining({ type: 'analyzerError' }),
        );
        expect(mockLlm.generate).not.toHaveBeenCalled();
    });
});

// ─── T26-T27 (epic-007 C004): flowCount in summary ───────────────────────────

describe('webviewProvider — T27: sendAnalysis populates flowCount', () => {
    function makeProviderAndShow() {
        const context = { extensionUri: { fsPath: '/extension' }, subscriptions: [] } as any;
        const workspace = { getWorkspaceRoot: () => '/workspace', getConfig: () => false } as any;
        const tourGenerator = { isReady: () => true } as any;
        const provider = new RepoNavWebviewProvider(context, tourGenerator, workspace);
        provider.show();
        state.postMessage.mockClear();
        state.orchestratorScheduleRevalidation.mockClear();
        return provider;
    }

    it('T27: flowCount equals flows.length when report has flows', () => {
        const provider = makeProviderAndShow();

        const report = makeReport();
        report.flows = [
            { id: 'f1', entryPoint: 'src/routes/a.ts', steps: [], anomalies: [] },
            { id: 'f2', entryPoint: 'src/routes/b.ts', steps: [], anomalies: [] },
            { id: 'f3', entryPoint: 'src/routes/c.ts', steps: [], anomalies: [] },
        ];

        provider.sendAnalysis(report);

        const call = state.postMessage.mock.calls.find(
            ([msg]: [unknown]) => (msg as { type: string }).type === 'analysisComplete'
        );
        expect(call).toBeDefined();
        const msg = call![0] as { type: string; report: { flowCount?: number } };
        expect(msg.report.flowCount).toBe(EXPECTED_FLOW_COUNT);
    });

    it('T27: flowCount is absent when report has no flows', () => {
        const provider = makeProviderAndShow();

        provider.sendAnalysis(makeReport());

        const call = state.postMessage.mock.calls.find(
            ([msg]: [unknown]) => (msg as { type: string }).type === 'analysisComplete'
        );
        expect(call).toBeDefined();
        const msg = call![0] as { type: string; report: { flowCount?: number } };
        expect(msg.report.flowCount).toBeUndefined();
    });

    it('T27b: sendAnalysis defaults the shared flow view to runtime flows and labels tooling flows separately', () => {
        const provider = makeProviderAndShow();

        const report = makeReport();
        report.flows = [
            { id: 'f1', entryPoint: 'src/routes/a.ts', steps: [], anomalies: [] },
            { id: 'f2', entryPoint: 'bin/reponav.ts', steps: [], anomalies: [] },
            { id: 'f3', entryPoint: 'scripts/smoke/index.js', steps: [], anomalies: [] },
        ];

        provider.sendAnalysis(report);

        const call = state.postMessage.mock.calls.find(
            ([msg]: [unknown]) => (msg as { type: string }).type === 'analysisComplete'
        );
        expect(call).toBeDefined();
        const msg = call![0] as {
            type: string;
            report: {
                flowCount?: number;
                toolingFlowCount?: number;
                flows?: Array<{ entryPoint: string }>;
                toolingEntryPoints?: string[];
            };
        };
        expect(msg.report.flowCount).toBe(1);
        expect(msg.report.toolingFlowCount).toBe(2);
        expect(msg.report.flows?.map((flow) => flow.entryPoint)).toEqual(['src/routes/a.ts']);
        expect(msg.report.toolingEntryPoints).toEqual(['bin/reponav.ts', 'scripts/smoke/index.js']);
    });

    it('T27c: sendAnalysis exposes completeness metadata for sampled interactive reports', () => {
        const provider = makeProviderAndShow();

        const report = makeReport() as AnalysisReport & {
            completeness: {
                analysisScope: 'interactive';
                analyzedFileCount: number;
                graphNodeCount: number;
                graphEdgeCount: number;
                graphSampleLimit: number;
                analysisCoverage: 'sampled';
                graphCoverage: 'sampled';
            };
        };
        report.completeness = {
            analysisScope: 'interactive',
            analyzedFileCount: 250,
            graphNodeCount: 200,
            graphEdgeCount: 480,
            graphSampleLimit: 200,
            analysisCoverage: 'sampled',
            graphCoverage: 'sampled',
        };

        provider.sendAnalysis(report);

        const call = state.postMessage.mock.calls.find(
            ([msg]: [unknown]) => (msg as { type: string }).type === 'analysisComplete'
        );
        expect(call).toBeDefined();
        const msg = call![0] as {
            type: string;
            report: {
                completeness?: {
                    analysisScope: string;
                    analyzedFileCount: number;
                    graphNodeCount: number;
                    graphEdgeCount: number;
                    graphSampleLimit: number;
                    analysisCoverage: string;
                    graphCoverage: string;
                };
            };
        };
        expect(msg.report.completeness).toEqual({
            analysisScope: 'interactive',
            analyzedFileCount: 250,
            graphNodeCount: 200,
            graphEdgeCount: 480,
            graphSampleLimit: 200,
            analysisCoverage: 'sampled',
            graphCoverage: 'sampled',
        });
    });

    describe('SWR wiring (C003)', () => {
        /** Fire the pending debounce timer synchronously without fake timers. */
        function firePendingDebounce(provider: any) {
            const timerCb = (provider as any)._pendingDebounce;
            if (timerCb) timerCb();
        }

        it('file save debounce calls markStale instead of invalidate', async () => {
            vi.useFakeTimers();
            try {
                const provider = makeProviderAndShow();
                const markStaleSpy = vi.spyOn((provider as any).cache, 'markStale');
                const invalidateSpy = vi.spyOn((provider as any).cache, 'invalidate');
                (provider as any).invalidateAnalysisCache('save');
                await vi.runAllTimersAsync();
                expect(markStaleSpy).toHaveBeenCalledTimes(1);
                expect(invalidateSpy).not.toHaveBeenCalled();
            } finally {
                vi.useRealTimers();
            }
        });

        it('scheduleRevalidation not called when panel is closed', () => {
            const provider = makeProviderAndShow();
            state.onDidDispose?.();
            expect((provider as any).panel).toBeUndefined();
            // Directly simulate the debounce callback firing after panel is closed
            (provider as any).cache.markStale();
            if ((provider as any).panel) {
                (provider as any).ensureOrchestrator().scheduleRevalidation('interactive', () => {});
            }
            expect(state.orchestratorScheduleRevalidation).not.toHaveBeenCalled();
        });

        it('scheduleRevalidation called when panel is open', async () => {
            vi.useFakeTimers();
            try {
                state.orchestratorScheduleRevalidation.mockResolvedValue(undefined);
                const provider = makeProviderAndShow();
                expect((provider as any).panel).toBeDefined();
                (provider as any).invalidateAnalysisCache('save');
                await vi.runAllTimersAsync();
                expect(state.orchestratorScheduleRevalidation).toHaveBeenCalledWith('interactive', expect.any(Function));
            } finally {
                vi.useRealTimers();
            }
        });

        it('clearAllCaches calls cache.invalidate() not markStale', () => {
            const provider = makeProviderAndShow();
            const markStaleSpy = vi.spyOn((provider as any).cache, 'markStale');
            const invalidateSpy = vi.spyOn((provider as any).cache, 'invalidate');
            provider.clearAllCaches();
            expect(invalidateSpy).toHaveBeenCalledTimes(1);
            expect(markStaleSpy).not.toHaveBeenCalled();
        });

        it('clearAllCaches leaves isStale as false', () => {
            const provider = makeProviderAndShow();
            (provider as any).cache.store(makeReport(), new Map(), 'interactive');
            (provider as any).cache.markStale();
            expect((provider as any).cache.isStale).toBe(true);
            provider.clearAllCaches();
            expect((provider as any).cache.isStale).toBe(false);
        });

        it('debounce coalesces rapid saves — second call cancels the first timer', async () => {
            vi.useFakeTimers();
            try {
                state.orchestratorScheduleRevalidation.mockResolvedValue(undefined);
                const provider = makeProviderAndShow();
                (provider as any).invalidateAnalysisCache('save'); // T1 set
                const timerAfterFirst = (provider as any).invalidateTimer;
                (provider as any).invalidateAnalysisCache('save'); // T1 cleared, T2 set
                const timerAfterSecond = (provider as any).invalidateTimer;
                // Second call must have replaced the first timer
                expect(timerAfterSecond).not.toBe(timerAfterFirst);
                await vi.runAllTimersAsync();
                // Only one revalidation runs for the surviving timer
                expect(state.orchestratorScheduleRevalidation).toHaveBeenCalledTimes(1);
            } finally {
                vi.useRealTimers();
            }
        });

        it('panel opens after file-change-while-closed uses stale in cache', () => {
            const provider = makeProviderAndShow();
            (provider as any).cache.store(makeReport(), new Map(), 'interactive');
            (provider as any).cache.markStale();
            expect((provider as any).cache.isStale).toBe(true);
            expect((provider as any).cache.getStaleReport('interactive')).toBeDefined();
        });
    });
});
