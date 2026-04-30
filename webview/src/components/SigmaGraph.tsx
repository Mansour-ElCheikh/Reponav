/**
 * SigmaGraph — WebGL graph renderer (Sigma.js + graphology + ForceAtlas2)
 *
 * Architecture:
 * - Effect A: builds graph + runs ForceAtlas2 layout once per graph/filter change
 * - Effect B: updates node/edge colors on the existing instance (no rebuild) on selection/step change
 * This separation prevents the layout from re-running on every node click or step change.
 */

import { useEffect, useRef, useState, useCallback, useMemo, useLayoutEffect } from 'react';
import Graph from 'graphology';
import Sigma from 'sigma';
import { drawDiscNodeHover } from 'sigma/rendering';
import { createNodeBorderProgram } from '@sigma/node-border';
import forceAtlas2 from 'graphology-layout-forceatlas2';
import type { Tour } from '../types';
import {
    THEME,
    resolveNodeOverlap,
    hasCircularEdgesInTour,
    buildNodeAttrs,
    drawMinimap,
} from './sigmaGraphHelpers';
import type { Filters } from './sigmaGraphHelpers';
import { computeSelectionSets } from './sigmaRenderPolicy';
import type { FilterState, SelectionSets } from './sigmaRenderPolicy';
import { attachSigmaEvents } from './sigmaEventHandlers';
import { addImportEdges, addCouplingEdges, buildAdjacencyMaps, buildVisibleFlowPairKeys, resolveFlowNodeId, type CouplingEdge } from './sigmaEdgeRenderers';
import { applyGroupingLayout } from './sigmaGroupingLayout';
import { buildSigmaReducerPair } from './sigmaGraphReducerPair';
import { getDefaultFlowRenderingStrategy, shouldRenderAnimatedFlowOverlay } from './sigmaFlowRendering';
import { useSigmaFlowOverlay } from './useSigmaFlowOverlay';
import { SigmaGraphFrame } from './SigmaGraphFrame';
import './SigmaGraph.css';
import type { GraphNode, FlowSequence } from '../types';

// ─── Component Props ──────────────────────────────────────────────────────────
interface SigmaGraphProps {
    tour: Tour;
    currentStep: number;
    onNodeClick: (nodeId: string) => void;
    onNodeDoubleClick?: (nodeId: string) => void;
    groupByDirectory?: boolean;
    /** File paths flagged as dead code — nodes for these files render dimmed. Optional. */
    deadCodeFiles?: string[];
    /** Co-change pairs to render as dashed edges. Optional. */
    couplingPairs?: CouplingEdge[];
    flows?: FlowSequence[];
    toolingFlowCount?: number;
    workspaceMode?: 'story' | 'analyst';
    onOpenContextualWiz?: (context: string) => void;
}

// ─── Component ───────────────────────────────────────────────────────────────

/**
 * SigmaGraph renders the dependency/symbol graph using Sigma.js + WebGL.
 * Layout runs once per graph change; highlighting updates in-place without rebuilding.
 */
