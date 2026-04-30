import type { FileCategory } from '../../shared/types';
import type { BoundaryRole } from '../types';
import type { FileClassification, ImportEdge } from '../types';

/** Maps a BoundaryRole to the most appropriate FileCategory for a file that primarily uses that boundary. */
const BOUNDARY_TO_CATEGORY: Record<BoundaryRole, FileCategory> = {
    persistence:            'service',    // CRUD/DAO files call the DB — DAOs are service-like; model directories already caught by Pass 1
    http:                  'service',    // covers server-framework users (fastapi, express) and HTTP clients (requests, axios)
    messaging:             'service',    // messaging adapters are service-adjacent
    auth:                  'middleware', // auth packages live in middleware/guard layer
    validation:            'model',      // validation schemas (pydantic BaseModel) are model-adjacent
    observability:         'utility',    // logging/metrics/tracing
    'external-integration': 'service',  // third-party integrations are service-level
};

/** Extracts the bare package name from a full specifier such as `node_modules/express` or `express`. */
function extractPackageName(specifier: string): string {
    const nm = specifier.replace(/^.*node_modules\//, '');
    if (nm.startsWith('@')) {
        return nm.split('/').slice(0, 2).join('/');
    }
    return nm.split('/')[0];
}

/**
 * Pass 3 — Enriches file classifications using import-edge boundary role signals.
 *
 * Only upgrades entries that Pass 1 (path patterns) and Pass 2 (content signals) left as `unknown`.
 * Never modifies entries with medium or high confidence (Pass 1/2 results are authoritative).
 * Upgrade confidence is set to `low` — boundary role inference is heuristic.
 *
 * @param classifications  Output of Pass 1 + 2 (from classifyFiles + enrichWithContentSignals)
 * @param edges            Import edges from analyzeImports (same run)
 * @param lookup           Package-name → BoundaryRole lookup (boundaryRoleLookup)
 */
export function enrichWithBoundarySignals(
    classifications: FileClassification[],
    edges: ImportEdge[],
    lookup: Map<string, BoundaryRole>,
): FileClassification[] {
    // Build a file → outgoing target packages map
    const filePackages = new Map<string, string[]>();
    for (const edge of edges) {
        const pkg = extractPackageName(edge.target);
        if (!filePackages.has(edge.source)) filePackages.set(edge.source, []);
        filePackages.get(edge.source)!.push(pkg);
    }

    return classifications.map((c) => {
        // Only upgrade files Pass 1 + 2 couldn't classify
        if (c.category !== 'unknown') return c;

        const packages = filePackages.get(c.path);
        if (!packages || packages.length === 0) return c;

        // Count matches per role
        const roleCounts = new Map<BoundaryRole, number>();
        for (const pkg of packages) {
            const role = lookup.get(pkg);
            if (role) roleCounts.set(role, (roleCounts.get(role) ?? 0) + 1);
        }

        if (roleCounts.size === 0) return c;

        // Pick the dominant role (highest count); first-seen wins on ties
        let dominantRole: BoundaryRole | null = null;
        let maxCount = 0;
        for (const [role, count] of roleCounts) {
            if (count > maxCount) {
                maxCount = count;
                dominantRole = role;
            }
        }

        if (!dominantRole) return c;

        const category = BOUNDARY_TO_CATEGORY[dominantRole];
        return {
            ...c,
            category,
            confidence: 'low' as const,
            reason: `Pass 3 boundary signal: imports ${dominantRole} package`,
        };
    });
}
