/**
 * Hybrid Retriever
 *
 * Combines BM25 full-text search (SQLite FTS4) with dependency-graph 2-hop walks
 * to retrieve the most contextually relevant file chunks for a user query.
 * Results are merged using Reciprocal Rank Fusion and packed into a text budget.
 *
 * NOTE: No vscode imports — pure TypeScript, fully testable outside the extension host.
 */

import { formatReportForAI } from '../analyzers/index';
import type { RepoDatabase } from '../db/RepoDatabase';
import type { AnalysisReport } from '../types';

/** K constant for Reciprocal Rank Fusion — higher values flatten score differences. */
const RRF_K = 60;

/** A retrieved chunk with its metadata and relevance score. */
export interface RetrievedChunk {
    path: string;
    chunkId: string;
    content: string;
    symbolName?: string;
    lineStart: number;
    lineEnd: number;
    /** Negative FTS4 match-order proxy, or 0 for graph-walk results. */
    score: number;
}

/**
 * Merge multiple ranked lists using Reciprocal Rank Fusion.
 * Items appearing across multiple lists receive a higher combined score.
 *
 * @param rankedLists - Each list is ordered best-first (index 0 = best).
 * @returns Merged list ordered best-first by accumulated RRF score.
 */
export function reciprocalRankFusion(rankedLists: string[][]): string[] {
    if (rankedLists.length === 0) return [];

    const scores = new Map<string, number>();

    for (const list of rankedLists) {
        for (let rank = 0; rank < list.length; rank++) {
            const item = list[rank];
            const contribution = 1 / (RRF_K + rank + 1);
            scores.set(item, (scores.get(item) ?? 0) + contribution);
        }
    }

    return [...scores.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([item]) => item);
}

/**
 * Pack chunks into a single context string respecting the char budget.
 * Chunks are taken in rankedOrder order until the budget is exhausted.
 *
 * @param rankedOrder - Chunk IDs ordered best-first.
 * @param chunkMap - Map of chunkId → RetrievedChunk.
 * @param budget - Maximum number of characters in the output.
 */
export function packChunksToContext(
    rankedOrder: string[],
    chunkMap: Map<string, RetrievedChunk>,
    budget: number
): string {
    const sections: string[] = [];
    let used = 0;

    for (const chunkId of rankedOrder) {
        const chunk = chunkMap.get(chunkId);
        if (!chunk) continue;

        const header = `## ${chunk.path}${chunk.symbolName ? ` (${chunk.symbolName})` : ''} [L${chunk.lineStart}-${chunk.lineEnd}]\n`;
        const block = header + chunk.content + '\n\n';

        if (used + block.length > budget) break;
        sections.push(block);
        used += block.length;
    }

    return sections.join('');
}

/**
 * Retrieve the most contextually relevant context string for a query.
 *
 * Pipeline:
 * 1. BM25 search via FTS4 → top 20 chunk IDs
 * 2. 2-hop graph walk from entry files → neighbor file paths
 * 3. Reciprocal Rank Fusion of both ranked lists
 * 4. Pack top chunks into the char budget
 *
 * Falls back to formatReportForAI if the DB is unavailable or throws.
 *
 * @param query - The user query for this tour.
 * @param db - Open RepoDatabase instance (must already be open).
 * @param report - The current analysis report (used for graph walk seeds + fallback).
 * @param budget - Maximum characters for the returned context string.
 */
export async function retrieveContext(
    query: string,
    db: RepoDatabase,
    report: AnalysisReport,
    budget: number
): Promise<string> {
    try {
        // ── BM25 path ──────────────────────────────────────────────────
        const bm25Results = db.searchBM25(query, 20);
        const bm25Ids = bm25Results.map((r) => r.chunkId);

        // ── Graph walk path ────────────────────────────────────────────
        const entryFiles = report.entryPoints.map((ep) => ep.file);
        const graphNeighbors = db.get2HopNeighbors(entryFiles);
        // Convert file paths to chunk IDs for the graph path — pick the whole-file chunk if no symbol chunks.
        const graphIds = graphNeighbors.map((p) => `${p}::__file__`);

        // ── Fusion ─────────────────────────────────────────────────────
        const rankedIds = reciprocalRankFusion([bm25Ids, graphIds]);

        // Build a lookup map from the BM25 result set — content is now returned by searchBM25.
        const chunkMap = new Map<string, RetrievedChunk>();
        for (const r of bm25Results) {
            chunkMap.set(r.chunkId, r);
        }

        // Pack top chunks until budget is consumed.
        const packed = packChunksToContext(rankedIds, chunkMap, budget);
        if (packed.length > 0) {
            return packed;
        }
    } catch {
        // Any error in the retrieval path degrades to the legacy formatter.
    }

    // Fallback: legacy report formatter (safe, always works).
    return formatReportForAI(report, budget);
}
