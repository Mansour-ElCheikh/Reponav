/**
 * AnalysisOrchestrator
 *
 * Pure TypeScript class that owns the scoped analysis workflow:
 * tier 0 warmup, tier 1 analysis, timeout handling, and cache
 * coordination. Extracted from RepoNavWebviewProvider so the
 * orchestration logic can be unit-tested without VS Code.
 *
 * NO vscode imports allowed in this file.
 */

import * as crypto from 'crypto';
import * as path from 'path';
import type { AnalysisScope } from '../analyzers/index';
/** Hardened by Antigravity (2026-04-26) */
import { analyzeTier0, analyzeTier0Preview, analyzeTier1, analyzeTier2, analyzeTier3, analyzeTier4, analyzeTier5, analyzeTier6, formatReportForAI } from '../analyzers/index';
import type { SymbolEnricher } from '../analyzers/symbolEnrichment';
import type { TreeSitterProvider, SupportedLang } from '../analyzers/TreeSitterProvider';
import type { AnalysisReport } from '../types';
import type { WorkspaceAdapter, ProgressReporter as AnalyzerProgressReporter } from '../WorkspaceAdapter';
import { hydrateEnrichmentInBackground, withCompleteness } from '../services/analysisReportHydration';
import { AnalysisCache } from './AnalysisCache';

const PERF_LOG_PREFIX = '[RepoNav][perf][orchestrator]';
const DEBUG_LOG_PREFIX = '[RepoNav][debug][orchestrator]';
const TIER1_TIMEOUT_MS = 120_000;
const INTERACTIVE_ANALYSIS_OPTIONS = { scope: 'interactive' as const };

// ─── Interfaces ──────────────────────────────────────────────────────────────

/**
 * Abstracts vscode.window.withProgress so orchestrator stays pure TS.
 */
export interface OrchestratorProgressReporter {
    withProgress<T>(
        title: string,
        task: (report: (value: { message?: string; increment?: number }) => void) => Promise<T>
    ): Promise<T>;
}

export interface RunScopedOptions {
    notificationTitle: string;
    publishTier0: boolean;
    onStatus?: (status: string) => void;
    /** Run Tier 2 symbol analysis after Tier 1. Default: false. */
    includeTier2?: boolean;
    /** Run Tier 3 LSP fusion after Tier 2. Default: false. */
    includeTier3?: boolean;
    /** Run Tier 4 ORM extraction after Tier 3. Default: false. */
    includeTier4?: boolean;
    /** Run Tier 5 Federation after Tier 4. Default: false. */
    includeTier5?: boolean;
    /** Run Tier 6 Temporal Intelligence after Tier 5. Default: false. */
    includeTier6?: boolean;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(
            () => reject(new Error(`${label} timed out after ${ms}ms`)),
            ms
        );
        promise.then(
            (val) => { clearTimeout(timer); resolve(val); },
            (err) => { clearTimeout(timer); reject(err); }
        );
    });
}

// ─── Class ───────────────────────────────────────────────────────────────────

/** Coordinates cached, scoped analysis runs for the extension webview. */
export class AnalysisOrchestrator {
    constructor(
        private readonly cache: AnalysisCache,
        private readonly workspace: WorkspaceAdapter,
        private readonly treeSitterProvider: TreeSitterProvider,
        private readonly progress: OrchestratorProgressReporter,
        private readonly symbolEnricher?: SymbolEnricher
    ) {}

