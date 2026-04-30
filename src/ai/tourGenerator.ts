/**
 * Tour Generator
 *
 * Takes a static analysis report + user query, sends to LLM,
 * and produces a validated Tour object.
 *
 * NOTE: This file has NO vscode imports — it is fully testable
 * outside the VS Code extension host.
 */

import { RepoDatabase } from '../db/RepoDatabase';
import {
    AnalysisReport,
    Tour,
    TourStreamChunkMessage,
    TourStreamEndMessage,
    TourType,
} from '../types';
import { buildDeterministicTour } from './graphBuilder';
import { LLMProvider } from './LLMProvider';
import { NDJSON_SYSTEM_PROMPT, PROMPT_VERSION, SYSTEM_PROMPT } from './prompts';
import { generateTourId, buildStructuralFallbackTour } from './tourFallback';
import { prepareTourRequest, withTimeout, isCodeRelevantQuery } from './tourQuery';
import { parseNDJSONTourStream } from './tourResponseParser';

/** Configuration for TourGenerator behavior. */
export interface TourGeneratorOptions {
    /** Maximum time in ms to wait for LLM response. Default: 30000 (30s). */
    timeoutMs?: number;
    /** Whether to use the tour cache. Default: true. */
    cacheEnabled?: boolean;
}

/** Result of tour generation, including metadata about how it was produced. */
export interface TourGenerationResult {
    tour: Tour;
    cacheHit: boolean;
}

const DEFAULT_TIMEOUT_MS = 60_000;

export { isCodeRelevantQuery } from './tourQuery';

/** Generates validated tours from deterministic analysis plus an LLM provider. */
export class TourGenerator {
    private readonly timeoutMs: number;
    private readonly cacheEnabled: boolean;

    constructor(
        private readonly llm: LLMProvider,
        private db?: RepoDatabase,
        options?: TourGeneratorOptions
    ) {
        this.timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
        this.cacheEnabled = options?.cacheEnabled ?? true;
    }

    /** Return the underlying LLMProvider for direct queries (e.g. chat handler). */
    getLLMProvider(): LLMProvider {
        return this.llm;
    }

