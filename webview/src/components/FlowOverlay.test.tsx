/** @vitest-environment jsdom */

/**
 * FlowOverlay tests — canvas-backed dashed overlay.
 */
import { act, cleanup, render } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FlowOverlay, type FlowOverlayHandle } from './FlowOverlay';

const POINT_ZERO = 0;
const POINT_FIVE = 5;
const POINT_TEN = 10;
const POINT_FIFTEEN = 15;

const START_POINT = [POINT_ZERO, POINT_ZERO] as const;
const MID_POINT = [POINT_FIVE, POINT_FIVE] as const;
const END_POINT = [POINT_TEN, POINT_TEN] as const;
const OFFSET_END_POINT = [POINT_FIFTEEN, POINT_FIFTEEN] as const;

const clearRect = vi.fn();
const beginPath = vi.fn();
const moveTo = vi.fn();
const lineTo = vi.fn();
const stroke = vi.fn();
const setLineDash = vi.fn();
let lineDashOffset = 0;
let queuedAnimationFrame: FrameRequestCallback | null = null;
const requestAnimationFrameMock = vi.fn((callback: FrameRequestCallback) => {
    queuedAnimationFrame = callback;
    return 1;
});
const cancelAnimationFrameMock = vi.fn();

beforeEach(() => {
    clearRect.mockClear();
    beginPath.mockClear();
    moveTo.mockClear();
    lineTo.mockClear();
    stroke.mockClear();
    setLineDash.mockClear();
    lineDashOffset = 0;
    queuedAnimationFrame = null;
    requestAnimationFrameMock.mockClear();
    cancelAnimationFrameMock.mockClear();
    vi.stubGlobal('requestAnimationFrame', requestAnimationFrameMock);
    vi.stubGlobal('cancelAnimationFrame', cancelAnimationFrameMock);
    Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
        configurable: true,
        value: vi.fn(() => ({
            clearRect,
            beginPath,
            moveTo,
            lineTo,
            stroke,
            setLineDash,
            lineWidth: 0,
            strokeStyle: '',
            lineCap: 'round',
            get lineDashOffset() {
                return lineDashOffset;
            },
            set lineDashOffset(value: number) {
                lineDashOffset = value;
            },
        })),
    });
});

afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
});

describe('FlowOverlay — canvas dashed overlay', () => {
    it('draws one dashed segment per path on the canvas context', () => {
        const paths = [[START_POINT, END_POINT], [MID_POINT, OFFSET_END_POINT]];
        const overlayRef = React.createRef<FlowOverlayHandle>();
        render(<FlowOverlay ref={overlayRef} visible={true} />);
        act(() => {
            overlayRef.current?.setPaths(paths);
        });
        expect(setLineDash).toHaveBeenCalled();
        expect(moveTo).toHaveBeenCalledTimes(2);
        expect(lineTo).toHaveBeenCalledTimes(2);
        expect(stroke).toHaveBeenCalledTimes(2);
    });

    it('canvas container has pointer-events:none', () => {
        const { container: c } = render(<FlowOverlay visible={true} />);
        const canvas = c.querySelector('canvas')!;
        expect(canvas).toBeTruthy();
        const style = canvas.getAttribute('style') ?? '';
        expect(style).toContain('pointer-events');
        expect(style).toContain('none');
        expect(style).toContain('overflow: hidden');
    });

    it('keeps the canvas mounted and hides it with CSS visibility when visible=false', () => {
        const overlayRef = React.createRef<FlowOverlayHandle>();
        const { container: c, rerender } = render(<FlowOverlay ref={overlayRef} visible={true} />);

        act(() => {
            overlayRef.current?.setPaths([[START_POINT, END_POINT]]);
        });

        const initialCanvas = c.querySelector('canvas');
        expect(initialCanvas).not.toBeNull();

        rerender(<FlowOverlay ref={overlayRef} visible={false} />);

        const hiddenCanvas = c.querySelector('canvas');
        expect(hiddenCanvas).toBe(initialCanvas);
        expect(hiddenCanvas?.getAttribute('style') ?? '').toContain('visibility: hidden');
    });

    it('clears the canvas without remounting the overlay', () => {
        const overlayRef = React.createRef<FlowOverlayHandle>();
        const { container: c } = render(<FlowOverlay ref={overlayRef} visible={true} />);

        act(() => {
            overlayRef.current?.setPaths([[START_POINT, END_POINT]]);
        });
        const canvas = c.querySelector('canvas');
        expect(canvas).not.toBeNull();

        act(() => {
            overlayRef.current?.clear();
        });
        expect(c.querySelector('canvas')).toBe(canvas);
        expect(clearRect).toHaveBeenCalled();
    });

    it('starts animating when paths arrive after becoming visible from an initially hidden mount', () => {
        const overlayRef = React.createRef<FlowOverlayHandle>();
        const { rerender } = render(<FlowOverlay ref={overlayRef} visible={false} />);

        rerender(<FlowOverlay ref={overlayRef} visible={true} />);

        act(() => {
            overlayRef.current?.setPaths([[START_POINT, END_POINT]]);
        });

        expect(requestAnimationFrameMock).toHaveBeenCalledTimes(1);
        expect(queuedAnimationFrame).not.toBeNull();
    });

    it('advances the dashed flow animation at a balanced speed', () => {
        const overlayRef = React.createRef<FlowOverlayHandle>();
        render(<FlowOverlay ref={overlayRef} visible={true} />);

        act(() => {
            overlayRef.current?.setPaths([[START_POINT, END_POINT]]);
        });

        const frame = queuedAnimationFrame;
        expect(frame).not.toBeNull();

        act(() => {
            frame?.(16);
        });

        expect(lineDashOffset).toBe(-0.35);
    });
});
