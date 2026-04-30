/** @vitest-environment jsdom */

import React, { useEffect } from 'react';
import { act, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type Graph from 'graphology';
import type Sigma from 'sigma';
import type { FlowOverlayHandle } from './FlowOverlay';
import type { FlowSequence } from '../types';
import { useSigmaFlowOverlay } from './useSigmaFlowOverlay';

interface HarnessProps {
    sigmaRef: React.MutableRefObject<Sigma | null>;
    graphRef: React.MutableRefObject<Graph | null>;
    flowFileToDisplayNodeRef: React.MutableRefObject<Map<string, string>>;
    flows: FlowSequence[];
    isGraphSurfaceVisible: boolean;
    showFlowEdges: boolean;
    sigmaEpoch: number;
    overlayInvalidationKey: string;
    onReady: (handle: {
        flowOverlayRef: React.MutableRefObject<FlowOverlayHandle | null>;
        flowPathCount: number;
    }) => void;
}

function HookHarness({
    sigmaRef,
    graphRef,
    flowFileToDisplayNodeRef,
    flows,
    isGraphSurfaceVisible,
    showFlowEdges,
    sigmaEpoch,
    overlayInvalidationKey,
    onReady,
}: HarnessProps) {
    const handle = useSigmaFlowOverlay({
        sigmaRef,
        graphRef,
        flowFileToDisplayNodeRef,
        flows,
        isGraphSurfaceVisible,
        showFlowEdges,
        sigmaEpoch,
        overlayInvalidationKey,
    });

    useEffect(() => {
        onReady(handle);
    }, [handle, onReady]);

    return null;
}

afterEach(() => {
    vi.clearAllMocks();
});

describe('useSigmaFlowOverlay', () => {
    it('synchronizes viewport-space flow paths to the overlay and recomputes on camera changes', async () => {
        const on = vi.fn();
        const off = vi.fn();
        const getNodeDisplayData = vi.fn((nodeId: string) => {
            if (nodeId === 'src/a.ts') return { x: 0.1, y: 0.2 };
            if (nodeId === 'src/b.ts') return { x: 0.3, y: 0.4 };
            return null;
        });

        const cameraState = { x: 0, y: 0, ratio: 1, angle: 0 };
        const sigmaRef = {
            current: {
                on,
                off,
                getNodeDisplayData,
                framedGraphToViewport: vi.fn((point: { x: number; y: number }) => ({
                    x: point.x * 100 * cameraState.ratio + cameraState.x,
                    y: point.y * 100 * cameraState.ratio + cameraState.y,
                })),
                getCamera: vi.fn(() => ({ getState: () => ({ ...cameraState }) })),
            } as unknown as Sigma,
        };

        const graphRef = {
            current: {
                forEachNode: (callback: (id: string) => void) => {
                    callback('src/a.ts');
                    callback('src/b.ts');
                },
            } as unknown as Graph,
        };
        const flowFileToDisplayNodeRef = { current: new Map<string, string>() };
        const setPaths = vi.fn();
        const clear = vi.fn();
        let handle: { flowOverlayRef: React.MutableRefObject<FlowOverlayHandle | null>; flowPathCount: number } | null = null;

        render(
            <HookHarness
                sigmaRef={sigmaRef}
                graphRef={graphRef}
                flowFileToDisplayNodeRef={flowFileToDisplayNodeRef}
                flows={[{
                    entryPoint: 'src/a.ts',
                    steps: [{ filePath: 'src/a.ts' }, { filePath: 'src/b.ts' }],
                    anomalies: [],
                }]}
                isGraphSurfaceVisible={true}
                showFlowEdges={true}
                sigmaEpoch={1}
                overlayInvalidationKey="false:"
                onReady={(next) => {
                    handle = next;
                }}
            />
        );

        expect(handle?.flowPathCount).toBe(1);
        handle!.flowOverlayRef.current = { setPaths, clear };

        const update = on.mock.calls.find(([event]) => event === 'afterRender')?.[1] as (() => void) | undefined;
        expect(update).toBeDefined();

        await act(async () => {
            update?.();
            await Promise.resolve();
        });

        expect(setPaths).toHaveBeenCalledWith([[[10, 20], [30, 40]]]);

        cameraState.x = 4;
        cameraState.y = -2;
        cameraState.ratio = 1.6;
        await act(async () => {
            update?.();
            await Promise.resolve();
        });

        expect(setPaths).toHaveBeenLastCalledWith([[[20, 30], [52, 62]]]);
        expect(clear).not.toHaveBeenCalled();
    });

    it('clears the overlay when flow tracking is disabled and unregisters the listener on cleanup', async () => {
        const on = vi.fn();
        const off = vi.fn();
        const sigmaRef = {
            current: {
                on,
                off,
                getNodeDisplayData: vi.fn((nodeId: string) => {
                    if (nodeId === 'src/a.ts') return { x: 0.1, y: 0.2 };
                    if (nodeId === 'src/b.ts') return { x: 0.3, y: 0.4 };
                    return null;
                }),
                framedGraphToViewport: vi.fn((point: { x: number; y: number }) => point),
                getCamera: vi.fn(() => ({ getState: () => ({ x: 0, y: 0, ratio: 1, angle: 0 }) })),
            } as unknown as Sigma,
        };

        const graphRef = {
            current: {
                forEachNode: (callback: (id: string) => void) => {
                    callback('src/a.ts');
                    callback('src/b.ts');
                },
            } as unknown as Graph,
        };
        const flowFileToDisplayNodeRef = { current: new Map<string, string>() };
        const setPaths = vi.fn();
        const clear = vi.fn();
        let handle: { flowOverlayRef: React.MutableRefObject<FlowOverlayHandle | null>; flowPathCount: number } | null = null;

        const rendered = render(
            <HookHarness
                sigmaRef={sigmaRef}
                graphRef={graphRef}
                flowFileToDisplayNodeRef={flowFileToDisplayNodeRef}
                flows={[{
                    entryPoint: 'src/a.ts',
                    steps: [{ filePath: 'src/a.ts' }, { filePath: 'src/b.ts' }],
                    anomalies: [],
                }]}
                isGraphSurfaceVisible={true}
                showFlowEdges={true}
                sigmaEpoch={1}
                overlayInvalidationKey="false:"
                onReady={(next) => {
                    handle = next;
                }}
            />
        );

        handle!.flowOverlayRef.current = { setPaths, clear };

        await act(async () => {
            rendered.rerender(
                <HookHarness
                    sigmaRef={sigmaRef}
                    graphRef={graphRef}
                    flowFileToDisplayNodeRef={flowFileToDisplayNodeRef}
                    flows={[{
                        entryPoint: 'src/a.ts',
                        steps: [{ filePath: 'src/a.ts' }, { filePath: 'src/b.ts' }],
                        anomalies: [],
                    }]}
                    isGraphSurfaceVisible={false}
                    showFlowEdges={true}
                    sigmaEpoch={1}
                    overlayInvalidationKey="false:"
                    onReady={(next) => {
                        handle = next;
                    }}
                />
            );
            await Promise.resolve();
        });

        expect(clear).toHaveBeenCalled();

        rendered.unmount();
        const update = on.mock.calls.find(([event]) => event === 'afterRender')?.[1];
        expect(off).toHaveBeenCalledWith('afterRender', update);
    });
});