    /**
     * Run a scoped analysis, returning the Tier 1 report.
     * Uses the cache to skip redundant work.
     * The caller is responsible for publishing the report to the webview.
     */
    async runScoped(
        scope: AnalysisScope,
        options: RunScopedOptions,
        sendAnalysis: (report: AnalysisReport) => void
    ): Promise<{ report: AnalysisReport; tier0Ms: number; tier1Ms: number; tier2Ms: number; tier3Ms: number; tier4Ms: number; tier5Ms: number; tier6Ms: number }> {
        const cachedReport = this.cache.getCachedTier1(scope);
        if (cachedReport) {
            const annotatedCachedReport = withCompleteness(cachedReport, scope);
            if (options.publishTier0) {
                sendAnalysis(annotatedCachedReport);
            }
            return { report: annotatedCachedReport, tier0Ms: 0, tier1Ms: 0, tier2Ms: 0, tier3Ms: 0, tier4Ms: 0, tier5Ms: 0, tier6Ms: 0 };
        }

        // If an interactive warmup is already scanning the same workspace version,
        // prefer reusing it over starting a second full Tier 0 read.
        if (this.cache.tier0WarmupPromise) {
            console.info(`${DEBUG_LOG_PREFIX} runScoped:warmup-in-flight`, {
                scope,
                workspaceVersion: this.cache.workspaceVersion,
            });

            if (scope === 'interactive') {
                options.onStatus?.('Scanning workspace...');
                await this.cache.tier0WarmupPromise;
            }
        }

        const cachedTier0 = this.cache.getCachedTier0(scope);
        let tier0Report: AnalysisReport;
        let files: Map<string, string>;
        let tier0Ms = 0;

        if (cachedTier0) {
            tier0Report = withCompleteness(cachedTier0.report, scope);
            files = cachedTier0.files;
            options.onStatus?.('Using cached workspace scan...');
            if (options.publishTier0) {
                sendAnalysis(tier0Report);
            }
        } else {
            options.onStatus?.('Scanning workspace...');
            const tier0Start = Date.now();
            if (options.publishTier0) {
                const preview = await analyzeTier0Preview(this.workspace, {
                    ...INTERACTIVE_ANALYSIS_OPTIONS,
                    scope,
                });
                sendAnalysis(withCompleteness(preview.report, scope));
                const tier0Result = await analyzeTier0(this.workspace, undefined, {
                    ...INTERACTIVE_ANALYSIS_OPTIONS,
                    scope,
                    candidatePaths: preview.relativePaths,
                });
                tier0Ms = Date.now() - tier0Start;
                tier0Report = withCompleteness(tier0Result.report, scope);
                files = tier0Result.files;
                this.cache.store(tier0Report, files, scope);
                if (options.publishTier0) {
                    sendAnalysis(tier0Report);
                }
            } else {
                const tier0Result = await analyzeTier0(this.workspace, undefined, {
                    ...INTERACTIVE_ANALYSIS_OPTIONS,
                    scope,
                });
                tier0Ms = Date.now() - tier0Start;
                tier0Report = withCompleteness(tier0Result.report, scope);
                files = tier0Result.files;
                this.cache.store(tier0Report, files, scope);
                if (options.publishTier0) {
                    sendAnalysis(tier0Report);
                }
            }
        }

        options.onStatus?.('Building dependency graph...');
        // Hint TreeSitterProvider to load only grammars present in this workspace.
        // Must be called before the first analyzeImports() invocation (before WASM init).
        const EXT_TO_LANG: Record<string, SupportedLang> = {
            '.js': 'javascript', '.jsx': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript',
            '.ts': 'typescript', '.tsx': 'tsx', '.py': 'python',
        };
        const detectedLangs = new Set<SupportedLang>();
        for (const filePath of files.keys()) {
            const lang = EXT_TO_LANG[path.extname(filePath)];
            if (lang) detectedLangs.add(lang);
        }
        if (detectedLangs.size > 0) {
            this.treeSitterProvider.setLanguageHint(detectedLangs);
        }
        const tier1Start = Date.now();
        const report = withCompleteness(await withTimeout(
            this.progress.withProgress(
                options.notificationTitle,
                async (progressReport) => {
                    return analyzeTier1(
                        this.workspace,
                        files,
                        tier0Report,
                        {
                            report: (value) => {
                                progressReport(value);
                                if (value.message) {
                                    options.onStatus?.(value.message);
                                }
                            },
                        },
                        this.treeSitterProvider,
                        { scope }
                    );
                }
            ),
            TIER1_TIMEOUT_MS,
            `${scope} analysis`
        ), scope);
        const tier1Ms = Date.now() - tier1Start;
        console.info(`${PERF_LOG_PREFIX} tier1:done`, {
            scope,
            tier1Ms,
            totalFiles: report.metrics.totalFiles,
            totalEdges: report.dependencyGraph.edges.length,
        });
        this.cache.store(report, files, scope);
        sendAnalysis(report);

        // Tier 2: symbol-level analysis (optional)
        if (options.includeTier2) {
            options.onStatus?.('Extracting symbols...');
            const tier2Start = Date.now();
            const tier2Report = await analyzeTier2(
                this.workspace,
                files,
                report,
                {
                    report: (value) => {
                        if (value.message) {
                            options.onStatus?.(value.message);
                        }
                    },
                },
                this.treeSitterProvider
            );
            const annotatedTier2Report = withCompleteness(tier2Report, scope);
            const tier2Ms = Date.now() - tier2Start;
            console.info(`${PERF_LOG_PREFIX} tier2:done`, {
                scope,
                tier2Ms,
                totalSymbols: annotatedTier2Report.symbolMetrics?.totalSymbols ?? 0,
                totalSymbolEdges: annotatedTier2Report.symbolMetrics?.totalSymbolEdges ?? 0,
            });
            this.cache.store(annotatedTier2Report, files, scope);
            sendAnalysis(annotatedTier2Report);

            // Tier 3: LSP semantic fusion (optional)
            if (options.includeTier3) {
                options.onStatus?.('Fusing semantic signals (LSP)...');
                const tier3Start = Date.now();
                const tier3Report = await analyzeTier3(
                    this.workspace,
                    files,
                    annotatedTier2Report,
                    {
                        report: (value) => {
                            if (value.message) {
                                options.onStatus?.(value.message);
                            }
                        },
                    }
                );
                const tier3Ms = Date.now() - tier3Start;
                console.info(`${PERF_LOG_PREFIX} tier3:done`, {
                    scope,
                    tier3Ms,
                    totalDiagnostics: tier3Report.diagnostics?.length ?? 0,
                });
                this.cache.store(tier3Report, files, scope);
                sendAnalysis(tier3Report);

                // Tier 4: ORM extraction (optional)
                if (options.includeTier4) {
                    options.onStatus?.('Extracting data models (ORM)...');
                    const tier4Start = Date.now();
                    const tier4Report = await analyzeTier4(
                        this.workspace,
                        files,
                        tier3Report,
                        {
                            report: (value) => {
                                if (value.message) {
                                    options.onStatus?.(value.message);
                                }
                            },
                        }
                    );
                    const tier4Ms = Date.now() - tier4Start;
                    console.info(`${PERF_LOG_PREFIX} tier4:done`, {
                        scope,
                        tier4Ms,
                        totalEntities: tier4Report.entities?.length ?? 0,
                    });
                    this.cache.store(tier4Report, files, scope);
                    sendAnalysis(tier4Report);

                    // Tier 5: Federation (optional)
                    if (options.includeTier5) {
                        options.onStatus?.('Federating workspace...');
                        const tier5Start = Date.now();
                        const tier5Report = await analyzeTier5(
                            this.workspace,
                            tier4Report,
                            {
                                report: (value) => {
                                    if (value.message) {
                                        options.onStatus?.(value.message);
                                    }
                                },
                            }
                        );
                        const tier5Ms = Date.now() - tier5Start;
                        console.info(`${PERF_LOG_PREFIX} tier5:done`, {
                            scope,
                            tier5Ms,
                            totalRepos: tier5Report.federation?.repos.length ?? 0,
                        });
                        this.cache.store(tier5Report, files, scope);
                        sendAnalysis(tier5Report);

                        // Tier 6: Temporal Intelligence (optional)
                        if (options.includeTier6) {
                            options.onStatus?.('Analyzing git history...');
                            const tier6Start = Date.now();
                            const tier6Report = await analyzeTier6(
                                this.workspace,
                                tier5Report,
                                {
                                    report: (value) => {
                                        if (value.message) {
                                            options.onStatus?.(value.message);
                                        }
                                    },
                                }
                            );
                            const tier6Ms = Date.now() - tier6Start;
                            console.info(`${PERF_LOG_PREFIX} tier6:done`, {
                                scope,
                                tier6Ms,
                                totalHotspots: tier6Report.temporal?.hotspots.length ?? 0,
                            });
                            this.cache.store(tier6Report, files, scope);
                            sendAnalysis(tier6Report);
                            return { report: tier6Report, tier0Ms, tier1Ms, tier2Ms, tier3Ms, tier4Ms, tier5Ms, tier6Ms };
                        }

                        return { report: tier5Report, tier0Ms, tier1Ms, tier2Ms, tier3Ms, tier4Ms, tier5Ms, tier6Ms: 0 };
                    }

                    return { report: tier4Report, tier0Ms, tier1Ms, tier2Ms, tier3Ms, tier4Ms, tier5Ms: 0, tier6Ms: 0 };
                }

                return { report: tier3Report, tier0Ms, tier1Ms, tier2Ms, tier3Ms, tier4Ms: 0, tier5Ms: 0, tier6Ms: 0 };
            }

            if (this.symbolEnricher) {
                const workspaceVersionAtStart = this.cache.workspaceVersion;
                void hydrateEnrichmentInBackground({
                    scope,
                    files,
                    report: annotatedTier2Report,
                    sendAnalysis,
                    symbolEnricher: this.symbolEnricher,
                    workspaceVersionAtStart,
                    getWorkspaceVersion: () => this.cache.workspaceVersion,
                    getCachedSymbols: (filePath, contentHash) => this.cache.getSymbolEnrichment(filePath, contentHash),
                    storeCachedSymbols: (filePath, contentHash, symbols) => this.cache.storeSymbolEnrichment(filePath, contentHash, symbols),
                    storeReport: (nextReport, nextFiles, nextScope) => this.cache.store(nextReport, nextFiles, nextScope),
                });
            }

            return { report: annotatedTier2Report, tier0Ms, tier1Ms, tier2Ms, tier3Ms: 0, tier4Ms: 0, tier5Ms: 0, tier6Ms: 0 };
        }

        return { report, tier0Ms, tier1Ms, tier2Ms: 0, tier3Ms: 0, tier4Ms: 0, tier5Ms: 0, tier6Ms: 0 };
    }

