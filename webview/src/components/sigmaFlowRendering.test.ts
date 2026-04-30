import { describe, expect, it } from 'vitest';
import {
    getDefaultFlowRenderingStrategy,
    shouldRenderAnimatedFlowOverlay,
} from './sigmaFlowRendering';

describe('sigmaFlowRendering — acceptance: default renderer path', () => {
    it('defaults to animated overlay rendering so flow edges retain the dotted effect', () => {
        expect(getDefaultFlowRenderingStrategy()).toBe('canvas-plus-overlay');
    });

    it('does not render the animated overlay when flow edges are hidden', () => {
        expect(shouldRenderAnimatedFlowOverlay('canvas-plus-overlay', false, 2)).toBe(false);
    });

    it('renders the animated overlay when enabled and paths exist', () => {
        expect(shouldRenderAnimatedFlowOverlay('canvas-plus-overlay', true, 2)).toBe(true);
        expect(shouldRenderAnimatedFlowOverlay('canvas-plus-overlay', true, 0)).toBe(false);
    });

    it('keeps the dotted overlay active regardless of path count', () => {
        expect(shouldRenderAnimatedFlowOverlay('canvas-plus-overlay', true, 12)).toBe(true);
        expect(shouldRenderAnimatedFlowOverlay('canvas-plus-overlay', true, 200)).toBe(true);
    });
});
