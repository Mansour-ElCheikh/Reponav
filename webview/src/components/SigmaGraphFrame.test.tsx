/** @vitest-environment jsdom */

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { FlowOverlayHandle } from './FlowOverlay';
import { SigmaGraphFrame } from './SigmaGraphFrame';

const frameDoubles = vi.hoisted(() => ({
    flowOverlayMock: vi.fn(() => null),
    graphToolbarMock: vi.fn(() => null),
    nodeSelectionLegendMock: vi.fn(() => null),
    nodeTypeLegendMock: vi.fn(() => null),
}));

vi.mock('./FlowOverlay', () => ({
    FlowOverlay: React.forwardRef((props: unknown, ref: React.ForwardedRef<FlowOverlayHandle>) => {
        React.useImperativeHandle(ref, () => ({ setPaths: vi.fn(), clear: vi.fn() }));
        frameDoubles.flowOverlayMock(props);
        return <div data-testid="flow-overlay-mock" />;
    }),
}));

vi.mock('./GraphToolbar', () => ({
    GraphToolbar: (props: unknown) => {
        frameDoubles.graphToolbarMock(props);
        return <div data-testid="graph-toolbar-mock" />;
    },
}));

vi.mock('./SigmaLegends', () => ({
    NodeSelectionLegend: (props: unknown) => {
        frameDoubles.nodeSelectionLegendMock(props);
        return <div data-testid="selection-legend-mock" />;
    },
    NodeTypeLegend: (props: unknown) => {
        frameDoubles.nodeTypeLegendMock(props);
        return <div data-testid="type-legend-mock" />;
    },
}));

