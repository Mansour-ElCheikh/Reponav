import type { SymbolInfo, SymbolEdge, BoundaryRoleAnnotation } from '../types';

/** A symbol identified as a dead code candidate. */
export interface DeadCodeCandidate {
    symbolName: string;
    filePath: string;
    lineStart: number;
    reason: string;
    confidence: number;
}

/**
 * Collects all symbol names that appear as callees (targets) in the edge list.
 * A symbol with at least one incoming edge has a caller and is not dead.
 */
export function collectCalleeIds(edges: SymbolEdge[]): Set<string> {
    const ids = new Set<string>();
    for (const e of edges) {
        ids.add(e.targetName);
    }
    return ids;
}

// Pass 1: exclude symbols that appear as a callee in any edge
function filterHasCallers(symbols: SymbolInfo[], calleeIds: Set<string>): SymbolInfo[] {
    return symbols.filter(s => !calleeIds.has(s.name));
}

// Pass 2: exclude exported symbols
function filterExported(symbols: SymbolInfo[]): SymbolInfo[] {
    return symbols.filter(s => !s.isExported);
}

// Pass 3: exclude symbols explicitly marked as entry points by the analyzer
function filterEntryPoints(symbols: SymbolInfo[]): SymbolInfo[] {
    return symbols.filter(s => !s.isEntryPoint);
}

// Pass 4: exclude symbols in http or persistence boundary files
function filterBoundaryRoles(symbols: SymbolInfo[], boundaryRoles: BoundaryRoleAnnotation[]): SymbolInfo[] {
    const boundaryFiles = new Set(
        boundaryRoles
            .filter(r => r.role === 'http' || r.role === 'persistence')
            .map(r => r.filePath)
    );
    return symbols.filter(s => !boundaryFiles.has(s.filePath));
}

// Pass 5: exclude test-only symbols
const TEST_PATH_RE = /\.test\.[jt]sx?$|\.spec\.[jt]sx?$|(^|\/)test\/|(^|\/)__tests__\//;

function filterTestFiles(symbols: SymbolInfo[]): SymbolInfo[] {
    return symbols.filter(s => !TEST_PATH_RE.test(s.filePath));
}

// Pass 6: exclude structural types (type aliases, interfaces — not callable at runtime)
function filterStructuralKinds(symbols: SymbolInfo[]): SymbolInfo[] {
    return symbols.filter(s => s.kind !== 'type_alias' && s.kind !== 'interface');
}

// Pass 7: exclude node_modules symbols
function filterNodeModules(symbols: SymbolInfo[]): SymbolInfo[] {
    return symbols.filter(s => !s.filePath.includes('node_modules/'));
}

// Pass 8: exclude class members (methods, constructors) — they are called via
// object instances, so name-based callee tracking will always miss them.
// A symbol with parentSymbol set is a class member, never a standalone dead symbol.
function filterClassMembers(symbols: SymbolInfo[]): SymbolInfo[] {
    return symbols.filter(s => !s.parentSymbol);
}

/**
 * Computes dead code candidates from symbol + edge + boundary data.
 *
 * Applies seven sequential exclusion passes:
 *   1. Symbols with at least one incoming edge (have callers)
 *   2. Exported symbols
 *   3. Entry-point file symbols
 *   4. http / persistence boundary-role file symbols
 *   5. Test-only file symbols
 *   6. Structural kinds (type_alias, interface)
 *   7. node_modules symbols
 *   8. Class members (parentSymbol set — called via instance, not by name)
 *
 * Returns `DeadCodeCandidate[]` for each surviving symbol.
 * Precision >= 0.85, Recall >= 0.70 on a representative 20-symbol fixture.
 * P95 <= 500ms for 1,000 symbols / 2,000 edges.
 */
export function computeDeadCode(
    symbols: SymbolInfo[],
    edges: SymbolEdge[],
    boundaryRoles: BoundaryRoleAnnotation[]
): DeadCodeCandidate[] {
    const calleeIds = collectCalleeIds(edges);

    let remaining = filterHasCallers(symbols, calleeIds);
    remaining = filterExported(remaining);
    remaining = filterEntryPoints(remaining);
    remaining = filterBoundaryRoles(remaining, boundaryRoles);
    remaining = filterTestFiles(remaining);
    remaining = filterStructuralKinds(remaining);
    remaining = filterNodeModules(remaining);
    remaining = filterClassMembers(remaining);

    return remaining.map(s => ({
        symbolName: s.name,
        filePath: s.filePath,
        lineStart: s.lineStart,
        reason: 'no callers, not exported, not entry point, not boundary endpoint',
        confidence: 1,
    }));
}
