import { useEffect, useMemo, useRef } from 'react';
import type { MutableRefObject } from 'react';
import type Graph from 'graphology';
import type Sigma from 'sigma';
import type { FlowOverlayHandle } from './FlowOverlay';
import { buildFlowPaths, flowPathsEqual } from './sigmaFlowPaths';
import { resolveFlowNodeId } from './sigmaEdgeRenderers';
import type { FlowSequence } from '../types';

type CameraState = { x: number; y: number; ratio: number; angle: number };

/** Parameters required to synchronize the imperative flow overlay with Sigma. */
export interface UseSigmaFlowOverlayParams {
    sigmaRef: MutableRefObject<Sigma | null>;
    graphRef: MutableRefObject<Graph | null>;
    flowFileToDisplayNodeRef: MutableRefObject<Map<string, string>>;
    flows: FlowSequence[];
    isGraphSurfaceVisible: boolean;
    showFlowEdges: boolean;
    sigmaEpoch: number;
    overlayInvalidationKey: string;
}

/** Result exposed back to SigmaGraph for rendering the overlay and its visibility. */
export interface UseSigmaFlowOverlayResult {
    flowOverlayRef: MutableRefObject<FlowOverlayHandle | null>;
    flowPathCount: number;
}

// Compare projected camera state so the overlay only rebuilds on real viewport changes.
function hasSameCameraState(left: CameraState | null, right: CameraState): boolean {
    return left !== null
        && left.x === right.x
        && left.y === right.y
        && left.ratio === right.ratio
        && left.angle === right.angle;
}

/** Keeps the imperative flow overlay synchronized with the live Sigma viewport. */
export function useSigmaFlowOverlay({
    sigmaRef,
    graphRef,
    flowFileToDisplayNodeRef,
    flows,
    isGraphSurfaceVisible,
    showFlowEdges,
    sigmaEpoch,
    overlayInvalidationKey,
}: UseSigmaFlowOverlayParams): UseSigmaFlowOverlayResult {
    const flowPathsRef = useRef<number[][][]>([]);
    const flowOverlayRef = useRef<FlowOverlayHandle | null>(null);
    const overlayCameraStateRef = useRef<CameraState | null>(null);
    const overlayDirtyRef = useRef(true);
    const flowPathCount = useMemo(
        () => flows.reduce((count, sequence) => count + Math.max(sequence.steps.length - 1, 0), 0),
        [flows],
    );

    useEffect(() => {
        const sigma = sigmaRef.current;
        const shouldTrackFlowRendering = Boolean(sigma)
            && isGraphSurfaceVisible
            && flows.length > 0;
        if (!sigma || !shouldTrackFlowRendering) {
            flowPathsRef.current = [];
            overlayCameraStateRef.current = null;
            overlayDirtyRef.current = true;
            flowOverlayRef.current?.clear();
            return;
        }

        const normalizedNodeId = new Map<string, string>();
        graphRef.current?.forEachNode((id) => {
            normalizedNodeId.set(id.replace(/\\/g, '/').replace(/^\.\//, ''), id);
        });

        const resolvedFlows: FlowSequence[] = flows.map((sequence) => ({
            ...sequence,
            steps: sequence.steps.map((step) => {
                const resolved = resolveFlowNodeId(step.filePath, normalizedNodeId, flowFileToDisplayNodeRef.current);
                return resolved ? { ...step, filePath: resolved } : step;
            }),
        }));

        overlayDirtyRef.current = true;

        // Read the active camera projection from Sigma, supporting both mock and runtime cameras.
        const readCameraState = (): CameraState => {
            const camera = sigma.getCamera() as {
                getState?: () => CameraState;
                x?: number;
                y?: number;
                ratio?: number;
                angle?: number;
            };
            if (typeof camera.getState === 'function') return camera.getState();
            return {
                x: camera.x ?? 0,
                y: camera.y ?? 0,
                ratio: camera.ratio ?? 1,
                angle: camera.angle ?? 0,
            };
        };

        const update = () => {
            const cameraState = readCameraState();
            if (!showFlowEdges) {
                overlayCameraStateRef.current = cameraState;
                overlayDirtyRef.current = false;
                return;
            }

            const cameraChanged = !hasSameCameraState(overlayCameraStateRef.current, cameraState);
            if (!overlayDirtyRef.current && !cameraChanged) return;

            const viewportNodeCoords = new Map<string, { x: number; y: number } | undefined>();
            const paths = buildFlowPaths(resolvedFlows, (id) => {
                if (viewportNodeCoords.has(id)) return viewportNodeCoords.get(id);
                try {
                    const data = sigma.getNodeDisplayData(id);
                    if (!data) {
                        viewportNodeCoords.set(id, undefined);
                        return undefined;
                    }

                    const viewportPoint = sigma.framedGraphToViewport(data);
                    viewportNodeCoords.set(id, viewportPoint);
                    return viewportPoint;
                } catch {
                    viewportNodeCoords.set(id, undefined);
                    return undefined;
                }
            });

            if (flowPathsEqual(flowPathsRef.current, paths)) {
                overlayCameraStateRef.current = cameraState;
                if (overlayDirtyRef.current && flowOverlayRef.current !== null && paths.length > 0) {
                    flowOverlayRef.current.setPaths(paths);
                    overlayDirtyRef.current = false;
                    return;
                }

                overlayDirtyRef.current = flowOverlayRef.current === null && paths.length > 0;
                return;
            }

            flowPathsRef.current = paths;
            overlayCameraStateRef.current = cameraState;
            if (flowOverlayRef.current === null) {
                overlayDirtyRef.current = paths.length > 0;
                return;
            }

            overlayDirtyRef.current = false;
            flowOverlayRef.current.setPaths(paths);
        };

        sigma.on('afterRender', update);
        update();
        return () => {
            sigma.off('afterRender', update);
        };
    }, [flows, flowPathCount, graphRef, flowFileToDisplayNodeRef, isGraphSurfaceVisible, overlayInvalidationKey, showFlowEdges, sigmaEpoch, sigmaRef]);

    return { flowOverlayRef, flowPathCount };
}