export function SigmaGraph({ tour, currentStep, onNodeClick, onNodeDoubleClick, groupByDirectory = false, deadCodeFiles = [], couplingPairs = [], flows: flowsProp, toolingFlowCount = 0, workspaceMode = 'story', onOpenContextualWiz }: SigmaGraphProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const sigmaRef = useRef<Sigma | null>(null);
    const graphRef = useRef<Graph | null>(null);
    // Persist node positions across filter-only rebuilds so layout doesn't jump
    const savedPositions = useRef<Map<string, { x: number; y: number }>>(new Map());
    // Cursor drag-state refs — updated in Sigma events, no re-render needed
    const isDraggingRef = useRef(false);
    const isOverNodeRef = useRef(false);
    const minimapRef = useRef<HTMLCanvasElement>(null);
    const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
    const [activeSubFilter, setActiveSubFilter] = useState<'upstream' | 'downstream' | 'circular' | null>(null);
    const [expandedClusters, setExpandedClusters] = useState<Set<string>>(new Set());
    const [filters, setFilters] = useState<Filters>({ showTestFiles: true, showCircularOnly: false, groupDirs: groupByDirectory });
    const [showDeadCode, setShowDeadCode] = useState(false);
    const [showCouplingEdges, setShowCouplingEdges] = useState(true);
    const [showFlowEdges, setShowFlowEdges] = useState(true);
    const [isGraphSurfaceVisible, setIsGraphSurfaceVisible] = useState(true);
    // Mirror selectedNodeId as a ref so afterRender closure always reads latest value without stale closure
    const selectedNodeIdRef = useRef<string | null>(null);
    selectedNodeIdRef.current = selectedNodeId;

    // Stabilize flows reference: treat undefined / empty as a shared EMPTY constant
    // so Effect D doesn't re-run on every render when the parent passes no flows.
    const EMPTY_FLOWS: FlowSequence[] = useMemo(() => [], []);
    const flows = flowsProp && flowsProp.length > 0 ? flowsProp : EMPTY_FLOWS;
    const deadCodeFileSet = useMemo(
        () => (showDeadCode ? new Set(deadCodeFiles) : undefined),
        [showDeadCode, deadCodeFiles],
    );

    const flowFileToDisplayNodeRef = useRef<Map<string, string>>(new Map());
    const flowPairKeysRef = useRef<Set<string>>(new Set());
    const overlayDataRef = useRef<{ couplingPairs: CouplingEdge[]; flows: FlowSequence[] }>({ couplingPairs, flows });
    const flowRenderingStrategy = getDefaultFlowRenderingStrategy();
    // Bumped each time Effect A creates a new Sigma instance so Effect E re-registers
    const [sigmaEpoch, setSigmaEpoch] = useState(0);
    const flowOverlayInvalidationKey = useMemo(
        () => `${filters.groupDirs}:${Array.from(expandedClusters).sort().join('|')}`,
        [expandedClusters, filters.groupDirs],
    );
    const { flowOverlayRef, flowPathCount } = useSigmaFlowOverlay({
        sigmaRef,
        graphRef,
        flowFileToDisplayNodeRef,
        flows,
        isGraphSurfaceVisible,
        showFlowEdges,
        sigmaEpoch,
        overlayInvalidationKey: flowOverlayInvalidationKey,
    });

    const getFa2Settings = useCallback((graph: Graph): Record<string, unknown> => {
        const inferred = forceAtlas2.inferSettings(graph) as Record<string, unknown>;
        const scalingRatio = typeof inferred['scalingRatio'] === 'number' ? (inferred['scalingRatio'] as number) : 1;
        const gravity = typeof inferred['gravity'] === 'number' ? (inferred['gravity'] as number) : 1;
        const slowDown = typeof inferred['slowDown'] === 'number' ? (inferred['slowDown'] as number) : 1;
        // Keep a wider, less-collapsed equilibrium so dense repos retain flower-like spacing.
        return {
            ...inferred,
            adjustSizes: false,
            scalingRatio: Math.max(scalingRatio * 1.35, 4),
            gravity: Math.min(Math.max(gravity * 0.7, 0.05), 0.5),
            slowDown: Math.max(slowDown, 1.2),
        };
    }, []);

    const syncOverlayEdges = useCallback((
        g: Graph,
        fileToDisplayNode?: Map<string, string>,
    ) => {
        const { couplingPairs: currentCouplingPairs, flows: currentFlows } = overlayDataRef.current;
        const overlayKeys: string[] = [];
        g.forEachEdge((key, attrs) => {
            if (attrs.isFlowEdge || attrs.isCoupling) overlayKeys.push(key);
        });
        for (const key of overlayKeys) g.dropEdge(key);
        const nodeSet = new Set(g.nodes());
        if (currentCouplingPairs.length > 0) addCouplingEdges(g, currentCouplingPairs, nodeSet, fileToDisplayNode);
        flowPairKeysRef.current = currentFlows.length > 0
            ? buildVisibleFlowPairKeys(currentFlows, nodeSet, fileToDisplayNode)
            : new Set();
    }, []);

    // Redraw the minimap only when graph topology or selection changes.
    const redrawMinimap = useCallback((g: Graph) => {
        const canvas = minimapRef.current;
        if (!canvas) return;
        const nodes = g.nodes().map((id) => {
            const attrs = g.getNodeAttributes(id);
            return {
                id,
                x: attrs.x as number,
                y: attrs.y as number,
                color: attrs.color as string,
                size: attrs.size as number,
            };
        });
        drawMinimap(canvas, nodes, selectedNodeIdRef.current);
    }, []);

    // ─── Derived flags ─────────────────────────────────────────────────────
    const hasTestNodes = useMemo(() => tour?.graph?.nodes.some((n) => n.type === 'test') ?? false, [tour?.graph?.nodes]);
    const hasCircularEdges = useMemo(
        () => hasCircularEdgesInTour(tour),
        [tour?.analysisSnapshot?.circularCount, tour?.graph?.edges],
    );

    // ─── Base graph (only changes on new tour) ─────────────────────────────
    const baseGraph = tour?.graph ?? null;
    // ─── Upstream / downstream maps ───────────────────────────────────────
    const { upstreamMap, downstreamMap } = useMemo(
        () => buildAdjacencyMaps(baseGraph?.edges ?? []),
        [baseGraph?.edges]
    );

    // ─── Circular neighbor map (isCircular edge flag → covers transitive cycles) ──
    // Maps each node → set of nodes reachable via any isCircular edge in either direction.
    // Used by computeSelectionSets so the legend card count matches the red-edge visual.
    const circularNeighborMap = useMemo(() => {
        const map = new Map<string, Set<string>>();
        for (const edge of baseGraph?.edges ?? []) {
            if (!edge.isCircular) continue;
            if (!map.has(edge.source)) map.set(edge.source, new Set());
            if (!map.has(edge.target)) map.set(edge.target, new Set());
            map.get(edge.source)!.add(edge.target);
            map.get(edge.target)!.add(edge.source);
        }
        return map;
    }, [baseGraph?.edges]);

    // Clear saved positions when a new tour loads so layout runs fresh
    useEffect(() => { savedPositions.current.clear(); }, [tour?.id]);
    useEffect(() => { overlayDataRef.current = { couplingPairs, flows }; }, [couplingPairs, flows]);

    // ─── Effect A: build graph + layout (runs once per graph/filter change) ──
    useLayoutEffect(() => {
        const container = containerRef.current;
        if (!container || !baseGraph) return;
        let layoutTimer: ReturnType<typeof setTimeout> | null = null;

        // Save current node positions before killing so filter changes don't re-layout
        if (graphRef.current) {
            graphRef.current.forEachNode((id, attrs) => {
                savedPositions.current.set(id, { x: attrs.x, y: attrs.y });
            });
        }

        // Kill previous Sigma instance
        if (sigmaRef.current) { sigmaRef.current.kill(); sigmaRef.current = null; }

        // Wait for container to have real dimensions
        if (container.offsetWidth === 0 || container.offsetHeight === 0) return;

        const g = new Graph({ multi: true, type: 'directed' });

        // Build ALL nodes — filtering handled by combined reducer, not construction
        const emptyHints = new Map<string, { x: number; y: number }>();
        for (const node of baseGraph.nodes) {
            g.addNode(node.id, buildNodeAttrs(node, savedPositions.current, emptyHints));
        }

        // Build ONLY structural import edges before layout — overlay edges (flow, coupling)
        // are added AFTER layout to prevent them from distorting FA2's force calculations.
        // FA2 infers gravity/scalingRatio from edge count; overlay edges inflate that count
        // and collapse the graph into a tight oval instead of the natural flower pattern.
        const nodeSet = new Set(g.nodes());
        addImportEdges(g, baseGraph.edges, nodeSet);
        const identityFlowNodeMap = new Map(baseGraph.nodes.map((node) => [node.id, node.id]));
        flowFileToDisplayNodeRef.current = identityFlowNodeMap;
        flowPairKeysRef.current = flows.length > 0
            ? buildVisibleFlowPairKeys(flows, nodeSet, identityFlowNodeMap)
            : new Set();

        // Seed unpositioned nodes near their neighbors instead of random positions
        const unpositioned = g.nodes().filter((id) => !savedPositions.current.has(id));

        // Border program: outer ring (upstream/downstream/glow) + inner fill (category color)
        const NodeBorderProgram = createNodeBorderProgram({
            borders: [
                { size: { attribute: 'borderSize', defaultValue: 0 }, color: { attribute: 'borderColor' } },
                { size: { fill: true }, color: { attribute: 'color' } },
            ],
        });

        const renderer = new Sigma(g, container, {
            renderEdgeLabels: false,
            defaultEdgeType: 'arrow',
            defaultNodeType: 'bordered',
            nodeProgramClasses: { bordered: NodeBorderProgram },
            labelFont: 'Inter, system-ui, sans-serif',
            labelSize: 11,
            labelWeight: '500',
            labelColor: { color: THEME.textPrimary },
            zIndex: true,
            // Override hover label rendering: draw a colored pill with black text
            // (default Sigma uses labelColor which is light, unreadable on bright node bg)
            defaultDrawNodeHover: (ctx, data, settings) => {
                drawDiscNodeHover(ctx, data, settings);
                // Re-draw label with black text on colored pill for contrast
                if (data.label) {
                    const fontSize = settings.labelSize;
                    const font = `${settings.labelWeight} ${fontSize}px ${settings.labelFont}`;
                    ctx.font = font;
                    const textW = ctx.measureText(data.label).width;
                    const padX = 6;
                    const padY = 3;
                    const boxW = textW + padX * 2;
                    const boxH = fontSize + padY * 2;
                    const bx = data.x + data.size + 4;
                    const by = data.y - boxH / 2;
                    // Colored pill background
                    ctx.fillStyle = data.color as string;
                    if ((ctx as CanvasRenderingContext2D & { roundRect?: (...a: unknown[]) => void }).roundRect) {
                        ctx.beginPath();
                        (ctx as CanvasRenderingContext2D & { roundRect: (x: number, y: number, w: number, h: number, r: number) => void }).roundRect(bx, by, boxW, boxH, 4);
                        ctx.fill();
                    } else {
                        ctx.fillRect(bx, by, boxW, boxH);
                    }
                    // Black label text — readable on any node color
                    ctx.fillStyle = '#000000';
                    ctx.textAlign = 'left';
                    ctx.textBaseline = 'middle';
                    ctx.fillText(data.label, bx + padX, data.y);
                }
            },
        });

        graphRef.current = g;
        sigmaRef.current = renderer;
        setSigmaEpoch((n) => n + 1);

        const cleanupEvents = attachSigmaEvents(renderer, g, {
            containerRef, isDraggingRef, isOverNodeRef, graphRef, minimapRef,
            selectedNodeIdRef, setSelectedNodeId, setExpandedClusters,
            setHighlightedType, onNodeClick, onNodeDoubleClick,
        });

        redrawMinimap(g);

        if (unpositioned.length > 0) {
            setIsGraphSurfaceVisible(false);
            layoutTimer = setTimeout(() => {
                if (sigmaRef.current !== renderer || graphRef.current !== g) return;

                if (unpositioned.length < g.order) {
                    // Some nodes are new (e.g. tests re-added) — place them near connected nodes.
                    for (const nodeId of unpositioned) {
                        const neighbors = g.neighbors(nodeId);
                        const positioned = neighbors.filter((n) => savedPositions.current.has(n));
                        if (positioned.length > 0) {
                            let avgX = 0, avgY = 0;
                            for (const n of positioned) {
                                const p = savedPositions.current.get(n)!;
                                avgX += p.x;
                                avgY += p.y;
                            }
                            avgX /= positioned.length;
                            avgY /= positioned.length;
                            g.mergeNodeAttributes(nodeId, { x: avgX + (Math.random() - 0.5) * 50, y: avgY + (Math.random() - 0.5) * 50 });
                        }
                    }
                    const partialIter = g.order <= 300 ? 40 : 25;
                    forceAtlas2.assign(g, { iterations: partialIter, settings: getFa2Settings(g) });
                } else {
                    // Entirely new graph — full layout; scale iterations to graph size for convergence.
                    const iterations = g.order <= 100 ? 200 : g.order <= 300 ? 120 : g.order <= 600 ? 80 : 60;
                    forceAtlas2.assign(g, { iterations, settings: getFa2Settings(g) });
                }

                const nodeData = g.nodes().map((id) => {
                    const a = g.getNodeAttributes(id);
                    return { id, x: a.x as number, y: a.y as number, size: a.size as number };
                });
                resolveNodeOverlap(nodeData);
                for (const { id, x, y } of nodeData) g.mergeNodeAttributes(id, { x, y });

                syncOverlayEdges(g, flowFileToDisplayNodeRef.current);
                redrawMinimap(g);
                renderer.refresh();
                setIsGraphSurfaceVisible(true);
            }, 0);
        } else {
            syncOverlayEdges(g, flowFileToDisplayNodeRef.current);
            renderer.refresh();
            setIsGraphSurfaceVisible(true);
        }

        return () => {
            if (layoutTimer !== null) clearTimeout(layoutTimer);
            cleanupEvents();
            renderer.kill();
            sigmaRef.current = null;
            graphRef.current = null;
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [baseGraph, getFa2Settings, redrawMinimap, syncOverlayEdges]);

    // ─── Effect C: in-place graph mutation for directory grouping ─────────
    useEffect(() => {
        const g = graphRef.current;
        const renderer = sigmaRef.current;
        if (!g || !renderer || !baseGraph) return;
        const { fileToDisplayNode } = applyGroupingLayout(g, baseGraph, filters.groupDirs, expandedClusters, savedPositions.current);
        flowFileToDisplayNodeRef.current = fileToDisplayNode;
        syncOverlayEdges(g, fileToDisplayNode);
        redrawMinimap(g);
        renderer.refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [filters.groupDirs, expandedClusters, redrawMinimap, syncOverlayEdges]);

    // ─── Effect D: sync overlay edges when analysis overlays change ───────────
    useEffect(() => {
        const g = graphRef.current;
        const renderer = sigmaRef.current;
        if (!g || !renderer) return;
        syncOverlayEdges(g, flowFileToDisplayNodeRef.current);
        renderer.refresh();
    }, [couplingPairs, flows, syncOverlayEdges]);

    useEffect(() => {
        const g = graphRef.current;
        if (!g) return;
        redrawMinimap(g);
    }, [selectedNodeId, redrawMinimap]);

    // ─── highlightedType must be declared before the nodeReducer effect ──────
    const [highlightedType, setHighlightedType] = useState<string | null>(null);
    const handleLegendTypeClick = useCallback((type: string) => {
        setHighlightedType((prev) => (prev === type ? null : type));
        setSelectedNodeId(null);
    }, []);
    const handleFiltersChange = useCallback((nextFilters: Filters) => {
        setFilters(nextFilters);
        if (nextFilters.showCircularOnly) {
            setShowFlowEdges(false);
        }
    }, []);

    useEffect(() => {
        const g = graphRef.current;
        const renderer = sigmaRef.current;
        if (!g || !renderer) return;

        const activeStepFiles = new Set(tour.steps[currentStep]?.files ?? []);
        const selSets: SelectionSets = computeSelectionSets(upstreamMap, downstreamMap, selectedNodeId, circularNeighborMap);
        const { upstreamOnly: upstreamNodes, downstreamOnly: downstreamNodes } = selSets;
        const filterState: FilterState = { showTestFiles: filters.showTestFiles, showCircularOnly: filters.showCircularOnly };

        // Build set of nodes involved in circular edges (for circular-only filter)
        const circularNodeIds = new Set<string>();
        if (filters.showCircularOnly) {
            g.forEachEdge((_edge, attrs, source, target) => {
                if (attrs.isCircular) { circularNodeIds.add(source); circularNodeIds.add(target); }
            });
        }

        const flowPairKeys = flowPairKeysRef.current;

        // Build nodeType map for edge reducer (used by type-filter dim)
        const nodeTypeMap = new Map<string, string>();
        if (highlightedType) {
            g.forEachNode((id, attrs) => { if (attrs.nodeType) nodeTypeMap.set(id, attrs.nodeType as string); });
        }

        const reducers = buildSigmaReducerPair({
            filterState,
            selectedNodeId,
            activeSubFilter,
            highlightedType,
            activeStepFiles,
            upstreamNodes,
            downstreamNodes,
            circularNodes: circularNodeIds,
            selectionCircularNodes: selSets.circular,
            deadCodeFileSet,
            showCouplingEdges,
            showFlowEdges,
            flowPairKeys,
            nodeTypeMap,
        });

        renderer.setSetting('nodeReducer', reducers.nodeReducer);
        renderer.setSetting('edgeReducer', (edge: string, data: Record<string, unknown>) => {
            const source = g.source(edge);
            const target = g.target(edge);
            return reducers.edgeReducer(edge, data, source, target);
        });

        renderer.refresh();
    }, [selectedNodeId, activeSubFilter, currentStep, tour.steps, upstreamMap, downstreamMap, circularNeighborMap, filters.showTestFiles, filters.showCircularOnly, highlightedType, deadCodeFileSet, showCouplingEdges, showFlowEdges]);

    // ─── Legend ───────────────────────────────────────────────────────────
    const handleClearSelection = useCallback(() => { setSelectedNodeId(null); setActiveSubFilter(null); }, []);
    const handleSubFilterChange = useCallback((f: 'upstream' | 'downstream' | 'circular' | null) => { setActiveSubFilter(f); }, []);
    const handleZoomIn = useCallback(() => { sigmaRef.current?.getCamera()?.animatedZoom({ duration: 200 }); }, []);
    const handleResetZoom = useCallback(() => { sigmaRef.current?.getCamera()?.animatedReset({ duration: 300 }); }, []);
    const handleZoomOut = useCallback(() => { sigmaRef.current?.getCamera()?.animatedUnzoom({ duration: 200 }); }, []);
    // Clear sub-filter whenever selected node changes
    const prevSelectedRef = useRef<string | null>(null);
    useEffect(() => {
        if (prevSelectedRef.current !== selectedNodeId) {
            setActiveSubFilter(null);
            prevSelectedRef.current = selectedNodeId;
        }
    }, [selectedNodeId]);
    const selectionSets = useMemo(
        () => computeSelectionSets(upstreamMap, downstreamMap, selectedNodeId, circularNeighborMap),
        [selectedNodeId, upstreamMap, downstreamMap, circularNeighborMap],
    );
    // ─── Render ───────────────────────────────────────────────────────────
    return (
        <SigmaGraphFrame
            containerRef={containerRef}
            minimapRef={minimapRef}
            flowOverlayRef={flowOverlayRef}
            isGraphSurfaceVisible={isGraphSurfaceVisible}
            showAnimatedFlowOverlay={isGraphSurfaceVisible && shouldRenderAnimatedFlowOverlay(flowRenderingStrategy, showFlowEdges, flowPathCount)}
            hasTestNodes={hasTestNodes}
            hasCircularEdges={hasCircularEdges}
            filters={filters}
            onFiltersChange={handleFiltersChange}
            setExpandedClusters={setExpandedClusters}
            setSelectedNodeId={setSelectedNodeId}
            deadCodeFiles={deadCodeFiles}
            showDeadCode={showDeadCode}
            onShowDeadCodeChange={setShowDeadCode}
            couplingPairs={couplingPairs}
            showCouplingEdges={showCouplingEdges}
            onShowCouplingEdgesChange={setShowCouplingEdges}
            toolingFlowCount={toolingFlowCount}
            flows={flows}
            showFlowEdges={showFlowEdges}
            onShowFlowEdgesChange={setShowFlowEdges}
            selectedNodeId={selectedNodeId}
            upstreamCount={selectionSets.upstreamOnly.size}
            downstreamCount={selectionSets.downstreamOnly.size}
            circularCount={selectionSets.circular.size}
            activeSubFilter={activeSubFilter}
            onSubFilterChange={handleSubFilterChange}
            onClearSelection={handleClearSelection}
            nodes={baseGraph?.nodes ?? []}
            highlightedType={highlightedType}
            onTypeClick={handleLegendTypeClick}
            onZoomIn={handleZoomIn}
            onResetZoom={handleResetZoom}
            onZoomOut={handleZoomOut}
        />
    );
}
