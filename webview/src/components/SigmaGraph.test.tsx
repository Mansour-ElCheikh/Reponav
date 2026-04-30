/**
 * SigmaGraph component tests.
 * Mock-based runtime checks verify interaction timing without requiring WebGL.
 */
import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const sigmaGraphTestDoubles = vi.hoisted(() => {
    const forceAtlasAssign = vi.fn();
    const forceAtlasInferSettings = vi.fn(() => ({ scalingRatio: 1, gravity: 1, slowDown: 1 }));
    let lastSigmaEventCallbacks: Record<string, unknown> | null = null;
    const attachSigmaEventsMock = vi.fn((_renderer, _graph, callbacks) => {
        lastSigmaEventCallbacks = callbacks as Record<string, unknown>;
        return () => undefined;
    });
    const flowOverlayMock = vi.fn(() => null);
    const flowOverlaySetPathsMock = vi.fn();
    const flowOverlayClearMock = vi.fn();
    const sigmaRefreshMock = vi.fn();
    const sigmaSetSettingMock = vi.fn();

    class MockGraph {
        static lastInstance: MockGraph | null = null;

        private readonly nodeAttrs = new Map<string, Record<string, unknown>>();
        private readonly edgeAttrs = new Map<string, { source: string; target: string; attrs: Record<string, unknown> }>();

        constructor(_options?: Record<string, unknown>) {
            MockGraph.lastInstance = this;
        }

        addNode(id: string, attrs: Record<string, unknown>) {
            this.nodeAttrs.set(id, { ...attrs });
        }

        hasNode(id: string) {
            return this.nodeAttrs.has(id);
        }

        dropNode(id: string) {
            this.nodeAttrs.delete(id);
            for (const [edgeKey, edge] of this.edgeAttrs.entries()) {
                if (edge.source === id || edge.target === id) this.edgeAttrs.delete(edgeKey);
            }
        }

        addEdgeWithKey(key: string, source: string, target: string, attrs: Record<string, unknown>) {
            this.edgeAttrs.set(key, { source, target, attrs: { ...attrs } });
        }

        hasEdge(key: string) {
            return this.edgeAttrs.has(key);
        }

        dropEdge(key: string) {
            this.edgeAttrs.delete(key);
        }

        nodes() {
            return [...this.nodeAttrs.keys()];
        }

        edges() {
            return [...this.edgeAttrs.keys()];
        }

        neighbors(id: string) {
            const result = new Set<string>();
            for (const edge of this.edgeAttrs.values()) {
                if (edge.source === id) result.add(edge.target);
                if (edge.target === id) result.add(edge.source);
            }
            return [...result];
        }

        mergeNodeAttributes(id: string, attrs: Record<string, unknown>) {
            const current = this.nodeAttrs.get(id) ?? {};
            this.nodeAttrs.set(id, { ...current, ...attrs });
        }

        getNodeAttributes(id: string) {
            return this.nodeAttrs.get(id) ?? {};
        }

        forEachNode(callback: (id: string, attrs: Record<string, unknown>) => void) {
            for (const [id, attrs] of this.nodeAttrs.entries()) callback(id, attrs);
        }

        forEachEdge(callback: (key: string, attrs: Record<string, unknown>, source: string, target: string) => void) {
            for (const [key, edge] of this.edgeAttrs.entries()) callback(key, edge.attrs, edge.source, edge.target);
        }

        source(key: string) {
            return this.edgeAttrs.get(key)?.source ?? '';
        }

        target(key: string) {
            return this.edgeAttrs.get(key)?.target ?? '';
        }

        get order() {
            return this.nodeAttrs.size;
        }
    }

    class MockSigma {
        static lastInstance: MockSigma | null = null;

        readonly handlers: Record<string, Array<(...args: unknown[]) => void>> = {};
        cameraState = { x: 0, y: 0, ratio: 1, angle: 0 };

        constructor(_graph: MockGraph, _container: HTMLElement, _settings: Record<string, unknown>) {
            MockSigma.lastInstance = this;
        }

        setSetting = sigmaSetSettingMock;
        refresh = sigmaRefreshMock;
        on = vi.fn((event: string, handler: (...args: unknown[]) => void) => {
            if (!this.handlers[event]) this.handlers[event] = [];
            this.handlers[event].push(handler);
        });
        off = vi.fn((event: string, handler: (...args: unknown[]) => void) => {
            this.handlers[event] = (this.handlers[event] ?? []).filter((candidate) => candidate !== handler);
        });
        kill = vi.fn();
        getNodeDisplayData = vi.fn((nodeId: string) => {
            if (nodeId === 'src/a.ts') return { x: 0.1, y: 0.2 };
            if (nodeId === 'src/b.ts') return { x: 0.3, y: 0.4 };
            return { x: 0.5, y: 0.6 };
        });
        framedGraphToViewport = vi.fn((point: { x: number; y: number }) => ({
            x: point.x * 100 * this.cameraState.ratio + this.cameraState.x,
            y: point.y * 100 * this.cameraState.ratio + this.cameraState.y,
        }));
        getCamera = vi.fn(() => ({
            getState: () => ({ ...this.cameraState }),
            animatedZoom: vi.fn(),
            animatedUnzoom: vi.fn(),
            animatedReset: vi.fn(),
        }));

        emit(event: string, payload?: unknown) {
            for (const handler of this.handlers[event] ?? []) handler(payload);
        }
    }

    return {
        forceAtlasAssign,
        forceAtlasInferSettings,
        attachSigmaEventsMock,
        getLastSigmaEventCallbacks: () => lastSigmaEventCallbacks,
        flowOverlayMock,
        flowOverlaySetPathsMock,
        flowOverlayClearMock,
        sigmaRefreshMock,
        sigmaSetSettingMock,
        MockGraph,
        MockSigma,
    };
});

