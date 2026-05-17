import type { FileCategory, GraphEdge, GraphNode, Tour } from '../types';

// Resolve the immediate parent directory for a file node id.
function getDir(filePath: string): string {
    const parts = filePath.split('/');
    return parts.length > 1 ? parts.slice(0, -1).join('/') : '.';
}

// Create the stable cluster id used by directory grouping.
function clusterIdFor(dir: string): string {
    return `cluster::${dir}`;
}

/**
 * Collapse file nodes into directory cluster nodes.
 */
export function applyDirectoryClustering(tour: Tour, expandedClusters: Set<string>): Tour {
    const dirGroups = new Map<string, GraphNode[]>();
    for (const node of tour.graph.nodes) {
        const dir = getDir(node.id);
        if (!dirGroups.has(dir)) {
            dirGroups.set(dir, []);
        }
        dirGroups.get(dir)!.push(node);
    }

    const newNodes: GraphNode[] = [];
    const fileToOutputId = new Map<string, string>();

    for (const [dir, children] of dirGroups) {
        const clusterId = clusterIdFor(dir);
        const isExpanded = expandedClusters.has(clusterId);

        if (isExpanded || children.length === 1) {
            for (const child of children) {
                newNodes.push({ ...child, directory: dir });
                fileToOutputId.set(child.id, child.id);
            }
            continue;
        }

        const typeCounts = new Map<string, number>();
        let totalWeight = 0;
        for (const child of children) {
            typeCounts.set(child.type, (typeCounts.get(child.type) ?? 0) + 1);
            totalWeight += child.weight ?? 0;
        }

        const dominantType = [...typeCounts.entries()].sort((left, right) => right[1] - left[1])[0][0] as FileCategory;
        const dirLabel = dir.split('/').pop() || dir;

        newNodes.push({
            id: clusterId,
            label: dirLabel,
            type: dominantType,
            weight: totalWeight,
            isCluster: true,
            childCount: children.length,
            directory: dir,
        });

        for (const child of children) {
            fileToOutputId.set(child.id, clusterId);
        }
    }

    const edgeMap = new Map<string, GraphEdge>();
    for (const edge of tour.graph.edges) {
        const src = fileToOutputId.get(edge.source);
        const tgt = fileToOutputId.get(edge.target);
        if (!src || !tgt || src === tgt) {
            continue;
        }

        const key = `${src}→${tgt}`;
        if (!edgeMap.has(key)) {
            edgeMap.set(key, { source: src, target: tgt, label: edge.label, isCircular: edge.isCircular });
            continue;
        }

        if (edge.isCircular) {
            edgeMap.get(key)!.isCircular = true;
        }
    }

    return { ...tour, graph: { nodes: newNodes, edges: Array.from(edgeMap.values()) } };
}