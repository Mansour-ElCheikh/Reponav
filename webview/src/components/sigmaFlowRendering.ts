export type FlowRenderingStrategy = 'canvas-plus-overlay';

const DEFAULT_FLOW_RENDERING_STRATEGY: FlowRenderingStrategy = 'canvas-plus-overlay';

/** Returns the single supported dotted-flow rendering strategy. */
export function getDefaultFlowRenderingStrategy(): FlowRenderingStrategy {
    return DEFAULT_FLOW_RENDERING_STRATEGY;
}

/** The animated overlay is shown whenever the user enables flow edges and paths exist. */
export function shouldRenderAnimatedFlowOverlay(
    _strategy: FlowRenderingStrategy,
    showFlowEdges: boolean,
    pathCount: number,
): boolean {
    return showFlowEdges && pathCount > 0;
}
