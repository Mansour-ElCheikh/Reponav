/**
 * FlowOverlay renders an absolutely-positioned canvas layer over the Sigma graph surface.
 * Each entry in `paths` is a polyline drawn as consecutive [x, y] pairs in Sigma
 * viewport coordinates. The overlay stays mounted and redraws imperatively so zoom,
 * pan, and selection never force React through a heavy DOM polyline diff.
 */
import React, { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';

/** A single polyline expressed as an ordered list of [x, y] viewport coordinates. */
export type FlowPath = ReadonlyArray<readonly [number, number] | number[]>;

/** Imperative API used by SigmaGraph to update overlay paths without React state churn. */
export interface FlowOverlayHandle {
    setPaths: (paths: FlowPath[]) => void;
    clear: () => void;
}

interface FlowOverlayProps {
    /** When false the canvas stays mounted but is hidden with CSS visibility. */
    visible: boolean;
}

const FLOW_COLOR = '#3b82f6';    // blue-500
const DASH_WIDTH = 2;
const GAP_WIDTH = 6;
const DASH_PERIOD = DASH_WIDTH + GAP_WIDTH;
const DASH_SPEED = 0.35;

function resizeCanvas(canvas: HTMLCanvasElement, context: CanvasRenderingContext2D): void {
    const devicePixelRatio = window.devicePixelRatio || 1;
    const width = canvas.clientWidth || canvas.width || 1;
    const height = canvas.clientHeight || canvas.height || 1;
    const targetWidth = Math.max(1, Math.round(width * devicePixelRatio));
    const targetHeight = Math.max(1, Math.round(height * devicePixelRatio));

    if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
        canvas.width = targetWidth;
        canvas.height = targetHeight;
    }

    if (typeof context.setTransform === 'function') {
        context.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    }
}

// Draw the current flow paths onto a single canvas to avoid SVG polyline churn.
function drawPaths(
    canvas: HTMLCanvasElement,
    paths: readonly FlowPath[],
    dashOffset: number,
): void {
    const context = canvas.getContext('2d');
    if (!context) return;

    resizeCanvas(canvas, context);
    context.clearRect(0, 0, canvas.width, canvas.height);
    if (paths.length === 0) return;

    context.setLineDash([DASH_WIDTH, GAP_WIDTH]);
    context.lineDashOffset = -dashOffset;
    context.strokeStyle = FLOW_COLOR;
    context.lineWidth = 2;
    context.lineCap = 'round';

    for (const path of paths) {
        if (path.length < 2) continue;
        context.beginPath();
        const [startX, startY] = path[0];
        context.moveTo(startX, startY);
        for (let index = 1; index < path.length; index++) {
            const [x, y] = path[index];
            context.lineTo(x, y);
        }
        context.stroke();
    }
}

/**
 * FlowOverlay — clipped canvas overlay rendered on top of the Sigma surface.
 * SigmaGraph drives it imperatively to avoid React re-renders on camera movement.
 */
export const FlowOverlay = forwardRef<FlowOverlayHandle, FlowOverlayProps>(function FlowOverlay({ visible }, ref): React.ReactElement | null {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const latestPathsRef = useRef<FlowPath[]>([]);
    const animationFrameRef = useRef<number | null>(null);
    const dashOffsetRef = useRef(0);
    const visibleRef = useRef(visible);
    visibleRef.current = visible;

    // Redraw synchronously after path updates and on each animation frame.
    const redraw = () => {
        if (!canvasRef.current) return;
        drawPaths(canvasRef.current, latestPathsRef.current, dashOffsetRef.current);
    };

    // Keep a lightweight animation loop inside the canvas instead of relying on DOM SVG animation.
    const ensureAnimation = () => {
        if (animationFrameRef.current !== null || !visibleRef.current || latestPathsRef.current.length === 0) return;
        const tick = () => {
            dashOffsetRef.current = (dashOffsetRef.current + DASH_SPEED) % DASH_PERIOD;
            redraw();
            animationFrameRef.current = window.requestAnimationFrame(tick);
        };
        animationFrameRef.current = window.requestAnimationFrame(tick);
    };

    const stopAnimation = () => {
        if (animationFrameRef.current !== null) {
            window.cancelAnimationFrame(animationFrameRef.current);
            animationFrameRef.current = null;
        }
    };

    useImperativeHandle(ref, () => ({
        setPaths(paths: FlowPath[]) {
            latestPathsRef.current = paths;
            redraw();
            ensureAnimation();
        },
        clear() {
            latestPathsRef.current = [];
            stopAnimation();
            redraw();
        },
    }), []);

    useEffect(() => {
        redraw();
        if (visible) ensureAnimation();
        else stopAnimation();
    }, [visible]);

    useEffect(() => () => stopAnimation(), []);

    return (
        <canvas
            data-testid="flow-overlay"
            ref={canvasRef}
            style={{
                position: 'absolute',
                inset: 0,
                width: '100%',
                height: '100%',
                pointerEvents: 'none',
                overflow: 'hidden',
                visibility: visible ? 'visible' : 'hidden',
                zIndex: 10,
            }}
        />
    );
});
