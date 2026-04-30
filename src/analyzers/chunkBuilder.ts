/**
 * Chunk Builder
 *
 * Splits workspace files into semantic chunks for BM25 indexing.
 * When tree-sitter symbol data is available, each exported function/class/interface
 * becomes its own chunk. Files with no symbol coverage fall back to a single
 * whole-file chunk.
 *
 * NOTE: No vscode imports — pure TypeScript, fully testable outside the extension host.
 */

import type { SymbolInfo } from '../types';

/** A semantic chunk derived from a single file. */
export interface FileChunk {
    /** Workspace-relative file path. */
    path: string;
    /** Stable unique identifier: "<path>::<symbolName>" or "<path>::__file__". */
    chunkId: string;
    /** Text content of the chunk (function/class body or whole file). */
    content: string;
    /** Symbol name if this chunk maps to a single symbol, undefined for whole-file chunks. */
    symbolName?: string;
    /** 1-based line range start (inclusive). */
    lineStart: number;
    /** 1-based line range end (inclusive). */
    lineEnd: number;
}

/**
 * Build semantic chunks from a map of file contents and extracted symbol data.
 *
 * For each file: if symbols exist for that file, one chunk is produced per symbol
 * using the symbol's line range. If no symbols cover a file, a single whole-file
 * chunk is produced.
 *
 * @param files - Map of workspace-relative path → file content.
 * @param symbols - Symbol metadata from symbolExtractor (may be empty).
 */
export function buildChunks(
    files: Map<string, string>,
    symbols: SymbolInfo[]
): FileChunk[] {
    // Group symbols by file for O(1) lookup.
    const symbolsByFile = new Map<string, SymbolInfo[]>();
    for (const symbol of symbols) {
        const existing = symbolsByFile.get(symbol.filePath) ?? [];
        existing.push(symbol);
        symbolsByFile.set(symbol.filePath, existing);
    }

    const chunks: FileChunk[] = [];

    for (const [filePath, content] of files) {
        const fileSymbols = symbolsByFile.get(filePath);

        if (fileSymbols && fileSymbols.length > 0) {
            // Produce one chunk per symbol.
            for (const symbol of fileSymbols) {
                const lines = content.split('\n');
                // lineStart/lineEnd are 1-based from the extractor.
                const start = Math.max(0, symbol.lineStart - 1);
                const end = Math.min(lines.length, symbol.lineEnd);
                const chunkContent = lines.slice(start, end).join('\n');

                chunks.push({
                    path: filePath,
                    chunkId: `${filePath}::${symbol.name}`,
                    content: chunkContent,
                    symbolName: symbol.name,
                    lineStart: symbol.lineStart,
                    lineEnd: symbol.lineEnd,
                });
            }
        } else {
            // Whole-file fallback.
            const lineCount = content.split('\n').length;
            chunks.push({
                path: filePath,
                chunkId: `${filePath}::__file__`,
                content,
                symbolName: undefined,
                lineStart: 1,
                lineEnd: lineCount,
            });
        }
    }

    return chunks;
}