const {
    forceAtlasAssign,
    forceAtlasInferSettings,
    attachSigmaEventsMock,
    getLastSigmaEventCallbacks,
    flowOverlayMock,
    flowOverlaySetPathsMock,
    flowOverlayClearMock,
    sigmaRefreshMock,
    sigmaSetSettingMock,
    MockGraph,
    MockSigma,
} = sigmaGraphTestDoubles;

const graphToolbarPropsSpy = vi.fn();

vi.mock('graphology', () => ({ default: sigmaGraphTestDoubles.MockGraph }));
vi.mock('sigma', () => ({ default: sigmaGraphTestDoubles.MockSigma }));
vi.mock('sigma/rendering', () => ({ drawDiscNodeHover: vi.fn() }));
vi.mock('@sigma/node-border', () => ({ createNodeBorderProgram: vi.fn(() => 'bordered-program') }));
vi.mock('graphology-layout-forceatlas2', () => ({
    default: {
        assign: sigmaGraphTestDoubles.forceAtlasAssign,
        inferSettings: sigmaGraphTestDoubles.forceAtlasInferSettings,
    },
}));
vi.mock('./sigmaEventHandlers', () => ({ attachSigmaEvents: sigmaGraphTestDoubles.attachSigmaEventsMock }));
vi.mock('./SigmaLegends', () => ({
    NodeSelectionLegend: ({ onSubFilterChange }: { onSubFilterChange?: (value: 'upstream' | 'downstream' | 'circular' | null) => void }) => (
        <button
            data-testid="legend-upstream"
            onClick={() => onSubFilterChange?.('upstream')}
            type="button"
        >
            legend upstream
        </button>
    ),
    NodeTypeLegend: () => null,
}));
vi.mock('./FlowOverlay', () => ({
    FlowOverlay: React.forwardRef((props: unknown, ref: React.ForwardedRef<{ setPaths: (paths: number[][][]) => void; clear: () => void }>) => {
        React.useImperativeHandle(ref, () => ({
            setPaths: sigmaGraphTestDoubles.flowOverlaySetPathsMock,
            clear: sigmaGraphTestDoubles.flowOverlayClearMock,
        }));
        sigmaGraphTestDoubles.flowOverlayMock({ ...(props as Record<string, unknown>) });
        return null;
    }),
}));
vi.mock('./GraphToolbar', () => ({
    GraphToolbar: ({ filters, onFiltersChange, showFlowEdges }: { filters: { showTestFiles: boolean; showCircularOnly: boolean; groupDirs: boolean }; onFiltersChange: (next: { showTestFiles: boolean; showCircularOnly: boolean; groupDirs: boolean }) => void; showFlowEdges: boolean }) => {
        graphToolbarPropsSpy({ filters, showFlowEdges });
        return (
            <>
                <button
                    data-testid="toggle-test-files"
                    onClick={() => onFiltersChange({ ...filters, showTestFiles: !filters.showTestFiles })}
                    type="button"
                >
                    toggle tests
                </button>
                <button
                    data-testid="toggle-circular-only"
                    onClick={() => onFiltersChange({ ...filters, showCircularOnly: !filters.showCircularOnly })}
                    type="button"
                >
                    toggle circular
                </button>
                <div data-testid="flow-edge-state">{String(showFlowEdges)}</div>
            </>
        );
    },
}));