    /**
     * Warm up a Tier 0 report in the background for quick startup stats.
     */
    async ensureWarmTier0(sendAnalysis: (report: AnalysisReport) => void): Promise<void> {
        const cachedTier0 = this.cache.getCachedTier0('interactive');
        if (cachedTier0) {
            sendAnalysis(withCompleteness(cachedTier0.report, 'interactive'));
            return;
        }

        if (!this.cache.tier0WarmupPromise) {
            const capturedVersion = this.cache.workspaceVersion;

            this.cache.tier0WarmupPromise = (async () => {
                const workspaceRoot = this.workspace.getWorkspaceRoot();
                if (!workspaceRoot) {
                    return;
                }

                const workspaceId = path.basename(workspaceRoot);
                const warmupStart = Date.now();
                console.info(`${DEBUG_LOG_PREFIX} warmup:start`, {
                    workspaceId,
                    capturedVersion,
                });

                const { report: tier0Report, files } = await analyzeTier0(
                    this.workspace,
                    undefined,
                    INTERACTIVE_ANALYSIS_OPTIONS
                );
                const annotatedTier0Report = withCompleteness(tier0Report, 'interactive');

                if (this.cache.workspaceVersion !== capturedVersion) {
                    console.info(`${DEBUG_LOG_PREFIX} warmup:stale:tier0`, {
                        workspaceId,
                        capturedVersion,
                        currentVersion: this.cache.workspaceVersion,
                    });
                    return;
                }

                if (this.cache.getCachedTier0('interactive')) {
                    console.info(`${DEBUG_LOG_PREFIX} warmup:redundant`, {
                        workspaceId,
                        capturedVersion,
                        currentVersion: this.cache.workspaceVersion,
                    });
                    return;
                }

                this.cache.store(annotatedTier0Report, files, 'interactive');
                sendAnalysis(annotatedTier0Report);
                console.info(`${DEBUG_LOG_PREFIX} warmup:tier0:done`, {
                    workspaceId,
                    totalFiles: annotatedTier0Report.metrics.totalFiles,
                    tier0Ms: Date.now() - warmupStart,
                });
            })()
                .catch((error: any) => {
                    console.warn(`${DEBUG_LOG_PREFIX} warmup:failed`, {
                        errorMessage: error?.message,
                    });
                })
                .finally(() => {
                    this.cache.tier0WarmupPromise = null;
                });
        }

        await this.cache.tier0WarmupPromise;
    }

