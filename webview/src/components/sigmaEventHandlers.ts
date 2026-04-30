import type Graph from 'graphology';
import type Sigma from 'sigma';

/** Callbacks and refs consumed by the event handler wiring layer. */
export interface SigmaEventCallbacks {
    containerRef: React.RefObject<HTMLDivElement | null>;
    isDraggingRef: React.MutableRefObject<boolean>;
    isOverNodeRef: React.MutableRefObject<boolean>;
    graphRef: React.MutableRefObject<Graph | null>;
    minimapRef: React.RefObject<HTMLCanvasElement | null>;
    selectedNodeIdRef: React.MutableRefObject<string | null>;
    setSelectedNodeId: React.Dispatch<React.SetStateAction<string | null>>;
    setExpandedClusters: React.Dispatch<React.SetStateAction<Set<string>>>;
    setHighlightedType: React.Dispatch<React.SetStateAction<string | null>>;
    onNodeClick: (nodeId: string) => void;
    onNodeDoubleClick?: (nodeId: string) => void;
}

/**
 * Wires all Sigma event handlers onto the given renderer.
 * Handles: cursor feedback, node selection, cluster expansion.
 * Returns a cleanup function that removes the global mouseup listener.
 */
export function attachSigmaEvents(
    renderer: Sigma,
    g: Graph,
    callbacks: SigmaEventCallbacks,
): () => void {
    const {
        containerRef, isDraggingRef, isOverNodeRef,
        setSelectedNodeId, setExpandedClusters,
        setHighlightedType, onNodeClick, onNodeDoubleClick,
    } = callbacks;

    const setCursor = (c: string) => { if (containerRef.current) containerRef.current.style.cursor = c; };
    setCursor('grab');

    renderer.on('enterNode', () => { isOverNodeRef.current = true; if (!isDraggingRef.current) setCursor('pointer'); });
    renderer.on('leaveNode', () => { isOverNodeRef.current = false; setCursor(isDraggingRef.current ? 'grabbing' : 'grab'); });
    renderer.on('downStage', () => { isDraggingRef.current = true; setCursor('grabbing'); });
    renderer.on('upStage', () => { isDraggingRef.current = false; setCursor(isOverNodeRef.current ? 'pointer' : 'grab'); });

    const onWindowMouseUp = () => {
        if (isDraggingRef.current) { isDraggingRef.current = false; if (!isOverNodeRef.current) setCursor('grab'); }
    };
    window.addEventListener('mouseup', onWindowMouseUp);

    let lastDownWasNode = false;

    renderer.on('downNode', (event: { node: string; preventSigmaDefault: () => void }) => {
        event.preventSigmaDefault();
        lastDownWasNode = true;
        const attrs = g.getNodeAttributes(event.node);
        if (attrs.isCluster) {
            setExpandedClusters((prev) => {
                const next = new Set(prev);
                if (next.has(event.node)) next.delete(event.node); else next.add(event.node);
                return next;
            });
            return;
        }
        setSelectedNodeId((prev) => (prev === event.node ? null : event.node));
        onNodeClick(event.node);
    });

    renderer.on('clickNode', (event: { node: string; preventSigmaDefault: () => void }) => {
        event.preventSigmaDefault();
        // Keep the sentinel until clickStage runs; some Sigma event orders emit
        // clickStage after clickNode for the same interaction.
    });

    renderer.on('doubleClickNode', (event: { node: string; preventSigmaDefault: () => void }) => {
        event.preventSigmaDefault();
        const attrs = g.getNodeAttributes(event.node);
        if (attrs.isCluster) return;
        setSelectedNodeId(event.node);
        onNodeDoubleClick?.(event.node);
    });

    renderer.on('clickStage', () => {
        if (lastDownWasNode) { lastDownWasNode = false; return; }
        setSelectedNodeId(null);
        setHighlightedType(null);
    });

    return () => { window.removeEventListener('mouseup', onWindowMouseUp); };
}
