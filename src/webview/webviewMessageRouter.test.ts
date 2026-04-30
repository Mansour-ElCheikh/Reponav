/**
 * Tests for webviewMessageRouter — pure dispatch routing, no vscode dependency.
 * Each test verifies a single message type routes to the correct ctx method.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { routeWebviewMessage } from './webviewMessageRouter';
import type { RouterContext } from './webviewMessageRouter';

vi.mock('../ai/graphBuilder', () => ({
    buildDeterministicTour: vi.fn().mockReturnValue({
        id: 'fresh-graph',
        query: '',
        tourType: 'overview',
        createdAt: '',
        aiGenerated: false,
        analysisSnapshot: { frameworks: [], entryPoints: [], totalFiles: 1, totalEdges: 0, circularCount: 0 },
        steps: [],
        graph: { nodes: [{ id: 'n0', label: 'n0', type: 'unknown' }], edges: [] },
    }),
}));

vi.mock('../analyzers/reportFormatting', () => ({
    formatReportForAI: vi.fn().mockReturnValue('(mock report context)'),
}));

// Minimal AnalysisReport-like fixture (only fields the router reads)
function makeReport(nodeCount = 1, circularDependencies: string[][] = []) {
    return {
        dependencyGraph: {
            nodes: Array.from({ length: nodeCount }, (_, i) => `node${i}`),
            edges: [],
            circularDependencies,
        },
        metrics: { totalFiles: nodeCount, totalLines: 0, fileMetrics: [], hotFiles: [], orphanFiles: [] },
    } as unknown as import('../types').AnalysisReport;
}

// Minimal Tour fixture (only fields the router reads/passes through)
function makeTour(id: string, nodeCount = 1): import('../types').Tour {
    return {
        id,
        query: 'test',
        tourType: 'custom' as const,
        createdAt: new Date().toISOString(),
        aiGenerated: false,
        analysisSnapshot: { frameworks: [], entryPoints: [], totalFiles: 1, totalEdges: 0, circularCount: 0 },
        steps: [],
        graph: {
            nodes: Array.from({ length: nodeCount }, (_, i) => ({ id: `n${i}`, label: `n${i}`, type: 'unknown' })),
            edges: [],
        },
    };
}

/** Build a fully-mocked RouterContext; override individual fields per test. */
function makeCtx(overrides: Partial<RouterContext> = {}): RouterContext {
    const runScoped = vi.fn().mockResolvedValue({ report: makeReport(), tier0Ms: 0, tier1Ms: 0 });
    const ensureWarmTier0 = vi.fn().mockResolvedValue(undefined);
    const orchestrator = { runScoped, ensureWarmTier0 };
    const warmStartupAnalysis = vi.fn(() => {
        void ensureWarmTier0();
    });
    return {
        openFile: vi.fn().mockResolvedValue(undefined),
        openSettings: vi.fn(),
        generateAndShowTour: vi.fn().mockResolvedValue(undefined),
        sendAnalysis: vi.fn(),
        sendTour: vi.fn(),
        sendAppConfig: vi.fn(),
        sendSavedTours: vi.fn(),
        warmStartupAnalysis,
        postMessage: vi.fn(),
        ensureOrchestrator: vi.fn().mockReturnValue(orchestrator),
        cache: { report: null, getCachedTier1: vi.fn().mockReturnValue(null) } as unknown as RouterContext['cache'],
        serializer: {
            load: vi.fn().mockReturnValue(null),
            delete: vi.fn(),
            listAll: vi.fn().mockReturnValue([]),
        } as unknown as RouterContext['serializer'],
        workspace: {
            getWorkspaceRoot: vi.fn().mockReturnValue('/ws'),
            getConfig: vi.fn().mockReturnValue(''),
        } as unknown as RouterContext['workspace'],
        gitProvider: {
            getState: vi.fn().mockResolvedValue({ isGitRepo: true, branch: 'main', changes: [] }),
        } as unknown as RouterContext['gitProvider'],
        llm: {
            generate: vi.fn().mockResolvedValue({ text: '', finishReason: 'stop' }),
        } as unknown as RouterContext['llm'],
        ...overrides,
    };
}

