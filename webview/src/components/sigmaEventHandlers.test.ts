import { describe, it, expect, vi } from 'vitest';
import type Graph from 'graphology';
import type Sigma from 'sigma';
import { attachSigmaEvents } from './sigmaEventHandlers';

// Minimal mock helpers
function makeMockGraph(nodes: Record<string, Record<string, unknown>> = {}): Graph {
    return {
        getNodeAttributes: (id: string) => nodes[id] ?? {},
        nodes: () => Object.keys(nodes),
        neighbors: () => [],
    } as unknown as Graph;
}

function makeMockRenderer(handlers: Record<string, (...a: unknown[]) => void> = {}): Sigma {
    return {
        on: (event: string, handler: (...a: unknown[]) => void) => { handlers[event] = handler; },
    } as unknown as Sigma;
}

describe('attachSigmaEvents', () => {
    it('returns a cleanup function', () => {
        const eventHandlers: Record<string, (...a: unknown[]) => void> = {};
        const renderer = makeMockRenderer(eventHandlers);
        const g = makeMockGraph();
        const callbacks = {
            containerRef: { current: document.createElement('div') },
            isDraggingRef: { current: false },
            isOverNodeRef: { current: false },
            graphRef: { current: null as Graph | null },
            minimapRef: { current: null as HTMLCanvasElement | null },
            selectedNodeIdRef: { current: null as string | null },
            setSelectedNodeId: vi.fn(),
            setExpandedClusters: vi.fn(),
            setHighlightedType: vi.fn(),
            onNodeClick: vi.fn(),
            onNodeDoubleClick: undefined as ((id: string) => void) | undefined,
        };
        const cleanup = attachSigmaEvents(renderer, g, callbacks);
        expect(typeof cleanup).toBe('function');
        cleanup();
    });

    it('registers downNode, clickNode, doubleClickNode, clickStage, enterNode handlers', () => {
        const eventHandlers: Record<string, (...a: unknown[]) => void> = {};
        const renderer = makeMockRenderer(eventHandlers);
        const g = makeMockGraph();
        const callbacks = {
            containerRef: { current: document.createElement('div') },
            isDraggingRef: { current: false },
            isOverNodeRef: { current: false },
            graphRef: { current: null as Graph | null },
            minimapRef: { current: null as HTMLCanvasElement | null },
            selectedNodeIdRef: { current: null as string | null },
            setSelectedNodeId: vi.fn(),
            setExpandedClusters: vi.fn(),
            setHighlightedType: vi.fn(),
            onNodeClick: vi.fn(),
            onNodeDoubleClick: undefined as ((id: string) => void) | undefined,
        };
        attachSigmaEvents(renderer, g, callbacks);
        expect(eventHandlers['downNode']).toBeDefined();
        expect(eventHandlers['clickNode']).toBeDefined();
        expect(eventHandlers['doubleClickNode']).toBeDefined();
        expect(eventHandlers['clickStage']).toBeDefined();
        expect(eventHandlers['enterNode']).toBeDefined();
    });

    it('does not register a minimap redraw on every Sigma afterRender event', () => {
        const eventHandlers: Record<string, (...a: unknown[]) => void> = {};
        const renderer = makeMockRenderer(eventHandlers);
        const g = makeMockGraph();
        const callbacks = {
            containerRef: { current: document.createElement('div') },
            isDraggingRef: { current: false },
            isOverNodeRef: { current: false },
            graphRef: { current: null as Graph | null },
            minimapRef: { current: document.createElement('canvas') },
            selectedNodeIdRef: { current: null as string | null },
            setSelectedNodeId: vi.fn(),
            setExpandedClusters: vi.fn(),
            setHighlightedType: vi.fn(),
            onNodeClick: vi.fn(),
            onNodeDoubleClick: undefined as ((id: string) => void) | undefined,
        };

        attachSigmaEvents(renderer, g, callbacks);

        expect(eventHandlers['afterRender']).toBeUndefined();
    });

    it('calls onNodeClick when downNode fires on a non-cluster node', () => {
        const eventHandlers: Record<string, (...a: unknown[]) => void> = {};
        const renderer = makeMockRenderer(eventHandlers);
        const g = makeMockGraph({ 'src/foo.ts': { isCluster: false } });
        const onNodeClick = vi.fn();
        const callbacks = {
            containerRef: { current: document.createElement('div') },
            isDraggingRef: { current: false },
            isOverNodeRef: { current: false },
            graphRef: { current: null as Graph | null },
            minimapRef: { current: null as HTMLCanvasElement | null },
            selectedNodeIdRef: { current: null as string | null },
            setSelectedNodeId: vi.fn(),
            setExpandedClusters: vi.fn(),
            setHighlightedType: vi.fn(),
            onNodeClick,
            onNodeDoubleClick: undefined as ((id: string) => void) | undefined,
        };
        attachSigmaEvents(renderer, g, callbacks);
        eventHandlers['downNode']({ node: 'src/foo.ts', preventSigmaDefault: vi.fn() });
        expect(onNodeClick).toHaveBeenCalledWith('src/foo.ts');
    });

    it('does not clear selection on clickStage immediately after a node click sequence', () => {
        const eventHandlers: Record<string, (...a: unknown[]) => void> = {};
        const renderer = makeMockRenderer(eventHandlers);
        const g = makeMockGraph({ 'src/foo.ts': { isCluster: false } });
        const setSelectedNodeId = vi.fn();
        const setHighlightedType = vi.fn();
        const callbacks = {
            containerRef: { current: document.createElement('div') },
            isDraggingRef: { current: false },
            isOverNodeRef: { current: false },
            graphRef: { current: null as Graph | null },
            minimapRef: { current: null as HTMLCanvasElement | null },
            selectedNodeIdRef: { current: null as string | null },
            setSelectedNodeId,
            setExpandedClusters: vi.fn(),
            setHighlightedType,
            onNodeClick: vi.fn(),
            onNodeDoubleClick: undefined as ((id: string) => void) | undefined,
        };

        attachSigmaEvents(renderer, g, callbacks);

        eventHandlers['downNode']({ node: 'src/foo.ts', preventSigmaDefault: vi.fn() });
        eventHandlers['clickNode']({ node: 'src/foo.ts', preventSigmaDefault: vi.fn() });
        eventHandlers['clickStage']({});

        expect(setSelectedNodeId).not.toHaveBeenCalledWith(null);
        expect(setHighlightedType).not.toHaveBeenCalled();
    });

    it('clears selection on plain stage click (no preceding node click)', () => {
        const eventHandlers: Record<string, (...a: unknown[]) => void> = {};
        const renderer = makeMockRenderer(eventHandlers);
        const g = makeMockGraph();
        const setSelectedNodeId = vi.fn();
        const setHighlightedType = vi.fn();
        const callbacks = {
            containerRef: { current: document.createElement('div') },
            isDraggingRef: { current: false },
            isOverNodeRef: { current: false },
            graphRef: { current: null as Graph | null },
            minimapRef: { current: null as HTMLCanvasElement | null },
            selectedNodeIdRef: { current: null as string | null },
            setSelectedNodeId,
            setExpandedClusters: vi.fn(),
            setHighlightedType,
            onNodeClick: vi.fn(),
            onNodeDoubleClick: undefined as ((id: string) => void) | undefined,
        };

        attachSigmaEvents(renderer, g, callbacks);
        eventHandlers['clickStage']({});

        expect(setSelectedNodeId).toHaveBeenCalledWith(null);
        expect(setHighlightedType).toHaveBeenCalledWith(null);
    });
});