describe('SigmaGraphFrame', () => {
    it('renders the graph shell and forwards composition props', () => {
        const containerRef = { current: null } as React.MutableRefObject<HTMLDivElement | null>;
        const minimapRef = { current: null } as React.MutableRefObject<HTMLCanvasElement | null>;
        const flowOverlayRef = { current: null } as React.MutableRefObject<FlowOverlayHandle | null>;

        render(
            <SigmaGraphFrame
                containerRef={containerRef}
                minimapRef={minimapRef}
                flowOverlayRef={flowOverlayRef}
                isGraphSurfaceVisible={true}
                showAnimatedFlowOverlay={true}
                hasTestNodes={true}
                hasCircularEdges={true}
                filters={{ showTestFiles: true, showCircularOnly: false, groupDirs: false }}
                onFiltersChange={vi.fn()}
                setExpandedClusters={vi.fn()}
                setSelectedNodeId={vi.fn()}
                deadCodeFiles={[]}
                showDeadCode={false}
                onShowDeadCodeChange={vi.fn()}
                couplingPairs={[]}
                showCouplingEdges={true}
                onShowCouplingEdgesChange={vi.fn()}
                toolingFlowCount={0}
                flows={[]}
                showFlowEdges={true}
                onShowFlowEdgesChange={vi.fn()}
                selectedNodeId={null}
                upstreamCount={1}
                downstreamCount={2}
                circularCount={3}
                activeSubFilter={null}
                onSubFilterChange={vi.fn()}
                onClearSelection={vi.fn()}
                nodes={[]}
                highlightedType={null}
                onTypeClick={vi.fn()}
                onZoomIn={vi.fn()}
                onResetZoom={vi.fn()}
                onZoomOut={vi.fn()}
            />
        );

        expect(screen.getByTestId('sigma-graph')).toBeTruthy();
        expect(screen.getByTestId('sigma-surface')).toBeTruthy();
        expect(screen.getByTestId('sigma-stage')).toBeTruthy();
        expect(screen.getByTestId('graph-minimap')).toBeTruthy();
        expect(screen.getByTestId('graph-controls')).toBeTruthy();
        expect(screen.getByTestId('graph-tools-anchor')).toBeTruthy();
        expect(screen.queryByTestId('graph-focus-summary')).toBeNull();
        expect(screen.getByTestId('selection-legend-mock')).toBeTruthy();
        expect(screen.getByTestId('type-legend-mock')).toBeTruthy();
        expect(frameDoubles.flowOverlayMock).toHaveBeenCalledWith(expect.objectContaining({ visible: true }));
    });

    it('wires zoom controls to the provided callbacks', () => {
        const onZoomIn = vi.fn();
        const onResetZoom = vi.fn();
        const onZoomOut = vi.fn();

        render(
            <SigmaGraphFrame
                containerRef={{ current: null }}
                minimapRef={{ current: null }}
                flowOverlayRef={{ current: null }}
                isGraphSurfaceVisible={true}
                showAnimatedFlowOverlay={false}
                hasTestNodes={false}
                hasCircularEdges={false}
                filters={{ showTestFiles: true, showCircularOnly: false, groupDirs: false }}
                onFiltersChange={vi.fn()}
                setExpandedClusters={vi.fn()}
                setSelectedNodeId={vi.fn()}
                deadCodeFiles={[]}
                showDeadCode={false}
                onShowDeadCodeChange={vi.fn()}
                couplingPairs={[]}
                showCouplingEdges={true}
                onShowCouplingEdgesChange={vi.fn()}
                toolingFlowCount={0}
                flows={[]}
                showFlowEdges={true}
                onShowFlowEdgesChange={vi.fn()}
                selectedNodeId={null}
                upstreamCount={0}
                downstreamCount={0}
                circularCount={0}
                activeSubFilter={null}
                onSubFilterChange={vi.fn()}
                onClearSelection={vi.fn()}
                nodes={[]}
                highlightedType={null}
                onTypeClick={vi.fn()}
                onZoomIn={onZoomIn}
                onResetZoom={onResetZoom}
                onZoomOut={onZoomOut}
            />
        );

        fireEvent.click(screen.getByLabelText('Zoom in'));
        fireEvent.click(screen.getByLabelText('Fit to screen'));
        fireEvent.click(screen.getByLabelText('Zoom out'));

        expect(onZoomIn).toHaveBeenCalledOnce();
        expect(onResetZoom).toHaveBeenCalledOnce();
        expect(onZoomOut).toHaveBeenCalledOnce();
    });

    it('anchors compact overlays with 8px separation and leaves zoom controls clear', () => {
        window.innerWidth = 480;

        render(
            <SigmaGraphFrame
                containerRef={{ current: null }}
                minimapRef={{ current: null }}
                flowOverlayRef={{ current: null }}
                isGraphSurfaceVisible={true}
                showAnimatedFlowOverlay={false}
                hasTestNodes={true}
                hasCircularEdges={true}
                filters={{ showTestFiles: true, showCircularOnly: false, groupDirs: false }}
                onFiltersChange={vi.fn()}
                setExpandedClusters={vi.fn()}
                setSelectedNodeId={vi.fn()}
                deadCodeFiles={[]}
                showDeadCode={false}
                onShowDeadCodeChange={vi.fn()}
                couplingPairs={[]}
                showCouplingEdges={true}
                onShowCouplingEdgesChange={vi.fn()}
                toolingFlowCount={0}
                flows={[]}
                showFlowEdges={true}
                onShowFlowEdgesChange={vi.fn()}
                selectedNodeId={null}
                upstreamCount={0}
                downstreamCount={0}
                circularCount={0}
                activeSubFilter={null}
                onSubFilterChange={vi.fn()}
                onClearSelection={vi.fn()}
                nodes={[]}
                highlightedType={null}
                onTypeClick={vi.fn()}
                onZoomIn={vi.fn()}
                onResetZoom={vi.fn()}
                onZoomOut={vi.fn()}
            />
        );

        expect(screen.getByTestId('graph-tools-anchor')).toHaveStyle({ top: '8px', right: '8px' });
        expect(screen.getByTestId('graph-selection-anchor')).toHaveStyle({ bottom: '56px', left: '8px' });
        expect(screen.getByTestId('graph-type-legend-anchor')).toHaveStyle({ bottom: '56px', right: '8px' });
        expect(screen.getByTestId('graph-controls')).toHaveStyle({ bottom: '8px' });
    });
});