describe('routeWebviewMessage', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    // ─── requestTour ──────────────────────────────────────────────────────────

    it('requestTour delegates to ctx.generateAndShowTour with query and tourType', async () => {
        const ctx = makeCtx();
        await routeWebviewMessage({ type: 'requestTour', query: 'show me auth', tourType: 'custom' }, ctx);
        expect(ctx.generateAndShowTour).toHaveBeenCalledWith('show me auth', 'custom');
    });

    // ─── openFile ─────────────────────────────────────────────────────────────

    it('openFile delegates to ctx.openFile with path and line', async () => {
        const ctx = makeCtx();
        await routeWebviewMessage({ type: 'openFile', path: 'src/auth.ts', line: 42 }, ctx);
        expect(ctx.openFile).toHaveBeenCalledWith('src/auth.ts', 42);
    });

    it('openFile delegates with undefined line when not specified', async () => {
        const ctx = makeCtx();
        await routeWebviewMessage({ type: 'openFile', path: 'src/app.ts' }, ctx);
        expect(ctx.openFile).toHaveBeenCalledWith('src/app.ts', undefined);
    });

    // ─── openSettings ─────────────────────────────────────────────────────────

    it('openSettings delegates to ctx.openSettings', async () => {
        const ctx = makeCtx();
        await routeWebviewMessage({ type: 'openSettings' }, ctx);
        expect(ctx.openSettings).toHaveBeenCalled();
    });

    // ─── requestAnalysis ──────────────────────────────────────────────────────

    it('requestAnalysis calls ensureOrchestrator().runScoped when workspace root present', async () => {
        const runScoped = vi.fn().mockResolvedValue({ report: makeReport(), tier0Ms: 0, tier1Ms: 0 });
        const ctx = makeCtx({ ensureOrchestrator: vi.fn().mockReturnValue({ runScoped, ensureWarmTier0: vi.fn() }) });
        await routeWebviewMessage({ type: 'requestAnalysis' }, ctx);
        expect(runScoped).toHaveBeenCalledWith(
            'fullWorkspace',
            expect.objectContaining({ publishTier0: true }),
            expect.any(Function),
        );
    });

    it('requestAnalysis skips runScoped when no workspace root', async () => {
        const runScoped = vi.fn();
        const ctx = makeCtx({
            workspace: { getWorkspaceRoot: vi.fn().mockReturnValue(null), getConfig: vi.fn() } as unknown as RouterContext['workspace'],
            ensureOrchestrator: vi.fn().mockReturnValue({ runScoped, ensureWarmTier0: vi.fn() }),
        });
        await routeWebviewMessage({ type: 'requestAnalysis' }, ctx);
        expect(runScoped).not.toHaveBeenCalled();
    });

    // ─── ready ────────────────────────────────────────────────────────────────

    it('ready sends app config and saved tours', async () => {
        const ctx = makeCtx();
        await routeWebviewMessage({ type: 'ready' }, ctx);
        expect(ctx.sendAppConfig).toHaveBeenCalled();
        expect(ctx.sendSavedTours).toHaveBeenCalled();
    });

    it('ready warms orchestrator tier-0', async () => {
        const warmStartupAnalysis = vi.fn();
        const ctx = makeCtx({ warmStartupAnalysis });
        await routeWebviewMessage({ type: 'ready' }, ctx);
        expect(warmStartupAnalysis).toHaveBeenCalled();
    });

    it('ready warms orchestrator tier-0 even when a legacy warmup flag is false', async () => {
        const warmStartupAnalysis = vi.fn();
        const ctx = makeCtx({ warmStartupAnalysis });
        (ctx as any).enableWarmupOnReady = false;
        await routeWebviewMessage({ type: 'ready' }, ctx);
        expect(warmStartupAnalysis).toHaveBeenCalled();
    });

    it('ready sends cached analysis report when present', async () => {
        const report = makeReport();
        const ctx = makeCtx({
            cache: { report, getCachedTier1: vi.fn() } as unknown as RouterContext['cache'],
        });
        await routeWebviewMessage({ type: 'ready' }, ctx);
        expect(ctx.sendAnalysis).toHaveBeenCalledWith(report);
    });

    it('ready does not call sendAnalysis when cache has no report', async () => {
        const ctx = makeCtx();
        await routeWebviewMessage({ type: 'ready' }, ctx);
        expect(ctx.sendAnalysis).not.toHaveBeenCalled();
    });

    // ─── webviewLog ───────────────────────────────────────────────────────────

    it('webviewLog does not throw and does not call any ctx methods', async () => {
        const ctx = makeCtx();
        await expect(
            routeWebviewMessage({ type: 'webviewLog', level: 'debug', message: 'hello', data: {} }, ctx),
        ).resolves.not.toThrow();
        expect(ctx.postMessage).not.toHaveBeenCalled();
    });

    // ─── loadTour ─────────────────────────────────────────────────────────────

    it('loadTour sends tour directly when no cached report has more nodes', async () => {
        const tour = makeTour('t-1', 3);
        const ctx = makeCtx({
            serializer: { load: vi.fn().mockReturnValue(tour), delete: vi.fn(), listAll: vi.fn() } as unknown as RouterContext['serializer'],
        });
        await routeWebviewMessage({ type: 'loadTour', tourId: 't-1' }, ctx);
        expect(ctx.sendTour).toHaveBeenCalledWith(tour);
    });

    it('loadTour rebuilds graph when cached report has more nodes than saved tour', async () => {
        // Dynamic import mock at top: buildDeterministicTour returns fresh graph with 1 node
        const tour = makeTour('t-1', 1); // 1 node
        const report = makeReport(5);    // 5 nodes — report > tour → rebuild path
        const ctx = makeCtx({
            serializer: { load: vi.fn().mockReturnValue(tour), delete: vi.fn(), listAll: vi.fn() } as unknown as RouterContext['serializer'],
            cache: { report: null, getCachedTier1: vi.fn().mockReturnValue(report) } as unknown as RouterContext['cache'],
        });
        await routeWebviewMessage({ type: 'loadTour', tourId: 't-1' }, ctx);
        // Tour was merged with fresh graph (id preserved from original tour)
        expect(ctx.sendTour).toHaveBeenCalledWith(expect.objectContaining({ id: 't-1' }));
    });

    it('loadTour rebuilds graph when saved tour has no circular markers but cached report has cycles', async () => {
        const tour = makeTour('t-1', 2);
        // Distinguish stale saved graph from mocked fresh graph
        tour.graph.nodes = [
            { id: 'old-a', label: 'old-a', type: 'unknown' },
            { id: 'old-b', label: 'old-b', type: 'unknown' },
        ];
        tour.graph.edges = [{ source: 'old-a', target: 'old-b', label: 'imports' }];
        const report = makeReport(2, [['node0', 'node1']]);
        const ctx = makeCtx({
            serializer: { load: vi.fn().mockReturnValue(tour), delete: vi.fn(), listAll: vi.fn() } as unknown as RouterContext['serializer'],
            cache: { report: null, getCachedTier1: vi.fn().mockReturnValue(report) } as unknown as RouterContext['cache'],
        });

        await routeWebviewMessage({ type: 'loadTour', tourId: 't-1' }, ctx);

        expect(ctx.sendTour).toHaveBeenCalledWith(
            expect.objectContaining({
                id: 't-1',
                graph: expect.objectContaining({
                    nodes: [{ id: 'n0', label: 'n0', type: 'unknown' }],
                }),
            }),
        );
    });

    it('loadTour posts error when tour not found in serializer', async () => {
        const ctx = makeCtx({
            serializer: { load: vi.fn().mockReturnValue(null), delete: vi.fn(), listAll: vi.fn() } as unknown as RouterContext['serializer'],
        });
        await routeWebviewMessage({ type: 'loadTour', tourId: 'missing' }, ctx);
        expect(ctx.postMessage).toHaveBeenCalledWith({ type: 'error', message: 'Tour not found' });
    });

    // ─── deleteTour ───────────────────────────────────────────────────────────

    it('deleteTour calls serializer.delete and ctx.sendSavedTours', async () => {
        const deleteFn = vi.fn();
        const ctx = makeCtx({
            serializer: { load: vi.fn(), delete: deleteFn, listAll: vi.fn() } as unknown as RouterContext['serializer'],
        });
        await routeWebviewMessage({ type: 'deleteTour', tourId: 't-99' }, ctx);
        expect(deleteFn).toHaveBeenCalledWith('t-99');
        expect(ctx.sendSavedTours).toHaveBeenCalled();
    });

    // ─── analyzerQuery ────────────────────────────────────────────────────────

    it('analyzerQuery posts analyzerReply when cache has report and LLM succeeds', async () => {
        const report = makeReport();
        const llm = { generate: vi.fn().mockResolvedValue({ text: 'The entry point is src/index.ts', finishReason: 'stop' }) };
        const ctx = makeCtx({
            cache: { report, getCachedTier1: vi.fn() } as unknown as RouterContext['cache'],
            llm: llm as unknown as RouterContext['llm'],
        });
        await routeWebviewMessage({ type: 'analyzerQuery', text: 'what is the entry point?' }, ctx);
        expect(ctx.postMessage).toHaveBeenCalledWith(
            expect.objectContaining({ type: 'analyzerReply', text: 'The entry point is src/index.ts' }),
        );
    });

    it('analyzerQuery posts analyzerError when no cached report', async () => {
        const llm = { generate: vi.fn() };
        const ctx = makeCtx({
            cache: { report: null, getCachedTier1: vi.fn() } as unknown as RouterContext['cache'],
            llm: llm as unknown as RouterContext['llm'],
        });
        await routeWebviewMessage({ type: 'analyzerQuery', text: 'tell me about the codebase' }, ctx);
        expect(ctx.postMessage).toHaveBeenCalledWith(
            expect.objectContaining({
                type: 'analyzerError',
                message: expect.stringContaining('No analysis available yet'),
            }),
        );
        expect(llm.generate).not.toHaveBeenCalled();
    });

    it('analyzerQuery posts analyzerError when LLM throws', async () => {
        const report = makeReport();
        const llm = { generate: vi.fn().mockRejectedValue(new Error('LLM timeout')) };
        const ctx = makeCtx({
            cache: { report, getCachedTier1: vi.fn() } as unknown as RouterContext['cache'],
            llm: llm as unknown as RouterContext['llm'],
        });
        await routeWebviewMessage({ type: 'analyzerQuery', text: 'what are the circular deps?' }, ctx);
        expect(ctx.postMessage).toHaveBeenCalledWith(
            expect.objectContaining({ type: 'analyzerError', message: expect.stringContaining('LLM timeout') }),
        );
    });
});

