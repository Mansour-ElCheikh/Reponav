import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppConfig, Tour } from '../types';
import type { GitState, TourSummary } from './useRepoNavState';

let postMessageSpy: ReturnType<typeof vi.fn>;

const ROUTES_FILE_LINE = 27;
const STREAM_TIMEOUT_MS = 60_000;

const TOUR_FIXTURE: Tour = {
    id: 'tour_123',
    query: 'overview',
    tourType: 'overview',
    steps: [
        {
            order: 1,
            title: 'Entry',
            what_it_does: 'Bootstraps app',
            why_it_matters: 'Start here',
            watch_out: 'None',
            files: ['src/main.ts'],
            highlights: [],
            relationships: [],
        },
        {
            order: 2,
            title: 'Routing',
            what_it_does: 'Routes requests',
            why_it_matters: 'Core flow',
            watch_out: 'Auth assumptions',
            files: ['src/routes.ts'],
            highlights: [],
            relationships: [],
        },
    ],
    graph: {
        nodes: [
            { id: 'src/main.ts', label: 'main.ts', type: 'entry' },
            { id: 'src/routes.ts', label: 'routes.ts', type: 'route' },
        ],
        edges: [{ source: 'src/main.ts', target: 'src/routes.ts', label: 'imports' }],
    },
    analysisSnapshot: {
        frameworks: ['typescript'],
        entryPoints: ['src/main.ts'],
        totalFiles: 2,
        totalEdges: 1,
        circularCount: 0,
    },
    createdAt: '2026-03-11T00:00:00.000Z',
};

function createHandlers() {
    return {
        setTour: vi.fn<(tour: Tour) => void>(),
        setCurrentStep: vi.fn<(step: number) => void>(),
        setIsGenerating: vi.fn<(value: boolean) => void>(),
        setStatus: vi.fn<(status: string) => void>(),
        setError: vi.fn<(error: string) => void>(),
        setReport: vi.fn(),
        setSavedTours: vi.fn<(tours: TourSummary[]) => void>(),
        setGitState: vi.fn<(state: GitState) => void>(),
        setAppConfig: vi.fn<(config: AppConfig) => void>(),
    };
}

describe('handleRepoNavMessage', () => {
    beforeEach(() => {
        vi.resetModules();
        postMessageSpy = vi.fn();
        vi.stubGlobal('window', {
            acquireVsCodeApi: () => ({
                postMessage: postMessageSpy,
                getState: () => null,
                setState: () => {
                    // no-op in tests
                },
            }),
        });
    });

    it('applies generating transition', async () => {
        const handlers = createHandlers();
        const { handleRepoNavMessage } = await import('./useRepoNavState');

        handleRepoNavMessage(
            { type: 'tourGenerating', status: 'Building dependency graph...' },
            handlers
        );

        expect(handlers.setIsGenerating).toHaveBeenCalledWith(true);
        expect(handlers.setStatus).toHaveBeenCalledWith('Building dependency graph...');
        expect(handlers.setError).toHaveBeenCalledWith('');
    });

    it('applies error transition', async () => {
        const handlers = createHandlers();
        const { handleRepoNavMessage } = await import('./useRepoNavState');

        handleRepoNavMessage(
            { type: 'error', message: 'Request timed out while generating tour' },
            handlers
        );

        expect(handlers.setError).toHaveBeenCalledWith('Request timed out while generating tour');
        expect(handlers.setIsGenerating).toHaveBeenCalledWith(false);
        expect(handlers.setStatus).toHaveBeenCalledWith('');
    });

    it('applies git status transition', async () => {
        const handlers = createHandlers();
        const { handleRepoNavMessage } = await import('./useRepoNavState');

        handleRepoNavMessage(
            {
                type: 'gitStatus',
                branch: 'main',
                changes: [{ path: 'src/index.ts', status: 'M' }],
            },
            handlers
        );

        expect(handlers.setGitState).toHaveBeenCalledWith({
            branch: 'main',
            changes: [{ path: 'src/index.ts', status: 'M' }],
        });
    });
});

describe('graph interaction helpers', () => {
    beforeEach(() => {
        vi.resetModules();
        postMessageSpy = vi.fn();
        vi.stubGlobal('window', {
            acquireVsCodeApi: () => ({
                postMessage: postMessageSpy,
                getState: () => null,
                setState: () => {
                    // no-op in tests
                },
            }),
        });
    });

    it('syncStepToGraphNode updates step without opening file', async () => {
        const setCurrentStep = vi.fn<(step: number) => void>();
        const { syncStepToGraphNode } = await import('./useRepoNavState');

        syncStepToGraphNode(TOUR_FIXTURE, 'src/routes.ts', setCurrentStep);

        expect(setCurrentStep).toHaveBeenCalledWith(1);
        expect(postMessageSpy).not.toHaveBeenCalled();
    });

    it('postOpenFileMessage sends explicit openFile message', async () => {
        const { postOpenFileMessage } = await import('./useRepoNavState');

        postOpenFileMessage('src/routes.ts', ROUTES_FILE_LINE);

        expect(postMessageSpy).toHaveBeenCalledWith({
            type: 'openFile',
            path: 'src/routes.ts',
            line: ROUTES_FILE_LINE,
        });
    });
});

