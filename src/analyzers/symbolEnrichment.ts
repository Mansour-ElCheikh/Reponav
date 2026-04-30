import * as crypto from 'crypto';
import * as path from 'path';
import type { AnalysisReport, EntryPoint, SymbolInfo, SymbolKind } from '../types';

const SYMBOL_ENRICHMENT_EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.py']);
const DEFAULT_ENRICHMENT_CONCURRENCY = 8;

/** Host-provided, best-effort symbol enricher used only after deterministic Tier 2 completes. */
export interface SymbolEnricher {
    enrichDocumentSymbols(relativePath: string, content: string): Promise<SymbolInfo[]>;
}

export interface EnrichAnalysisReportOptions {
    maxConcurrency?: number;
    priorityPaths?: string[];
    getCachedSymbols?: (filePath: string, contentHash: string) => SymbolInfo[] | undefined;
    storeCachedSymbols?: (filePath: string, contentHash: string, symbols: SymbolInfo[]) => void;
}

/** Returns true when a file is eligible for optional symbol enrichment. */
export function isSymbolEnrichmentCandidate(filePath: string): boolean {
    return SYMBOL_ENRICHMENT_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

/** Merge overlay symbols into deterministic symbols without changing symbol identity. */
export function mergeSymbolEnrichment(
    baseSymbols: NonNullable<AnalysisReport['symbols']>,
    enrichedSymbols: NonNullable<AnalysisReport['symbols']>,
    entryPoints: EntryPoint[]
): NonNullable<AnalysisReport['symbols']> {
    const entryPointFiles = new Set(entryPoints.map((entryPoint) => entryPoint.file));
    const merged = new Map<string, NonNullable<AnalysisReport['symbols']>[number]>();

    const upsert = (symbol: NonNullable<AnalysisReport['symbols']>[number]) => {
        const normalized = {
            ...symbol,
            isEntryPoint: symbol.isEntryPoint || entryPointFiles.has(symbol.filePath),
        };
        const key = [
            normalized.filePath,
            normalized.name,
            normalized.kind,
            normalized.parentSymbol ?? '',
            normalized.lineStart,
        ].join('::');

        const existing = merged.get(key);
        if (!existing) {
            merged.set(key, normalized);
            return;
        }

        merged.set(key, {
            ...existing,
            signature: existing.signature ?? normalized.signature,
            isExported: existing.isExported || normalized.isExported,
            isEntryPoint: existing.isEntryPoint || normalized.isEntryPoint,
        });
    };

    for (const symbol of baseSymbols) upsert(symbol);
    for (const symbol of enrichedSymbols) upsert(symbol);

    return [...merged.values()].sort((a, b) => {
        const fileDiff = a.filePath.localeCompare(b.filePath);
        if (fileDiff !== 0) return fileDiff;
        const lineDiff = a.lineStart - b.lineStart;
        if (lineDiff !== 0) return lineDiff;
        return a.name.localeCompare(b.name);
    });
}

/**
 * Enrich an existing Tier 2 report with host-provided symbol metadata.
 * The returned report keeps deterministic structure intact and only overlays symbol metadata.
 */
export async function enrichAnalysisReport(
    report: AnalysisReport,
    files: Map<string, string>,
    enricher: SymbolEnricher,
    options: EnrichAnalysisReportOptions = {}
): Promise<AnalysisReport> {
    const candidatePaths = prioritizeCandidatePaths(files, options.priorityPaths);
    const enrichedSymbols = await collectSymbolEnrichment(candidatePaths, files, enricher, options);
    const mergedSymbols = mergeSymbolEnrichment(report.symbols ?? [], enrichedSymbols, report.entryPoints);

    return {
        ...report,
        symbols: mergedSymbols,
        ...(report.symbolMetrics
            ? {
                symbolMetrics: {
                    ...report.symbolMetrics,
                    totalSymbols: mergedSymbols.length,
                    symbolsByKind: countSymbolsByKind(mergedSymbols),
                },
            }
            : {}),
    };
}

async function collectSymbolEnrichment(
    filePaths: string[],
    files: Map<string, string>,
    enricher: SymbolEnricher,
    options: EnrichAnalysisReportOptions
): Promise<SymbolInfo[]> {
    if (filePaths.length === 0) {
        return [];
    }

    const maxConcurrency = Math.max(1, Math.min(options.maxConcurrency ?? DEFAULT_ENRICHMENT_CONCURRENCY, filePaths.length));
    const enrichedSymbols: SymbolInfo[] = [];
    let nextIndex = 0;

    const worker = async () => {
        while (nextIndex < filePaths.length) {
            const currentIndex = nextIndex;
            nextIndex += 1;
            const filePath = filePaths[currentIndex];
            const content = files.get(filePath) ?? '';
            const contentHash = hashContent(content);
            const cachedSymbols = options.getCachedSymbols?.(filePath, contentHash);

            if (cachedSymbols) {
                enrichedSymbols.push(...cachedSymbols);
                continue;
            }

            try {
                const fileSymbols = await enricher.enrichDocumentSymbols(filePath, content);
                options.storeCachedSymbols?.(filePath, contentHash, fileSymbols);
                if (fileSymbols.length > 0) {
                    enrichedSymbols.push(...fileSymbols);
                }
            } catch {
                // Host enrichment remains best-effort and never blocks deterministic analysis.
            }
        }
    };

    await Promise.all(Array.from({ length: maxConcurrency }, () => worker()));
    return enrichedSymbols;
}

function prioritizeCandidatePaths(
    files: Map<string, string>,
    priorityPaths?: string[]
): string[] {
    const prioritySet = new Set((priorityPaths ?? []).filter((filePath) => isSymbolEnrichmentCandidate(filePath)));
    const allCandidates = Array.from(files.keys()).filter((filePath) => isSymbolEnrichmentCandidate(filePath));
    const prioritized = [...prioritySet].filter((filePath) => files.has(filePath));

    for (const filePath of allCandidates) {
        if (!prioritySet.has(filePath)) {
            prioritized.push(filePath);
        }
    }

    return prioritized;
}

function hashContent(content: string): string {
    return crypto.createHash('sha1').update(content).digest('hex');
}

function countSymbolsByKind(symbols: SymbolInfo[]): Record<SymbolKind, number> {
    const symbolsByKind = {} as Record<SymbolKind, number>;
    for (const symbol of symbols) {
        symbolsByKind[symbol.kind] = (symbolsByKind[symbol.kind] ?? 0) + 1;
    }
    return symbolsByKind;
}