/**
 * Pass 4 — Graph-Structural File Classifier
 *
 * Infers FileCategory for remaining `unknown`-classified files using
 * import-graph topology. Runs after Pass 3 (boundary signal enrichment).
 * Pure function — no I/O, no VS Code dependency.
 *
 * Heuristics (in confidence order):
 *   1. High fanIn + zero fanOut → utility (medium)
 *   2. Sole external SDK importer → service (medium)
 *   3. Type-only exports → type (medium)
 *   4. Imported only by tests → utility (low)
 *   5. Majority-neighbor category propagation (low)
 *   6. Entry-adjacent single import → config (low)
 */
import type { FileCategory } from '../../shared/types';
import type { FileClassification, ImportEdge } from '../types';

// ─── Internal types ──────────────────────────────────────────────────────────

// A candidate classification from a single heuristic
interface Candidate {
    category: FileCategory;
    confidence: 'medium' | 'low';
    reason: string;
}

// Confidence rank for tie-breaking
const CONFIDENCE_RANK: Record<string, number> = { medium: 2, low: 1 };

// Category specificity for tie-breaking (higher = more specific)
const CATEGORY_SPECIFICITY: Partial<Record<FileCategory, number>> = {
    service: 5,
    type: 4,
    config: 3,
    model: 3,
    middleware: 3,
    component: 3,
    utility: 2,
    unknown: 0,
};

const HIGH_FAN_IN_THRESHOLD = 3;
const NEIGHBOR_MAJORITY_THRESHOLD = 0.6;
const PERCENTAGE_SCALE = 100;

// ─── Graph index builders ────────────────────────────────────────────────────

// Build adjacency maps from edges
function buildGraphIndex(edges: ImportEdge[]) {
    const importers = new Map<string, ImportEdge[]>();   // target → edges importing it
    const imports = new Map<string, ImportEdge[]>();      // source → edges it creates
    const externalPackages = new Map<string, Set<string>>(); // package → set of source files

    for (const e of edges) {
        if (!importers.has(e.target)) importers.set(e.target, []);
        importers.get(e.target)!.push(e);

        if (!imports.has(e.source)) imports.set(e.source, []);
        imports.get(e.source)!.push(e);

        // Track external packages (no path separator = external)
        if (!e.target.includes('/') || e.target.startsWith('node_modules')) {
            const pkg = extractPackageName(e.target);
            if (!externalPackages.has(pkg)) externalPackages.set(pkg, new Set());
            externalPackages.get(pkg)!.add(e.source);
        }
    }

    return { importers, imports, externalPackages };
}