import { SigmaGraph } from './SigmaGraph';
import type { Tour } from '../types';

describe('SigmaGraph', () => {
    beforeEach(() => {
        Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
            configurable: true,
            value: vi.fn(() => ({
                clearRect: vi.fn(),
                beginPath: vi.fn(),
                arc: vi.fn(),
                fill: vi.fn(),
                fillStyle: '',
                globalAlpha: 1,
            })),
        });
        sigmaRefreshMock.mockClear();
        sigmaSetSettingMock.mockClear();
        forceAtlasAssign.mockClear();
        graphToolbarPropsSpy.mockClear();
        forceAtlasInferSettings.mockClear();
        attachSigmaEventsMock.mockClear();
        flowOverlayMock.mockClear();
        flowOverlaySetPathsMock.mockClear();
        flowOverlayClearMock.mockClear();
        MockGraph.lastInstance = null;
        MockSigma.lastInstance = null;
    });

    it('creates the Sigma renderer before running the initial layout pass', async () => {
        Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, value: 800 });
        Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, value: 600 });

        vi.useFakeTimers();
        try {
            const tour: Tour = {
                id: 'tour-layout',
                query: 'demo',
                tourType: 'overview',
                createdAt: '2026-04-16T00:00:00.000Z',
                steps: [],
                analysisSnapshot: {
                    frameworks: [],
                    entryPoints: [],
                    totalFiles: 2,
                    totalEdges: 1,
                    circularCount: 0,
                },
                graph: {
                    nodes: [
                        { id: 'src/a.ts', label: 'src/a.ts', type: 'entry', weight: 1 },
                        { id: 'src/b.ts', label: 'src/b.ts', type: 'service', weight: 1 },
                    ],
                    edges: [{ source: 'src/a.ts', target: 'src/b.ts', label: 'imports', isCircular: false }],
                },
            };

            render(
                <SigmaGraph
                    tour={tour}
                    currentStep={0}
                    onNodeClick={vi.fn()}
                />
            );

            await act(async () => {
                await Promise.resolve();
            });

            expect(MockSigma.lastInstance).not.toBeNull();
            expect(forceAtlasAssign).not.toHaveBeenCalled();
            expect(screen.getByTestId('sigma-surface').style.visibility).toBe('hidden');

            await act(async () => {
                vi.runAllTimers();
            });

            expect(forceAtlasAssign).toHaveBeenCalled();
            expect(screen.getByTestId('sigma-surface').style.visibility).toBe('visible');
        } finally {
            vi.useRealTimers();
        }
    });

    it('keeps the flow overlay hidden until the initial layout completes', async () => {
        Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, value: 800 });
        Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, value: 600 });

        vi.useFakeTimers();
        try {
            const tour: Tour = {
                id: 'tour-flow-hidden-until-stable',
                query: 'demo',
                tourType: 'overview',
                createdAt: '2026-04-16T00:00:00.000Z',
                steps: [],
                analysisSnapshot: {
                    frameworks: [],
                    entryPoints: [],
                    totalFiles: 2,
                    totalEdges: 1,
                    circularCount: 0,
                },
                graph: {
                    nodes: [
                        { id: 'src/a.ts', label: 'src/a.ts', type: 'entry', weight: 1 },
                        { id: 'src/b.ts', label: 'src/b.ts', type: 'service', weight: 1 },
                    ],
                    edges: [{ source: 'src/a.ts', target: 'src/b.ts', label: 'imports', isCircular: false }],
                },
            };

            render(
                <SigmaGraph
                    tour={tour}
                    currentStep={0}
                    onNodeClick={vi.fn()}
                    flows={[{
                        entryPoint: 'src/a.ts',
                        steps: [{ filePath: 'src/a.ts' }, { filePath: 'src/b.ts' }],
                        anomalies: [],
                    }]}
                />
            );

            await act(async () => {
                await Promise.resolve();
                await Promise.resolve();
            });

            let lastOverlayProps = flowOverlayMock.mock.calls.at(-1)?.[0] as { visible: boolean } | undefined;
            expect(lastOverlayProps).toEqual(expect.objectContaining({ visible: false }));

            await act(async () => {
                vi.runAllTimers();
            });

            lastOverlayProps = flowOverlayMock.mock.calls.at(-1)?.[0] as { visible: boolean } | undefined;
            expect(lastOverlayProps).toEqual(expect.objectContaining({ visible: true }));
        } finally {
            vi.useRealTimers();
        }
    });

    it('rebuilds edgeflow paths after the deferred initial layout completes when flow starts enabled', async () => {
        Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, value: 800 });
        Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, value: 600 });

        vi.useFakeTimers();
        try {
            let framedCoords = {
                'src/a.ts': { x: 0.1, y: 0.2 },
                'src/b.ts': { x: 0.3, y: 0.4 },
            };
            forceAtlasAssign.mockImplementationOnce(() => {
                framedCoords = {
                    'src/a.ts': { x: 0.2, y: 0.25 },
                    'src/b.ts': { x: 0.7, y: 0.8 },
                };
            });

            const tour: Tour = {
                id: 'tour-flow-initial-layout-refresh',
                query: 'demo',
                tourType: 'overview',
                createdAt: '2026-04-16T00:00:00.000Z',
                steps: [],
                analysisSnapshot: {
                    frameworks: [],
                    entryPoints: [],
                    totalFiles: 2,
                    totalEdges: 1,
                    circularCount: 0,
                },
                graph: {
                    nodes: [
                        { id: 'src/a.ts', label: 'src/a.ts', type: 'entry', weight: 1 },
                        { id: 'src/b.ts', label: 'src/b.ts', type: 'service', weight: 1 },
                    ],
                    edges: [{ source: 'src/a.ts', target: 'src/b.ts', label: 'imports', isCircular: false }],
                },
            };

            render(
                <SigmaGraph
                    tour={tour}
                    currentStep={0}
                    onNodeClick={vi.fn()}
                    flows={[{
                        entryPoint: 'src/a.ts',
                        steps: [{ filePath: 'src/a.ts' }, { filePath: 'src/b.ts' }],
                        anomalies: [],
                    }]}
                />
            );

            MockSigma.lastInstance?.getNodeDisplayData.mockImplementation((nodeId: string) => framedCoords[nodeId as 'src/a.ts' | 'src/b.ts']);

            await act(async () => {
                await Promise.resolve();
                await Promise.resolve();
            });

            expect(flowOverlaySetPathsMock).toHaveBeenLastCalledWith([[[10, 20], [30, 40]]]);

            await act(async () => {
                vi.runAllTimers();
                await Promise.resolve();
                await Promise.resolve();
            });

            expect(flowOverlaySetPathsMock).toHaveBeenLastCalledWith([[[20, 25], [70, 80]]]);
        } finally {
            vi.useRealTimers();
        }
    });

    it('renders the animated flow overlay by default without adding synthetic flow edges', async () => {
        Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, value: 800 });
        Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, value: 600 });

        vi.useFakeTimers();
        try {
            const tour: Tour = {
                id: 'tour-flow',
                query: 'demo',
                tourType: 'overview',
                createdAt: '2026-04-16T00:00:00.000Z',
                steps: [],
                analysisSnapshot: {
                    frameworks: [],
                    entryPoints: [],
                    totalFiles: 2,
                    totalEdges: 1,
                    circularCount: 0,
                },
                graph: {
                    nodes: [
                        { id: 'src/a.ts', label: 'src/a.ts', type: 'entry', weight: 1 },
                        { id: 'src/b.ts', label: 'src/b.ts', type: 'service', weight: 1 },
                    ],
                    edges: [{ source: 'src/a.ts', target: 'src/b.ts', label: 'imports', isCircular: false }],
                },
            };

            render(
                <SigmaGraph
                    tour={tour}
                    currentStep={0}
                    onNodeClick={vi.fn()}
                    flows={[{
                        entryPoint: 'src/a.ts',
                        steps: [{ filePath: 'src/a.ts' }, { filePath: 'src/b.ts' }],
                        anomalies: [],
                    }]}
                />
            );

            await act(async () => {
                await Promise.resolve();
                await Promise.resolve();
                vi.runAllTimers();
            });

            const lastOverlayProps = flowOverlayMock.mock.calls.at(-1)?.[0] as { visible: boolean } | undefined;
            expect(lastOverlayProps).toEqual(expect.objectContaining({ visible: true }));
            expect(flowOverlaySetPathsMock).toHaveBeenCalledWith([[[10, 20], [30, 40]]]);
            expect(MockGraph.lastInstance?.edges().some((key) => key.startsWith('flow:'))).toBe(false);
        } finally {
            vi.useRealTimers();
        }
    });

    it('does not rerender FlowOverlay or resync paths when afterRender fires with unchanged camera state', async () => {
        Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, value: 800 });
        Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, value: 600 });

        vi.useFakeTimers();
        try {
            const tour: Tour = {
                id: 'tour-flow-stable',
                query: 'demo',
                tourType: 'overview',
                createdAt: '2026-04-16T00:00:00.000Z',
                steps: [],
                analysisSnapshot: {
                    frameworks: [],
                    entryPoints: [],
                    totalFiles: 2,
                    totalEdges: 1,
                    circularCount: 0,
                },
                graph: {
                    nodes: [
                        { id: 'src/a.ts', label: 'src/a.ts', type: 'entry', weight: 1 },
                        { id: 'src/b.ts', label: 'src/b.ts', type: 'service', weight: 1 },
                    ],
                    edges: [{ source: 'src/a.ts', target: 'src/b.ts', label: 'imports', isCircular: false }],
                },
            };

            render(
                <SigmaGraph
                    tour={tour}
                    currentStep={0}
                    onNodeClick={vi.fn()}
                    flows={[{
                        entryPoint: 'src/a.ts',
                        steps: [{ filePath: 'src/a.ts' }, { filePath: 'src/b.ts' }],
                        anomalies: [],
                    }]}
                />
            );

            await act(async () => {
                await Promise.resolve();
                await Promise.resolve();
                vi.runAllTimers();
            });

            const lastOverlayProps = flowOverlayMock.mock.calls.at(-1)?.[0] as { visible: boolean } | undefined;
            expect(lastOverlayProps).toEqual(expect.objectContaining({ visible: true }));
            flowOverlaySetPathsMock.mockClear();

            await act(async () => {
                MockSigma.lastInstance?.emit('afterRender');
            });

            expect(flowOverlayMock.mock.calls.at(-1)?.[0]).toEqual(lastOverlayProps);
            expect(flowOverlaySetPathsMock).not.toHaveBeenCalled();
        } finally {
            vi.useRealTimers();
        }
    });

    it('recomputes viewport-space flow paths from Sigma framed coordinates when the camera changes', async () => {
        Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, value: 800 });
        Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, value: 600 });

        vi.useFakeTimers();
        try {

            const tour: Tour = {
                id: 'tour-flow-camera',
                query: 'demo',
                tourType: 'overview',
                createdAt: '2026-04-16T00:00:00.000Z',
                steps: [],
                analysisSnapshot: {
                    frameworks: [],
                    entryPoints: [],
                    totalFiles: 2,
                    totalEdges: 1,
                    circularCount: 0,
                },
                graph: {
                    nodes: [
                        { id: 'src/a.ts', label: 'src/a.ts', type: 'entry', weight: 1 },
                        { id: 'src/b.ts', label: 'src/b.ts', type: 'service', weight: 1 },
                    ],
                    edges: [{ source: 'src/a.ts', target: 'src/b.ts', label: 'imports', isCircular: false }],
                },
            };

            render(
                <SigmaGraph
                    tour={tour}
                    currentStep={0}
                    onNodeClick={vi.fn()}
                    flows={[{
                        entryPoint: 'src/a.ts',
                        steps: [{ filePath: 'src/a.ts' }, { filePath: 'src/b.ts' }],
                        anomalies: [],
                    }]}
                />
            );

            await act(async () => {
                vi.runAllTimers();
                await Promise.resolve();
                await Promise.resolve();
            });

            flowOverlaySetPathsMock.mockClear();
            if (MockSigma.lastInstance) MockSigma.lastInstance.cameraState = { x: 4, y: -2, ratio: 1.6, angle: 0.2 };

            await act(async () => {
                MockSigma.lastInstance?.emit('afterRender');
                await Promise.resolve();
            });

            expect(flowOverlaySetPathsMock).toHaveBeenCalledWith([[[20, 30], [52, 62]]]);
        } finally {
            vi.useRealTimers();
        }
    });

    it('does not rebuild the Sigma instance when flows arrive after the initial graph render', async () => {
        Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, value: 800 });
        Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, value: 600 });

        vi.useFakeTimers();
        try {
            const tour: Tour = {
                id: 'tour-flow-update',
                query: 'demo',
                tourType: 'overview',
                createdAt: '2026-04-16T00:00:00.000Z',
                steps: [],
                analysisSnapshot: {
                    frameworks: [],
                    entryPoints: [],
                    totalFiles: 2,
                    totalEdges: 1,
                    circularCount: 0,
                },
                graph: {
                    nodes: [
                        { id: 'src/a.ts', label: 'src/a.ts', type: 'entry', weight: 1 },
                        { id: 'src/b.ts', label: 'src/b.ts', type: 'service', weight: 1 },
                    ],
                    edges: [{ source: 'src/a.ts', target: 'src/b.ts', label: 'imports', isCircular: false }],
                },
            };

            const rendered = render(
                <SigmaGraph
                    tour={tour}
                    currentStep={0}
                    onNodeClick={vi.fn()}
                    flows={[]}
                />
            );

            await act(async () => {
                await Promise.resolve();
                vi.runAllTimers();
            });

            const originalSigma = MockSigma.lastInstance;
            expect(originalSigma).not.toBeNull();
            expect(originalSigma?.kill).not.toHaveBeenCalled();

            rendered.rerender(
                <SigmaGraph
                    tour={tour}
                    currentStep={0}
                    onNodeClick={vi.fn()}
                    flows={[{
                        entryPoint: 'src/a.ts',
                        steps: [{ filePath: 'src/a.ts' }, { filePath: 'src/b.ts' }],
                        anomalies: [],
                    }]}
                />
            );

            await act(async () => {
                await Promise.resolve();
                await Promise.resolve();
            });

            expect(MockSigma.lastInstance).toBe(originalSigma);
            expect(originalSigma?.kill).not.toHaveBeenCalled();
            expect(flowOverlaySetPathsMock).toHaveBeenCalled();
        } finally {
            vi.useRealTimers();
        }
    });

    it('keeps the dotted overlay active for dense flow sets at the default camera level', async () => {
        Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, value: 800 });
        Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, value: 600 });

        vi.useFakeTimers();
        try {

            const denseFlows = Array.from({ length: 140 }, () => ({
                entryPoint: 'src/a.ts',
                steps: [{ filePath: 'src/a.ts' }, { filePath: 'src/b.ts' }],
                anomalies: [],
            }));

            const tour: Tour = {
                id: 'tour-flow-dense',
                query: 'demo',
                tourType: 'overview',
                createdAt: '2026-04-16T00:00:00.000Z',
                steps: [],
                analysisSnapshot: {
                    frameworks: [],
                    entryPoints: [],
                    totalFiles: 2,
                    totalEdges: 1,
                    circularCount: 0,
                },
                graph: {
                    nodes: [
                        { id: 'src/a.ts', label: 'src/a.ts', type: 'entry', weight: 1 },
                        { id: 'src/b.ts', label: 'src/b.ts', type: 'service', weight: 1 },
                    ],
                    edges: [{ source: 'src/a.ts', target: 'src/b.ts', label: 'imports', isCircular: false }],
                },
            };

            render(
                <SigmaGraph
                    tour={tour}
                    currentStep={0}
                    onNodeClick={vi.fn()}
                    flows={denseFlows}
                />
            );

            await act(async () => {
                vi.runAllTimers();
                await Promise.resolve();
                await Promise.resolve();
            });

            const lastOverlayProps = flowOverlayMock.mock.calls.at(-1)?.[0] as { visible: boolean } | undefined;
            expect(lastOverlayProps).toEqual(expect.objectContaining({ visible: true }));
            expect(MockGraph.lastInstance?.edges().some((key) => key.startsWith('flow:'))).toBe(false);
        } finally {
            vi.useRealTimers();
        }
    });

    it('keeps the dotted overlay active for dense flow sets even at close zoom without rebuilding Sigma', async () => {
        Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, value: 800 });
        Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, value: 600 });

        vi.useFakeTimers();
        try {

            const denseFlows = Array.from({ length: 140 }, () => ({
                entryPoint: 'src/a.ts',
                steps: [{ filePath: 'src/a.ts' }, { filePath: 'src/b.ts' }],
                anomalies: [],
            }));

            const tour: Tour = {
                id: 'tour-flow-dense-zoom',
                query: 'demo',
                tourType: 'overview',
                createdAt: '2026-04-16T00:00:00.000Z',
                steps: [],
                analysisSnapshot: {
                    frameworks: [],
                    entryPoints: [],
                    totalFiles: 2,
                    totalEdges: 1,
                    circularCount: 0,
                },
                graph: {
                    nodes: [
                        { id: 'src/a.ts', label: 'src/a.ts', type: 'entry', weight: 1 },
                        { id: 'src/b.ts', label: 'src/b.ts', type: 'service', weight: 1 },
                    ],
                    edges: [{ source: 'src/a.ts', target: 'src/b.ts', label: 'imports', isCircular: false }],
                },
            };

            render(
                <SigmaGraph
                    tour={tour}
                    currentStep={0}
                    onNodeClick={vi.fn()}
                    flows={denseFlows}
                />
            );

            await act(async () => {
                vi.runAllTimers();
                await Promise.resolve();
                await Promise.resolve();
            });

            const originalSigma = MockSigma.lastInstance;
            expect(originalSigma).not.toBeNull();
            expect(MockGraph.lastInstance?.edges().some((key) => key.startsWith('flow:'))).toBe(false);

            if (MockSigma.lastInstance) MockSigma.lastInstance.cameraState = { x: 0, y: 0, ratio: 0.6, angle: 0 };

            await act(async () => {
                MockSigma.lastInstance?.emit('afterRender');
                await Promise.resolve();
            });

            const lastOverlayProps = flowOverlayMock.mock.calls.at(-1)?.[0] as { visible: boolean } | undefined;
            expect(lastOverlayProps).toEqual(expect.objectContaining({ visible: true }));
            expect(MockGraph.lastInstance?.edges().some((key) => key.startsWith('flow:'))).toBe(false);
            expect(MockSigma.lastInstance).toBe(originalSigma);
            expect(originalSigma?.kill).not.toHaveBeenCalled();

            if (MockSigma.lastInstance) MockSigma.lastInstance.cameraState = { x: 0, y: 0, ratio: 1, angle: 0 };

            await act(async () => {
                MockSigma.lastInstance?.emit('afterRender');
                await Promise.resolve();
                await Promise.resolve();
            });

            const restoredOverlayProps = flowOverlayMock.mock.calls.at(-1)?.[0] as { visible: boolean } | undefined;
            expect(restoredOverlayProps).toEqual(expect.objectContaining({ visible: true }));
            expect(MockGraph.lastInstance?.edges().some((key) => key.startsWith('flow:'))).toBe(false);
            expect(MockSigma.lastInstance).toBe(originalSigma);
            expect(originalSigma?.kill).not.toHaveBeenCalled();
        } finally {
            vi.useRealTimers();
        }
    });

    it('keeps full flow paths visible when selecting a node on the flow', async () => {
        Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, value: 800 });
        Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, value: 600 });

        vi.useFakeTimers();
        try {

            const tour: Tour = {
                id: 'tour-flow-selected-node',
                query: 'demo',
                tourType: 'overview',
                createdAt: '2026-04-16T00:00:00.000Z',
                steps: [],
                analysisSnapshot: {
                    frameworks: [],
                    entryPoints: [],
                    totalFiles: 3,
                    totalEdges: 2,
                    circularCount: 0,
                },
                graph: {
                    nodes: [
                        { id: 'src/a.ts', label: 'src/a.ts', type: 'entry', weight: 1 },
                        { id: 'src/b.ts', label: 'src/b.ts', type: 'service', weight: 1 },
                        { id: 'src/c.ts', label: 'src/c.ts', type: 'service', weight: 1 },
                    ],
                    edges: [
                        { source: 'src/a.ts', target: 'src/b.ts', label: 'imports', isCircular: false },
                        { source: 'src/b.ts', target: 'src/c.ts', label: 'imports', isCircular: false },
                    ],
                },
            };

            render(
                <SigmaGraph
                    tour={tour}
                    currentStep={0}
                    onNodeClick={vi.fn()}
                    flows={[{
                        entryPoint: 'src/a.ts',
                        steps: [
                            { filePath: 'src/a.ts' },
                            { filePath: 'src/b.ts' },
                            { filePath: 'src/c.ts' },
                        ],
                        anomalies: [],
                    }]}
                />
            );

            await act(async () => {
                vi.runAllTimers();
                await Promise.resolve();
                await Promise.resolve();
            });

            flowOverlaySetPathsMock.mockClear();
            const callbacks = getLastSigmaEventCallbacks() as { setSelectedNodeId?: (value: string | null) => void } | null;

            await act(async () => {
                callbacks?.setSelectedNodeId?.('src/b.ts');
                await Promise.resolve();
            });

            expect(MockGraph.lastInstance?.edges().some((key) => key.startsWith('flow:'))).toBe(false);
            expect(flowOverlaySetPathsMock).not.toHaveBeenCalledWith([]);
            const lastOverlayProps = flowOverlayMock.mock.calls.at(-1)?.[0] as { visible: boolean } | undefined;
            expect(lastOverlayProps).toEqual(expect.objectContaining({ visible: true }));
        } finally {
            vi.useRealTimers();
        }
    });

    it('hides unrelated edges when the legend subfilter is active', async () => {
        Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, value: 800 });
        Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, value: 600 });

        const tour: Tour = {
            id: 'tour-legend-subfilter',
            query: 'demo',
            tourType: 'overview',
            createdAt: '2026-04-16T00:00:00.000Z',
            steps: [],
            analysisSnapshot: {
                frameworks: [],
                entryPoints: [],
                totalFiles: 4,
                totalEdges: 2,
                circularCount: 0,
            },
            graph: {
                nodes: [
                    { id: 'src/selected.ts', label: 'src/selected.ts', type: 'entry', weight: 1 },
                    { id: 'src/upstream.ts', label: 'src/upstream.ts', type: 'service', weight: 1 },
                    { id: 'src/unrelated-a.ts', label: 'src/unrelated-a.ts', type: 'service', weight: 1 },
                    { id: 'src/unrelated-b.ts', label: 'src/unrelated-b.ts', type: 'service', weight: 1 },
                ],
                edges: [
                    { source: 'src/upstream.ts', target: 'src/selected.ts', label: 'imports', isCircular: false },
                    { source: 'src/unrelated-a.ts', target: 'src/unrelated-b.ts', label: 'imports', isCircular: false },
                ],
            },
        };

        render(
            <SigmaGraph
                tour={tour}
                currentStep={0}
                onNodeClick={vi.fn()}
                workspaceMode="analyst"
            />
        );

        await act(async () => {
            await Promise.resolve();
        });

        const callbacks = getLastSigmaEventCallbacks() as { setSelectedNodeId?: (value: string | null) => void } | null;
        await act(async () => {
            callbacks?.setSelectedNodeId?.('src/selected.ts');
        });

        await act(async () => {
            fireEvent.click(screen.getByTestId('legend-upstream'));
        });

        const edgeReducerCalls = sigmaSetSettingMock.mock.calls.filter(([setting]) => setting === 'edgeReducer');
        const edgeReducer = edgeReducerCalls.at(-1)?.[1] as ((edge: string, data: Record<string, unknown>) => Record<string, unknown>) | undefined;
        expect(edgeReducer).toBeDefined();

        const unrelatedEdgeResult = edgeReducer?.('src/unrelated-a.ts→src/unrelated-b.ts', { isCircular: false, isCoupling: false });
        expect(unrelatedEdgeResult).toEqual(expect.objectContaining({ hidden: true }));
    });

    it('does not defer the Tests filter behind a timeout', async () => {
        Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, value: 800 });
        Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, value: 600 });

        const tour: Tour = {
            id: 'tour-1',
            query: 'demo',
            tourType: 'overview',
            createdAt: '2026-04-16T00:00:00.000Z',
            steps: [],
            analysisSnapshot: {
                frameworks: [],
                entryPoints: [],
                totalFiles: 2,
                totalEdges: 1,
                circularCount: 0,
            },
            graph: {
                nodes: [
                    { id: 'src/app.ts', label: 'src/app.ts', type: 'entry', weight: 1 },
                    { id: 'src/app.test.ts', label: 'src/app.test.ts', type: 'test', weight: 1 },
                ],
                edges: [{ source: 'src/app.ts', target: 'src/app.test.ts', label: 'imports', isCircular: false }],
            },
        };

        render(
            <SigmaGraph
                tour={tour}
                currentStep={0}
                onNodeClick={vi.fn()}
                workspaceMode="analyst"
            />
        );

        await act(async () => {
            await Promise.resolve();
        });

        const timeoutSpy = vi.spyOn(window, 'setTimeout');
        try {
            await act(async () => {
                fireEvent.click(screen.getByTestId('toggle-test-files'));
                await Promise.resolve();
            });

            expect(timeoutSpy).not.toHaveBeenCalled();
        } finally {
            timeoutSpy.mockRestore();
        }
    });

    it('clears Flow edges when Circular only is enabled', async () => {
        Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, value: 800 });
        Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, value: 600 });

        const tour: Tour = {
            id: 'tour-circular-reset',
            query: 'demo',
            tourType: 'overview',
            createdAt: '2026-04-16T00:00:00.000Z',
            steps: [],
            analysisSnapshot: {
                frameworks: [],
                entryPoints: [],
                totalFiles: 2,
                totalEdges: 2,
                circularCount: 1,
            },
            graph: {
                nodes: [
                    { id: 'src/a.ts', label: 'src/a.ts', type: 'entry', weight: 1 },
                    { id: 'src/b.ts', label: 'src/b.ts', type: 'service', weight: 1 },
                ],
                edges: [
                    { source: 'src/a.ts', target: 'src/b.ts', label: 'imports', isCircular: true },
                    { source: 'src/b.ts', target: 'src/a.ts', label: 'imports', isCircular: true },
                ],
            },
        };

        render(
            <SigmaGraph
                tour={tour}
                currentStep={0}
                onNodeClick={vi.fn()}
            />
        );

        await act(async () => {
            fireEvent.click(screen.getByTestId('toggle-circular-only'));
            await Promise.resolve();
        });

        expect(screen.getByTestId('flow-edge-state')).toHaveTextContent('false');
    });
});