// ─── reponavHelp ─────────────────────────────────────────────────────────────

describe('reponavHelp', () => {
    it('posts analyzerReply with the static usability reference', async () => {
        const ctx = makeCtx();
        await routeWebviewMessage({ type: 'reponavHelp' }, ctx);
        expect(ctx.postMessage).toHaveBeenCalledOnce();
        expect(ctx.postMessage).toHaveBeenCalledWith(
            expect.objectContaining({ type: 'analyzerReply' }),
        );
    });

    it('reply contains command palette entries', async () => {
        const ctx = makeCtx();
        await routeWebviewMessage({ type: 'reponavHelp' }, ctx);
        const call = (ctx.postMessage as ReturnType<typeof vi.fn>).mock.calls[0][0];
        expect(call.text).toContain('RepoNav: Generate Architecture Tour');
        expect(call.text).toContain('RepoNav: Health Check');
    });

    it('reply contains all five BYOK provider entries', async () => {
        const ctx = makeCtx();
        await routeWebviewMessage({ type: 'reponavHelp' }, ctx);
        const { text } = (ctx.postMessage as ReturnType<typeof vi.fn>).mock.calls[0][0];
        expect(text).toContain('reponav.groqApiKey');
        expect(text).toContain('reponav.anthropicApiKey');
        expect(text).toContain('reponav.openAIApiKey');
        expect(text).toContain('reponav.geminiApiKey');
        expect(text).toContain('vscode-lm');
    });

    it('reply contains CLI command reference with check thresholds', async () => {
        const ctx = makeCtx();
        await routeWebviewMessage({ type: 'reponavHelp' }, ctx);
        const { text } = (ctx.postMessage as ReturnType<typeof vi.fn>).mock.calls[0][0];
        expect(text).toContain('--max-violations N');
        expect(text).toContain('impact --symbol <name>');
    });

    it('does not call LLM for help queries', async () => {
        const llm = { generate: vi.fn() };
        const ctx = makeCtx({ llm: llm as unknown as RouterContext['llm'] });
        await routeWebviewMessage({ type: 'reponavHelp' }, ctx);
        expect(llm.generate).not.toHaveBeenCalled();
    });

    it('reply heading uses "RepoNav Usability Reference" (correct branding, no em-dash)', async () => {
        const ctx = makeCtx();
        await routeWebviewMessage({ type: 'reponavHelp' }, ctx);
        const { text } = (ctx.postMessage as ReturnType<typeof vi.fn>).mock.calls[0][0];
        expect(text).toContain('RepoNav Usability Reference');
        // Governance: em dash surrounded by spaces (' — ') must never appear in help content.
        // Use ':' or a new line instead to keep card text clean.
        expect(text).not.toContain(' — ');
    });
});
