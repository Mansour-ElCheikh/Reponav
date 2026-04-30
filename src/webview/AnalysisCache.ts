/**
 * AnalysisCache
 *
 * Pure TypeScript class that owns analysis report caching, versioning,
 * and scope-satisfaction logic. Extracted from RepoNavWebviewProvider
 * so that caching behaviour can be unit-tested without VS Code.
 *
 * NO vscode imports allowed in this file.
 */

import type { AnalysisScope } from '../analyzers/index';
import type { AnalysisReport } from '../types';
import type { SymbolInfo } from '../types';

interface CachedSymbolEnrichment {
    contentHash: string;
    symbols: SymbolInfo[];
}

/** In-memory analysis cache for scoped reports, stale-state handling, and symbol enrichment overlays. */
export class AnalysisCache {
    private currentReport: AnalysisReport | undefined;
    private currentReportScope: AnalysisScope | null = null;
    private currentReportVersion = -1;
    private currentFiles: Map<string, string> | null = null;
    private currentFilesScope: AnalysisScope | null = null;
    private currentFilesVersion = -1;
    private _workspaceVersion = 0;
    private _tier0WarmupPromise: Promise<void> | null = null;
    private _isStale = false;
    private readonly symbolEnrichment = new Map<string, CachedSymbolEnrichment>();

    get workspaceVersion(): number {
        return this._workspaceVersion;
    }

    /** Whether the cache holds a stale (not-yet-revalidated) report from a prior workspace version. */
    get isStale(): boolean {
        return this._isStale;
    }

    get tier0WarmupPromise(): Promise<void> | null {
        return this._tier0WarmupPromise;
    }

    set tier0WarmupPromise(p: Promise<void> | null) {
        this._tier0WarmupPromise = p;
    }

    get report(): AnalysisReport | undefined {
        return this.currentReport;
    }

    /**
     * Bump the workspace version and clear all cached data.
     */
    invalidate(): void {
        this._workspaceVersion += 1;
        this.currentReport = undefined;
        this.currentReportScope = null;
        this.currentReportVersion = -1;
        this.currentFiles = null;
        this.currentFilesScope = null;
        this.currentFilesVersion = -1;
        this._tier0WarmupPromise = null;
        this._isStale = false;
        this.symbolEnrichment.clear();
    }

    /**
     * Mark the current cached data as stale without discarding it.
     * The stale report remains readable via `getStaleReport` for immediate serving
     * while a background revalidation runs. Idempotent — calling twice does not
     * bump the version a second time.
     */
    markStale(): void {
        if (this._isStale) return;
        this._workspaceVersion += 1;
        this._isStale = true;
    }

    /**
     * Return the stale cached report for the requested scope, or undefined if
     * the cache is not in a stale state or has no data for the scope.
     */
    getStaleReport(scope: AnalysisScope): AnalysisReport | undefined {
        if (!this._isStale) return undefined;
        if (!this.currentReport) return undefined;
        if (!this.scopeSatisfies(this.currentReportScope, scope)) return undefined;
        return this.currentReport;
    }

    /**
     * Return cached Tier 1+ report if it satisfies the requested scope
     * and matches the current workspace version.
     */
    getCachedTier1(scope: AnalysisScope): AnalysisReport | undefined {
        if (!this.currentReport) return undefined;
        if (this.currentReport.indexTier < 1) return undefined;
        if (this.currentReportVersion !== this._workspaceVersion) return undefined;
        if (!this.scopeSatisfies(this.currentReportScope, scope)) return undefined;
        return this.currentReport;
    }

    /**
     * Return cached Tier 0 report + file map if available and fresh.
     */
    getCachedTier0(scope: AnalysisScope): { report: AnalysisReport; files: Map<string, string> } | undefined {
        if (!this.currentReport || !this.currentFiles) return undefined;
        if (this.currentReportVersion !== this._workspaceVersion || this.currentFilesVersion !== this._workspaceVersion) {
            return undefined;
        }
        if (!this.scopeSatisfies(this.currentReportScope, scope) || !this.scopeSatisfies(this.currentFilesScope, scope)) {
            return undefined;
        }
        return { report: this.currentReport, files: this.currentFiles };
    }

    /**
     * Store analysis artifacts in the cache.
     * Clears the stale flag only when the stored report reaches Tier 1 or higher,
     * so that intermediate Tier 0 stores during background revalidation do not
     * prematurely mark the cache as fresh.
     */
    store(report: AnalysisReport, files: Map<string, string> | null, scope: AnalysisScope): void {
        this.currentReport = report;
        this.currentReportScope = scope;
        this.currentReportVersion = this._workspaceVersion;
        this.currentFiles = files;
        this.currentFilesScope = files ? scope : null;
        this.currentFilesVersion = files ? this._workspaceVersion : -1;
        if (report.indexTier >= 1) {
            this._isStale = false;
        }
    }

    /** Returns cached symbol enrichment when the file content hash still matches. */
    getSymbolEnrichment(filePath: string, contentHash: string): SymbolInfo[] | undefined {
        const cached = this.symbolEnrichment.get(filePath);
        if (!cached || cached.contentHash !== contentHash) {
            return undefined;
        }
        return cached.symbols;
    }

    /** Store symbol enrichment keyed by file path and deterministic content hash. */
    storeSymbolEnrichment(filePath: string, contentHash: string, symbols: SymbolInfo[]): void {
        this.symbolEnrichment.set(filePath, { contentHash, symbols });
    }

    /**
     * Check whether a cached scope satisfies a requested scope.
     * fullWorkspace satisfies interactive, but not vice versa.
     */
    private scopeSatisfies(cachedScope: AnalysisScope | null, requestedScope: AnalysisScope): boolean {
        if (!cachedScope) return false;
        return cachedScope === requestedScope
            || (cachedScope === 'fullWorkspace' && requestedScope === 'interactive');
    }
}
