import { describe, expect, it } from 'vitest';
import { SAMPLE_TOUR } from './sampleTour';

const UI_STEP_ORDER = 4;
const BRIDGE_STEP_ORDER = 3;
const WEBVIEW_PROVIDER_START = 100;
const WEBVIEW_PROVIDER_END = 200;
const SHARED_TYPES_START = 92;
const SHARED_TYPES_END = 111;

describe('SAMPLE_TOUR', () => {
    it('keeps a stable demo identity and overview shape', () => {
        expect(SAMPLE_TOUR.id).toBe('sample-reponav-overview');
        expect(SAMPLE_TOUR.tourType).toBe('overview');
        expect(SAMPLE_TOUR.steps.length).toBeGreaterThan(0);
        expect(SAMPLE_TOUR.graph.nodes.length).toBeGreaterThan(0);
    });

    it('describes the shipped Sigma graph UI in the sample copy', () => {
        const uiStep = SAMPLE_TOUR.steps.find((step) => step.order === UI_STEP_ORDER);
        const nodeIds = SAMPLE_TOUR.graph.nodes.map((node) => node.id);

        expect(uiStep?.what_it_does).toContain('Sigma');
        expect(uiStep?.what_it_does).not.toContain('ReactFlow');
        expect(nodeIds).toContain('webview/src/components/SigmaGraph.tsx');
        expect(nodeIds).not.toContain('webview/src/components/TourGraph.tsx');
        expect(nodeIds).toContain('src/services/tours/TourSerializer.ts');
        expect(nodeIds).not.toContain('src/tours/TourSerializer.ts');
    });

    it('keeps the webview bridge highlights aligned to the current sample references', () => {
        const bridgeStep = SAMPLE_TOUR.steps.find((step) => step.order === BRIDGE_STEP_ORDER);

        expect(bridgeStep?.highlights).toEqual([
            { file: 'src/webview/webviewProvider.ts', lines: [WEBVIEW_PROVIDER_START, WEBVIEW_PROVIDER_END] },
            { file: 'shared/types.ts', lines: [SHARED_TYPES_START, SHARED_TYPES_END] },
        ]);
    });

    it('uses strictly increasing step orders', () => {
        expect(SAMPLE_TOUR.steps.map((step) => step.order)).toEqual([0, 1, 2, BRIDGE_STEP_ORDER, UI_STEP_ORDER]);
    });

    it('references only graph nodes that exist in the sample graph', () => {
        const nodeIds = new Set(SAMPLE_TOUR.graph.nodes.map((node) => node.id));

        for (const step of SAMPLE_TOUR.steps) {
            for (const file of step.files) {
                expect(nodeIds.has(file)).toBe(true);
            }
            for (const highlight of step.highlights) {
                expect(nodeIds.has(highlight.file)).toBe(true);
            }
            for (const relationship of step.relationships) {
                expect(nodeIds.has(relationship.from)).toBe(true);
                expect(nodeIds.has(relationship.to)).toBe(true);
            }
        }
    });
});