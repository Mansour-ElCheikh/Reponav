/**
 * Symbol Extractor
 *
 * Thin facade over symbolWalkers.ts. Exports the public API:
 * extractSymbols and traceSymbolEdges. All walker implementations
 * live in symbolWalkers.ts.
 *
 * NO vscode imports. Fully testable outside VS Code.
 */

import type * as webTreeSitter from 'web-tree-sitter';
import type { SymbolInfo, SymbolEdge, ImportEdge } from '../types';
import {
    walkJsTsSymbols,
    walkPythonSymbols,
    walkGoSymbols,
    traceJsTsEdges,
    tracePythonEdges,
    traceGoEdges,
} from './symbolWalkers';

export type { SupportedLang } from './symbolWalkers';

// --- Symbol Extraction -------------------------------------------------------

/**
 * Extract all symbols (functions, classes, interfaces, etc.) from a parsed AST.
 * Returns an array of SymbolInfo with line ranges and export status.
 */
export function extractSymbols(
    tree: webTreeSitter.Tree,
    filePath: string,
    language: import('./symbolWalkers').SupportedLang
): SymbolInfo[] {
    const symbols: SymbolInfo[] = [];
    if (language === 'python') {
        walkPythonSymbols(tree.rootNode, filePath, symbols, undefined);
    } else if (language === 'go') {
        walkGoSymbols(tree.rootNode, filePath, symbols);
    } else {
        walkJsTsSymbols(tree.rootNode, filePath, symbols, undefined);
    }
    return symbols;
}

// --- Edge Tracing ------------------------------------------------------------

/**
 * Trace cross-file symbol edges (calls, extends, implements) from a parsed AST.
 *
 * Requires a pre-built symbol index (Map<symbolName, SymbolInfo[]>) and
 * the import edges for this file to resolve which file a called symbol belongs to.
 */
export function traceSymbolEdges(
    tree: webTreeSitter.Tree,
    filePath: string,
    language: import('./symbolWalkers').SupportedLang,
    symbolIndex: Map<string, SymbolInfo[]>,
    importEdges: ImportEdge[]
): SymbolEdge[] {
    const edges: SymbolEdge[] = [];

    const importedFrom = new Map<string, string>();
    for (const edge of importEdges) {
        if (edge.source !== filePath) continue;
        for (const spec of edge.specifiers) {
            importedFrom.set(spec, edge.target);
        }
    }

    if (language === 'python') {
        tracePythonEdges(tree.rootNode, filePath, symbolIndex, importedFrom, edges);
    } else if (language === 'go') {
        traceGoEdges(tree.rootNode, filePath, symbolIndex, importedFrom, edges);
    } else {
        traceJsTsEdges(tree.rootNode, filePath, symbolIndex, importedFrom, edges);
    }

    return edges;
}

// --- Range Mapping (v2.0) ----------------------------------------------------

/**
 * Find all symbols that overlap with a given line range.
 * Useful for mapping git diff hunks to specific functions/classes.
 */
export function findSymbolsAtRange(
    symbols: SymbolInfo[],
    startLine: number,
    endLine: number
): SymbolInfo[] {
    return symbols.filter(s => {
        const symStart = s.lineStart;
        const symEnd = s.lineEnd;

        // Check for any overlap between [startLine, endLine] and [symStart, symEnd]
        return (
            (symStart <= startLine && symEnd >= startLine) || // sym contains start
            (symStart <= endLine && symEnd >= endLine) ||     // sym contains end
            (startLine <= symStart && endLine >= symEnd)      // range contains sym
        );
    });
}