describe('tour request helpers', () => {
    beforeEach(() => {
        vi.resetModules();
        postMessageSpy = vi.fn();
        vi.stubGlobal('window', {
            acquireVsCodeApi: () => ({
                postMessage: postMessageSpy,
                getState: () => null,
                setState: () => {
                    // no-op in tests
                },
            }),
        });
    });

    it('startTourRequest sets immediate loading state before extension responds', async () => {
        const { startTourRequest } = await import('./useRepoNavState');
        const setIsGenerating = vi.fn<(value: boolean) => void>();
        const setStatus = vi.fn<(status: string) => void>();
        const setError = vi.fn<(error: string) => void>();

        startTourRequest('show me the architecture', 'overview', {
            setIsGenerating,
            setStatus,
            setError,
        });

        expect(setIsGenerating).toHaveBeenCalledWith(true);
        expect(setStatus).toHaveBeenCalledWith('Preparing tour...');
        expect(setError).toHaveBeenCalledWith('');
        expect(postMessageSpy).toHaveBeenCalledWith({
            type: 'requestTour',
            query: 'show me the architecture',
            tourType: 'overview',
        });
    });
});

describe('tour streaming handlers', () => {
    beforeEach(() => {
        vi.resetModules();
        postMessageSpy = vi.fn();
        vi.stubGlobal('window', {
            acquireVsCodeApi: () => ({
                postMessage: postMessageSpy,
                getState: () => null,
                setState: () => {
                    // no-op in tests
                },
            }),
        });
    });

    it('handles tour.stream_chunk with graph payload — sets graph and keeps isGenerating true', async () => {
        const handlers = createHandlers();
        const { handleRepoNavMessage } = await import('./useRepoNavState');

        handleRepoNavMessage(
            {
                type: 'tour.stream_chunk',
                payload: {
                    type: 'graph',
                    data: {
                        id: 'test-graph',
                        query: 'test',
                        tourType: 'overview' as const,
                        steps: [],
                        graph: {
                            nodes: [{ id: 'src/main.ts', label: 'main.ts', type: 'entry' }],
                            edges: [],
                        },
                        analysisSnapshot: { frameworks: [], entryPoints: [], totalFiles: 1, totalEdges: 0, circularCount: 0 },
                        createdAt: new Date().toISOString(),
                    },
                },
            },
            handlers
        );

        expect(handlers.setTour).toHaveBeenCalledWith(
            expect.objectContaining({
                graph: {
                    nodes: [{ id: 'src/main.ts', label: 'main.ts', type: 'entry' }],
                    edges: [],
                },
            })
        );
        expect(handlers.setIsGenerating).toHaveBeenCalledWith(true);
    });

    it('handles tour.stream_chunk with step payload — appends step without replacing', async () => {
        const handlers = createHandlers();
        const setStreamingSteps = vi.fn();
        handlers.setStreamingSteps = setStreamingSteps;
        const { handleRepoNavMessage } = await import('./useRepoNavState');

        const step1 = {
            order: 1,
            title: 'First',
            what_it_does: 'Does first thing',
            why_it_matters: 'Important',
            watch_out: 'None',
            files: ['a.ts'],
            highlights: [],
            relationships: [],
        };

        handleRepoNavMessage(
            {
                type: 'tour.stream_chunk',
                payload: { type: 'step', data: step1 },
            },
            handlers
        );

        expect(setStreamingSteps).toHaveBeenCalledWith(expect.any(Function));
        // Verify the update function appends
        const updateFn = setStreamingSteps.mock.calls[0][0];
        const result = updateFn([]);
        expect(result).toEqual([step1]);
    });

    it('handles tour.stream_end — merges streaming steps into final tour and stops generating', async () => {
        const handlers = createHandlers();
        const setStreamingSteps = vi.fn();
        const setClearStreamTimeout = vi.fn();
        handlers.setStreamingSteps = setStreamingSteps;
        handlers.setClearStreamTimeout = setClearStreamTimeout;
        const { handleRepoNavMessage } = await import('./useRepoNavState');

        // Simulate having a tour with graph already set and streaming steps buffered
        const existingTour = {
            id: 'tour_streaming',
            query: 'test',
            tourType: 'overview',
            steps: [],
            graph: { nodes: [], edges: [] },
            analysisSnapshot: {
                frameworks: [],
                entryPoints: [],
                totalFiles: 0,
                totalEdges: 0,
                circularCount: 0,
            },
            createdAt: '2026-04-04',
        };

        const streamedSteps = [
            {
                order: 1,
                title: 'Step 1',
                what_it_does: 'One',
                why_it_matters: 'Matters',
                watch_out: 'None',
                files: ['a.ts'],
                highlights: [],
                relationships: [],
            },
            {
                order: 2,
                title: 'Step 2',
                what_it_does: 'Two',
                why_it_matters: 'Also matters',
                watch_out: 'None',
                files: ['b.ts'],
                highlights: [],
                relationships: [],
            },
        ];

        // Mock getTour and getStreamingSteps context
        handlers.getTour = () => existingTour;
        handlers.getStreamingSteps = () => streamedSteps;

        handleRepoNavMessage({ type: 'tour.stream_end' }, handlers);

        expect(handlers.setTour).toHaveBeenCalledWith(
            expect.objectContaining({
                steps: streamedSteps,
            })
        );
        expect(handlers.setIsGenerating).toHaveBeenCalledWith(false);
        expect(setStreamingSteps).toHaveBeenCalledWith([]);
        expect(setClearStreamTimeout).toHaveBeenCalled();
    });

    it('sets 60s timeout on first stream_chunk and fires incomplete notice if stream_end never arrives', async () => {
        vi.useFakeTimers();
        const handlers = createHandlers();
        const setStreamTimeout = vi.fn();
        handlers.setStreamTimeout = setStreamTimeout;
        const { handleRepoNavMessage } = await import('./useRepoNavState');

        // Send first chunk
        handleRepoNavMessage(
            {
                type: 'tour.stream_chunk',
                payload: {
                    type: 'graph',
                    data: {
                        id: 'test-graph',
                        query: 'test',
                        tourType: 'overview' as const,
                        steps: [],
                        graph: { nodes: [], edges: [] },
                        analysisSnapshot: { frameworks: [], entryPoints: [], totalFiles: 0, totalEdges: 0, circularCount: 0 },
                        createdAt: new Date().toISOString(),
                    },
                },
            },
            handlers
        );

        expect(setStreamTimeout).toHaveBeenCalledWith(expect.any(Function));

        // Get the timeout callback
        const timeoutFn = setStreamTimeout.mock.calls[0][0];

        // Fast-forward the stream timeout window
        vi.advanceTimersByTime(STREAM_TIMEOUT_MS);

        // Trigger the timeout callback
        timeoutFn();

        expect(handlers.setIsGenerating).toHaveBeenCalledWith(false);
        expect(handlers.setError).toHaveBeenCalledWith(
            expect.stringContaining('Tour may be incomplete')
        );

        vi.useRealTimers();
    });

    it('buffers steps when they arrive before graph chunk', async () => {
        const handlers = createHandlers();
        const setStreamingSteps = vi.fn();
        handlers.setStreamingSteps = setStreamingSteps;
        const { handleRepoNavMessage } = await import('./useRepoNavState');

        const step1 = {
            order: 1,
            title: 'First',
            what_it_does: 'One',
            why_it_matters: 'Matters',
            watch_out: 'None',
            files: ['a.ts'],
            highlights: [],
            relationships: [],
        };

        // Step arrives before graph
        handleRepoNavMessage(
            {
                type: 'tour.stream_chunk',
                payload: { type: 'step', data: step1 },
            },
            handlers
        );

        expect(setStreamingSteps).toHaveBeenCalled();

        // Graph arrives after
        handleRepoNavMessage(
            {
                type: 'tour.stream_chunk',
                payload: {
                    type: 'graph',
                    data: {
                        id: 'test-graph',
                        query: 'test',
                        tourType: 'overview' as const,
                        steps: [],
                        graph: { nodes: [], edges: [] },
                        analysisSnapshot: { frameworks: [], entryPoints: [], totalFiles: 0, totalEdges: 0, circularCount: 0 },
                        createdAt: new Date().toISOString(),
                    },
                },
            },
            handlers
        );

        // Both tour (with graph) and steps should be set
        expect(handlers.setTour).toHaveBeenCalled();
        expect(setStreamingSteps).toHaveBeenCalled();
    });
});

describe('streaming visibility helper', () => {
    it('keeps streaming mode visible while a provisional graph exists even before steps arrive', async () => {
        const { shouldShowTourStreaming } = await import('./useRepoNavState');

        expect(
            shouldShowTourStreaming(true, {
                ...TOUR_FIXTURE,
                steps: [],
            }, [])
        ).toBe(true);
        expect(shouldShowTourStreaming(true, null, [])).toBe(false);
        expect(
            shouldShowTourStreaming(true, TOUR_FIXTURE, [])
        ).toBe(false);
        expect(shouldShowTourStreaming(false, TOUR_FIXTURE, [])).toBe(false);
    });
});