    /**
     * Generate a tour from an analysis report and user query.
     */
    async generateTour(
        report: AnalysisReport,
        query: string,
        tourType: TourType = 'custom'
    ): Promise<TourGenerationResult> {
        // Lazy-load the validation+parsing layer (pulls in zod) only on first tour generation.
        const { parseTourResponse, assertValidTourOutput } = await import('./tourResponseParser');

        // Ensure DB is open before chunk indexing + retrieval.
        // On first call, open() compiles WASM (~300-500ms) — we accept this cost here so that
        // the very first tour already benefits from hybrid retrieval rather than falling back.
        if (this.db && !this.db.isOpen()) {
            try { await this.db.open(); } catch { /* DB unavailable — retrieval will skip */ }
        }

        // Index key-file chunks for hybrid retrieval (v3). Synchronous — must complete before
        // retrieveContext so even the first tour has a populated index.
        if (this.db?.isOpen()) {
            try {
                const { buildChunks } = await import('../analyzers/chunkBuilder');
                const keyFilesMap = new Map(Object.entries(report.keyFileContents));
                this.db.indexChunks(buildChunks(keyFilesMap, report.symbols ?? []));
            } catch {
                // Chunk indexing is best-effort; do not block tour generation.
            }
        }

        // Attempt hybrid retrieval (v3) for richer context.
        // Falls back to formatReportForAI inside prepareTourRequest if retrieval is unavailable.
        let analysisTextOverride: string | undefined;
        if (this.db?.isOpen()) {
            try {
                const { retrieveContext } = await import('./hybridRetriever');
                const VSCODE_LM_BUDGET = 8_000;
                const DEFAULT_BUDGET = 24_000; // MAX_REPORT_CHARS
                const budget = this.llm.name === 'VS Code Language Model' ? VSCODE_LM_BUDGET : DEFAULT_BUDGET;
                analysisTextOverride = await retrieveContext(query, this.db, report, budget);
            } catch {
                // Hybrid retrieval failed — fall through to legacy formatter.
                analysisTextOverride = undefined;
            }
        }

        const preparedRequest = prepareTourRequest(report, query, tourType, this.llm.name, analysisTextOverride);
        console.info('[RepoNav][perf][tourGenerator] prompt', {
            providerName: this.llm.name,
            analysisChars: preparedRequest.analysisText.length,
            userPromptChars: preparedRequest.userPrompt.length,
            symbolCount: report.symbolMetrics?.totalSymbols ?? 0,
            symbolEdgeCount: report.symbolMetrics?.totalSymbolEdges ?? 0,
        });

        if (this.db && this.cacheEnabled) {
            try {
                // Re-open the db for cache read only if WASM has been compiled at least once.
                // On the very first open, WASM compilation (~300-500ms) can block the VS Code LM
                // streaming channel — in that case we skip the read and let the WRITE phase open it.
                if (!this.db.isOpen()) {
                    if (this.db.isWasmReady()) {
                        // WASM already compiled — re-open is fast (~3ms file I/O only).
                        await this.db.open();
                    }
                    // else: first-ever open — skip read, fall through to LLM.
                }
                if (this.db.isOpen()) {
                    const stateHash = this.db.computeStateHash(
                        query,
                        preparedRequest.tourType,
                        this.llm.name,
                        PROMPT_VERSION,
                        report.dependencyGraph.edges
                    );
                    const cached = this.db.findTourByHash(stateHash);
                    if (cached) {
                        const cachedTour = JSON.parse(cached) as Tour;
                        if (cachedTour.aiGenerated === true) {
                            return { tour: cachedTour, cacheHit: true };
                        }
                    }
                }
            } catch {
                // Cache miss or read error — proceed to generate.
            }
        }

        let tour: Tour;
        let respondingModelId: string | undefined;
        try {
            const response = await withTimeout(
                this.llm.generate(SYSTEM_PROMPT, preparedRequest.userPrompt),
                this.timeoutMs,
                'Tour generation'
            );
            respondingModelId = response.modelId;

            const tourData = parseTourResponse(response.text, report);
            // Graph is sourced deterministically — no hallucinated edges/nodes from the LLM.
            const deterministicTour = buildDeterministicTour(report, { maxNodes: 200, graphMode: 'file' });

            // Pin step-referenced files as graph nodes so the webview can highlight them.
            // buildDeterministicTour selects top-N by fan-in; step files with low fan-in may
            // be absent. Add any missing ones directly so highlight mapping is 100% intact.
            const existingNodeIds = new Set(deterministicTour.graph.nodes.map((n) => n.id));
            const classMap = new Map(report.fileClassifications.map((c) => [c.path, c.category]));
            const fanInMap = new Map(report.metrics.fileMetrics.map((m) => [m.path, m.fanIn]));
            const validNodes = new Set(report.dependencyGraph.nodes);
            for (const step of tourData.steps) {
                for (const filePath of (step.files ?? [])) {
                    if (!existingNodeIds.has(filePath) && validNodes.has(filePath)) {
                        deterministicTour.graph.nodes.push({
                            id: filePath,
                            label: filePath.split('/').pop() || filePath,
                            type: classMap.get(filePath) ?? 'unknown',
                            weight: fanInMap.get(filePath) ?? 0,
                        });
                        existingNodeIds.add(filePath);
                    }
                }
            }

            tour = {
                id: generateTourId(),
                query,
                tourType: preparedRequest.tourType,
                steps: tourData.steps,
                graph: deterministicTour.graph,
                analysisSnapshot: {
                    frameworks: report.frameworks.map((framework) => framework.name),
                    entryPoints: report.entryPoints.map((entryPoint) => entryPoint.file),
                    totalFiles: report.metrics.totalFiles,
                    totalEdges: report.dependencyGraph.edges.length,
                    circularCount: report.dependencyGraph.circularDependencies.length,
                },
                createdAt: new Date().toISOString(),
                aiGenerated: true,
            };
            assertValidTourOutput(tour, report);
        } catch (aiError) {
            console.warn('RepoNav: AI generation failed, producing structural-only tour:', aiError);
            tour = buildStructuralFallbackTour(report, query, preparedRequest.tourType);
            // Structural fallback is the last resort — skip strict validation.
            // The fallback already produces as many steps as the report allows.
        }

        console.info('[RepoNav][tourGenerator] tour.complete', {
            provider: this.llm.name,
            ...(respondingModelId ? { modelId: respondingModelId } : {}),
            aiGenerated: tour.aiGenerated ?? false,
            structural: !(tour.aiGenerated ?? false),
        });

        if (this.db && this.cacheEnabled) {
            try {
                // Open db lazily here — after the LLM call — so WASM load (300-500ms) never
                // blocks the VS Code LM streaming channel.
                if (!this.db.isOpen()) {
                    await this.db.open();
                }
                const stateHash = this.db.computeStateHash(
                    query,
                    preparedRequest.tourType,
                    this.llm.name,
                    PROMPT_VERSION,
                    report.dependencyGraph.edges
                );
                await this.db.saveTour(tour.id, query, preparedRequest.tourType, stateHash, JSON.stringify(tour));
            } catch {
                // Cache write failure is non-critical.
            }
        }

        const postMem = process.memoryUsage();
        console.info('[RepoNav][perf][tourGenerator] memory:post-generate', {
            heapUsedMB: (postMem.heapUsed / 1_048_576).toFixed(1),
            heapTotalMB: (postMem.heapTotal / 1_048_576).toFixed(1),
            externalMB: (postMem.external / 1_048_576).toFixed(1),
            aiGenerated: tour.aiGenerated ?? false,
        });

        return { tour, cacheHit: false };
    }

