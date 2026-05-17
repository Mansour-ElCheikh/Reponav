import type React from 'react';
import type { FlowOverlayHandle } from './FlowOverlay';
import { FlowOverlay } from './FlowOverlay';
import { GraphToolbar } from './GraphToolbar';
import { NodeSelectionLegend, NodeTypeLegend } from './SigmaLegends';
import type { CouplingEdge } from './sigmaEdgeRenderers';
import type { Filters } from './sigmaGraphHelpers';
import type { FlowSequence, GraphNode } from '../types';

interface SigmaGraphFrameProps {
    containerRef: React.MutableRefObject<HTMLDivElement | null>;
    minimapRef: React.MutableRefObject<HTMLCanvasElement | null>;
    flowOverlayRef: React.MutableRefObject<FlowOverlayHandle | null>;
    isGraphSurfaceVisible: boolean;
    showAnimatedFlowOverlay: boolean;
    hasTestNodes: boolean;
    hasCircularEdges: boolean;
    filters: Filters;
    onFiltersChange: (filters: Filters) => void;
    setExpandedClusters: (clusters: Set<string>) => void;
    setSelectedNodeId: (nodeId: string | null) => void;
    deadCodeFiles: string[];
    showDeadCode: boolean;
    onShowDeadCodeChange: (visible: boolean) => void;
    couplingPairs: CouplingEdge[];
    showCouplingEdges: boolean;
    onShowCouplingEdgesChange: (visible: boolean) => void;
    toolingFlowCount: number;
    flows: FlowSequence[];
    showFlowEdges: boolean;
    onShowFlowEdgesChange: (visible: boolean) => void;
    selectedNodeId: string | null;
    upstreamCount: number;
    downstreamCount: number;
    circularCount: number;
    activeSubFilter: 'upstream' | 'downstream' | 'circular' | null;
    onSubFilterChange: (filter: 'upstream' | 'downstream' | 'circular' | null) => void;
    onClearSelection: () => void;
    nodes: Pick<GraphNode, 'type'>[];
    highlightedType: string | null;
    onTypeClick: (type: string) => void;
    onZoomIn: () => void;
    onResetZoom: () => void;
    onZoomOut: () => void;
}

/**
 * SigmaGraphFrame renders the graph surface and overlay chrome around the Sigma stage.
 */
export function SigmaGraphFrame({
    containerRef,
    minimapRef,
    flowOverlayRef,
    isGraphSurfaceVisible,
    showAnimatedFlowOverlay,
    hasTestNodes,
    hasCircularEdges,
    filters,
    onFiltersChange,
    setExpandedClusters,
    setSelectedNodeId,
    deadCodeFiles,
    showDeadCode,
    onShowDeadCodeChange,
    couplingPairs,
    showCouplingEdges,
    onShowCouplingEdgesChange,
    toolingFlowCount,
    flows,
    showFlowEdges,
    onShowFlowEdgesChange,
    selectedNodeId,
    upstreamCount,
    downstreamCount,
    circularCount,
    activeSubFilter,
    onSubFilterChange,
    onClearSelection,
    nodes,
    highlightedType,
    onTypeClick,
    onZoomIn,
    onResetZoom,
    onZoomOut,
}: SigmaGraphFrameProps) {
    const isCompactPane = typeof window !== 'undefined' && window.innerWidth >= 360 && window.innerWidth <= 600;
    const overlayInset = isCompactPane ? 8 : 12;

    return (
        <div style={{ position: 'relative', width: '100%', height: '100%' }} data-testid="sigma-graph">
            <div
                data-testid="sigma-surface"
                style={{ position: 'absolute', inset: 0, visibility: isGraphSurfaceVisible ? 'visible' : 'hidden' }}
            >
                <div ref={containerRef} data-testid="sigma-stage" style={{ width: '100%', height: '100%' }} />

                <canvas
                    ref={minimapRef}
                    className="graph-minimap"
                    width={160}
                    height={110}
                    aria-hidden="true"
                    data-testid="graph-minimap"
                />

                <FlowOverlay ref={flowOverlayRef} visible={showAnimatedFlowOverlay} />
            </div>

            <div data-testid="graph-tools-anchor" style={{ position: 'absolute', top: `${overlayInset}px`, right: `${overlayInset}px`, zIndex: 10 }}>
                <GraphToolbar
                    hasTestNodes={hasTestNodes}
                    hasCircularEdges={hasCircularEdges}
                    filters={filters}
                    onFiltersChange={onFiltersChange}
                    setExpandedClusters={setExpandedClusters}
                    setSelectedNodeId={setSelectedNodeId}
                    deadCodeFiles={deadCodeFiles}
                    showDeadCode={showDeadCode}
                    onShowDeadCodeChange={onShowDeadCodeChange}
                    couplingPairs={couplingPairs}
                    showCouplingEdges={showCouplingEdges}
                    onShowCouplingEdgesChange={onShowCouplingEdgesChange}
                    toolingFlowCount={toolingFlowCount}
                    flows={flows}
                    showFlowEdges={showFlowEdges}
                    onShowFlowEdgesChange={onShowFlowEdgesChange}
                />
            </div>

            <div data-testid="graph-selection-anchor" style={{ position: 'absolute', bottom: `${overlayInset + 48}px`, left: `${overlayInset}px`, zIndex: 9 }}>
                <NodeSelectionLegend
                    selectedNodeId={selectedNodeId}
                    upstreamCount={upstreamCount}
                    downstreamCount={downstreamCount}
                    circularCount={circularCount}
                    activeSubFilter={activeSubFilter}
                    onSubFilterChange={onSubFilterChange}
                    onClearSelection={onClearSelection}
                />
            </div>
            <div data-testid="graph-type-legend-anchor" style={{ position: 'absolute', bottom: `${overlayInset + 48}px`, right: `${overlayInset}px`, zIndex: 9 }}>
                <NodeTypeLegend nodes={nodes} highlightedType={highlightedType} onTypeClick={onTypeClick} />
            </div>

            <div className="graph-controls" data-testid="graph-controls" style={{ bottom: `${overlayInset}px` }}>
                <button className="graph-control-btn" title="Zoom in" aria-label="Zoom in" onClick={onZoomIn}>＋</button>
                <button className="graph-control-btn" title="Fit to screen" aria-label="Fit to screen" onClick={onResetZoom}>⊡</button>
                <button className="graph-control-btn" title="Zoom out" aria-label="Zoom out" onClick={onZoomOut}>－</button>
            </div>
        </div>
    );
}