    // Tracks an in-flight background revalidation promise to prevent duplicates.
    private _revalidationPromise: Promise<void> | null = null;

    /**
     * Stale-While-Revalidate: serve the last-known-good analysis report immediately
     * via `sendAnalysis`, then run a full scoped analysis in the background and call
     * `sendAnalysis` again with the fresh result when complete.
     *
     * If no stale data is available (cache is empty), falls back to a normal `runScoped` call.
     * Concurrent calls while a revalidation is in flight are deduplicated — only one
     * background analysis runs at a time.
     */
    scheduleRevalidation(
        scope: AnalysisScope,
        sendAnalysis: (report: AnalysisReport) => void
    ): Promise<void> {
        const stale = this.cache.getStaleReport(scope);

        if (!stale) {
            // No stale data — fall through to a normal analysis.
            return this.runScoped(
                scope,
                { notificationTitle: 'Analyzing workspace…', publishTier0: true },
                sendAnalysis
            ).then(() => undefined);
        }

        // Serve stale immediately (synchronous before any await).
        sendAnalysis(withCompleteness(stale, scope));

        // Deduplicate: reuse in-flight revalidation if one is already running.
        if (this._revalidationPromise) {
            return this._revalidationPromise;
        }

        // Capture version so we can detect an external invalidate() during the run.
        const versionWhenScheduled = this.cache.workspaceVersion;

        this._revalidationPromise = (async () => {
            try {
                await this.runScoped(
                    scope,
                    { notificationTitle: 'Analyzing workspace…', publishTier0: true },
                    sendAnalysis
                );
                // If the version changed while we were running, an external invalidate()
                // fired. Re-invalidate to discard the background result from the cache.
                if (this.cache.workspaceVersion !== versionWhenScheduled) {
                    this.cache.invalidate();
                }
            } catch (error: any) {
                console.warn(`${DEBUG_LOG_PREFIX} revalidation:failed`, {
                    errorMessage: error?.message,
                });
            } finally {
                this._revalidationPromise = null;
            }
        })();

        return this._revalidationPromise;
    }

}