// Extract bare package name
function extractPackageName(specifier: string): string {
    const nm = specifier.replace(/^.*node_modules\//, '');
    if (nm.startsWith('@')) return nm.split('/').slice(0, 2).join('/');
    return nm.split('/')[0];
}

// ─── Heuristics ──────────────────────────────────────────────────────────────

// H1: high-fanIn + zero-fanOut → utility
function h1HighFanInSink(
    filePath: string,
    importersMap: Map<string, ImportEdge[]>,
    importsMap: Map<string, ImportEdge[]>,
): Candidate | null {
    const inEdges = importersMap.get(filePath) ?? [];
    const outEdges = importsMap.get(filePath) ?? [];
    if (inEdges.length >= HIGH_FAN_IN_THRESHOLD && outEdges.length === 0) {
        return { category: 'utility', confidence: 'medium', reason: `graph: high fanIn (${inEdges.length}), zero fanOut → utility` };
    }
    return null;
}

// H2: sole external SDK importer → service
function h2SoleExternalImporter(
    filePath: string,
    importsMap: Map<string, ImportEdge[]>,
    externalPackages: Map<string, Set<string>>,
): Candidate | null {
    const outEdges = importsMap.get(filePath) ?? [];
    for (const e of outEdges) {
        if (!e.target.includes('/') || e.target.startsWith('node_modules')) {
            const pkg = extractPackageName(e.target);
            const consumers = externalPackages.get(pkg);
            if (consumers && consumers.size === 1 && consumers.has(filePath)) {
                return { category: 'service', confidence: 'medium', reason: `graph: sole importer of external package '${pkg}' → service` };
            }
        }
    }
    return null;
}

// H3: type-only exports → type
function h3TypeOnly(
    filePath: string,
    importersMap: Map<string, ImportEdge[]>,
): Candidate | null {
    const inEdges = importersMap.get(filePath) ?? [];
    if (inEdges.length === 0) return null;
    const allTypeOnly = inEdges.every(e => /\bimport\s+type\b/.test(e.rawStatement));
    if (allTypeOnly) {
        return { category: 'type', confidence: 'medium', reason: 'graph: all imports are type-only → type' };
    }
    return null;
}

// H4: imported only by tests → utility (test helper)
function h4TestOnly(
    filePath: string,
    importersMap: Map<string, ImportEdge[]>,
    classMap: Map<string, FileClassification>,
): Candidate | null {
    const inEdges = importersMap.get(filePath) ?? [];
    if (inEdges.length === 0) return null;
    const allTest = inEdges.every(e => {
        const cls = classMap.get(e.source);
        return (cls && cls.category === 'test') || /\.test\.|\.spec\./.test(e.source);
    });
    if (allTest) {
        return { category: 'utility', confidence: 'low', reason: 'graph: imported only by test files → utility (test helper)' };
    }
    return null;
}

// H5: majority-neighbor category propagation
function h5NeighborPropagation(
    filePath: string,
    importersMap: Map<string, ImportEdge[]>,
    importsMap: Map<string, ImportEdge[]>,
    classMap: Map<string, FileClassification>,
): Candidate | null {
    // Collect all neighbors (both importers and imports)
    const neighborPaths = new Set<string>();
    for (const e of (importersMap.get(filePath) ?? [])) neighborPaths.add(e.source);
    for (const e of (importsMap.get(filePath) ?? [])) neighborPaths.add(e.target);

    // Count non-unknown categories
    const categoryCounts = new Map<FileCategory, number>();
    let nonUnknownCount = 0;
    for (const n of neighborPaths) {
        const cls = classMap.get(n);
        if (cls && cls.category !== 'unknown') {
            categoryCounts.set(cls.category, (categoryCounts.get(cls.category) ?? 0) + 1);
            nonUnknownCount++;
        }
    }

    if (nonUnknownCount === 0) return null;

    // Find the most common category
    let maxCat: FileCategory = 'unknown';
    let maxCount = 0;
    for (const [cat, count] of categoryCounts) {
        if (count > maxCount) { maxCat = cat; maxCount = count; }
    }

    // ≥60% threshold
    if (maxCount / nonUnknownCount >= NEIGHBOR_MAJORITY_THRESHOLD) {
        return { category: maxCat, confidence: 'low', reason: `graph: ${Math.round(maxCount / nonUnknownCount * PERCENTAGE_SCALE)}% of neighbors are '${maxCat}' → propagated` };
    }
    return null;
}

// H6: entry-adjacent single-import → config
function h6EntryAdjacent(
    filePath: string,
    importersMap: Map<string, ImportEdge[]>,
    importsMap: Map<string, ImportEdge[]>,
    classMap: Map<string, FileClassification>,
): Candidate | null {
    const inEdges = importersMap.get(filePath) ?? [];
    const outEdges = importsMap.get(filePath) ?? [];

    // Must be imported by exactly 1 file, that file must be 'entry', and import nothing
    if (inEdges.length !== 1 || outEdges.length !== 0) return null;
    const importerCls = classMap.get(inEdges[0].source);
    if (importerCls && importerCls.category === 'entry') {
        return { category: 'config', confidence: 'low', reason: 'graph: imported only by entry file, imports nothing → config' };
    }
    return null;
}

// ─── Main classifier function ────────────────────────────────────────────────

/**
 * Pass 4 — Enrich file classifications using import-graph structural heuristics.
 *
 * Only upgrades entries with category `unknown`. Never overrides existing
 * classifications from Pass 1/2/3. When multiple heuristics fire for the same
 * file, highest confidence wins; ties favor the more specific category.
 *
 * @param classifications  Output of Pass 1 + 2 + 3
 * @param edges            Import edges from analyzeImports
 * @returns Enriched classifications array (same length, same order)
 */
export function enrichWithGraphStructure(
    classifications: FileClassification[],
    edges: ImportEdge[],
): FileClassification[] {
    const { importers, imports, externalPackages } = buildGraphIndex(edges);
    const classMap = new Map<string, FileClassification>(classifications.map(c => [c.path, c]));

    return classifications.map((c) => {
        // Guard: never override non-unknown
        if (c.category !== 'unknown') return c;

        // Collect all heuristic candidates
        const candidates: Candidate[] = [];

        const c1 = h1HighFanInSink(c.path, importers, imports);
        if (c1) candidates.push(c1);

        const c2 = h2SoleExternalImporter(c.path, imports, externalPackages);
        if (c2) candidates.push(c2);

        const c3 = h3TypeOnly(c.path, importers);
        if (c3) candidates.push(c3);

        const c4 = h4TestOnly(c.path, importers, classMap);
        if (c4) candidates.push(c4);

        const c5 = h5NeighborPropagation(c.path, importers, imports, classMap);
        if (c5) candidates.push(c5);

        const c6 = h6EntryAdjacent(c.path, importers, imports, classMap);
        if (c6) candidates.push(c6);

        if (candidates.length === 0) return c;

        // Resolve: highest confidence wins, ties favor most specific category
        candidates.sort((a, b) => {
            const confDiff = (CONFIDENCE_RANK[b.confidence] ?? 0) - (CONFIDENCE_RANK[a.confidence] ?? 0);
            if (confDiff !== 0) return confDiff;
            return (CATEGORY_SPECIFICITY[b.category] ?? 0) - (CATEGORY_SPECIFICITY[a.category] ?? 0);
        });

        const winner = candidates[0];
        return { ...c, category: winner.category, confidence: winner.confidence, reason: winner.reason };
    });
}