    isReady(): boolean {
        return this.llm.isConfigured();
    }

    getProviderName(): string {
        return this.llm.name;
    }

    /**
     * Stream a tour as chunks: graph-first, then steps one by one.
     *
     * Emits:
     *  1. `tour.stream_chunk` with `payload.type === 'graph'` immediately (no LLM call yet)
     *  2. `tour.stream_chunk` with `payload.type === 'step'` for each step as it arrives
     *  3. `tour.stream_end` when done
     *
     * Falls back to one-shot `generateTour()` if the provider has no `generateStream`.
     */
    async generateTourStream(
        report: AnalysisReport,
        query: string,
        tourType: TourType,
        onChunk: (msg: TourStreamChunkMessage | TourStreamEndMessage) => void
    ): Promise<void> {
        const streamStart = Date.now();

        // ── Phase 1: deterministic graph — no LLM required ──────────────────
        const deterministicTour = buildDeterministicTour(report, { maxNodes: 200, graphMode: 'file' });

        onChunk({
            type: 'tour.stream_chunk',
            payload: { type: 'graph', data: { ...deterministicTour, query, tourType, steps: [] } },
        });
        const msToFirstGraph = Date.now() - streamStart;

        // ── Phase 2: LLM streaming (or one-shot fallback) ───────────────────
        try {
            if (this.llm.generateStream) {
                const preparedRequest = prepareTourRequest(report, query, tourType, this.llm.name);
                // Use SYSTEM_PROMPT (one-shot JSON) rather than NDJSON_SYSTEM_PROMPT.
                // DynamicLLMProvider in auto mode uses one-shot generate() internally,
                // and OpenAI-compatible providers force response_format: json_object
                // which always produces wrapped {"steps": [...]} regardless of prompt.
                const stream = this.llm.generateStream(SYSTEM_PROMPT, preparedRequest.userPrompt);
                let msToFirstStep: number | null = null;

                for await (const step of parseNDJSONTourStream(stream, report)) {
                    if (msToFirstStep === null) msToFirstStep = Date.now() - streamStart;
                    onChunk({ type: 'tour.stream_chunk', payload: { type: 'step', data: step } });
                }

                console.info('[RepoNav][perf][tourGenerator] stream.complete', {
                    msToFirstGraph,
                    msToFirstStep: msToFirstStep ?? Date.now() - streamStart,
                });
            } else {
                // One-shot fallback: generate full tour then emit steps in order
                const { tour } = await this.generateTour(report, query, tourType);
                let msToFirstStep: number | null = null;

                for (const step of tour.steps) {
                    if (msToFirstStep === null) msToFirstStep = Date.now() - streamStart;
                    onChunk({ type: 'tour.stream_chunk', payload: { type: 'step', data: step } });
                }

                console.info('[RepoNav][perf][tourGenerator] stream.complete (one-shot fallback)', {
                    msToFirstGraph,
                    msToFirstStep: msToFirstStep ?? Date.now() - streamStart,
                });
            }
        } catch (streamError) {
            // LLM streaming failed — emit structural fallback steps so the user
            // still gets a useful tour instead of a raw error message.
            console.warn('[RepoNav][tourGenerator] stream failed, emitting structural fallback:', streamError);
            const fallbackTour = buildStructuralFallbackTour(report, query, tourType);
            for (const step of fallbackTour.steps) {
                onChunk({ type: 'tour.stream_chunk', payload: { type: 'step', data: step } });
            }
        }

        onChunk({ type: 'tour.stream_end' });
    }
}
