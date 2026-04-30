import type { BoundaryRole, BoundaryRoleAnnotation, ImportEdge } from '../types';

/** Extracts the bare package name from a full specifier path such as `node_modules/express` or `express`. */
function extractPackageName(specifier: string): string {
    // strip leading node_modules/
    const nm = specifier.replace(/^.*node_modules\//, '');
    // handle scoped packages: @scope/name/deep → @scope/name
    if (nm.startsWith('@')) {
        const parts = nm.split('/');
        return parts.slice(0, 2).join('/');
    }
    // bare package: take first path segment only
    return nm.split('/')[0];
}

/**
 * Classifies files by architectural boundary role based on their import edges.
 *
 * For each source file, counts how many of its imports match each role in the lookup table.
 * Returns annotations for the winning role(s). Ties produce one annotation per tied role.
 * Files with no matching imports are omitted from the output.
 */
export function classifyBoundaryRoles(
    edges: ImportEdge[],
    lookup: Map<string, BoundaryRole>,
): BoundaryRoleAnnotation[] {
    // Group edges by source file
    const byFile = new Map<string, string[]>();
    for (const edge of edges) {
        const pkg = extractPackageName(edge.target);
        if (!byFile.has(edge.source)) {
            byFile.set(edge.source, []);
        }
        byFile.get(edge.source)!.push(pkg);
    }

    const annotations: BoundaryRoleAnnotation[] = [];

    for (const [filePath, packages] of byFile) {
        // Count matches per role
        const roleCounts = new Map<BoundaryRole, string[]>();
        for (const pkg of packages) {
            const role = lookup.get(pkg);
            if (role) {
                if (!roleCounts.has(role)) roleCounts.set(role, []);
                roleCounts.get(role)!.push(pkg);
            }
        }

        if (roleCounts.size === 0) continue;

        // Find max count
        let maxCount = 0;
        for (const pkgs of roleCounts.values()) {
            if (pkgs.length > maxCount) maxCount = pkgs.length;
        }

        // Emit one annotation per winning role
        for (const [role, pkgs] of roleCounts) {
            if (pkgs.length === maxCount) {
                annotations.push({
                    filePath,
                    role,
                    evidence: `imports ${pkgs[0]}`,
                });
            }
        }
    }

    return annotations;
}
