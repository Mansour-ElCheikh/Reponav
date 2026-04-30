/**
 * Tests for TourGenerator.
 * Uses MockProvider — no API calls needed.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { describe, it, expect } from 'vitest';
import { RepoDatabase } from '../db/RepoDatabase';
import { AnalysisReport } from '../types';
import { LLMProvider, LLMResponse } from './LLMProvider';
import { TourGenerator } from './tourGenerator';

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Creates a step payload that passes the new quality validation gates. */
function makeValidStepPayload(order: number, title: string, files: string[] = []) {
    return {
        order,
        title,
        what_it_does: `The ${title} module handles the full lifecycle of request processing, including validation and transformation of incoming data.`,
        why_it_matters: `Critical for the architecture because it connects the ${title} layer to downstream services.`,
        watch_out: `Performance may degrade under concurrent load due to synchronous processing in the ${title} path.`,
        files,
        highlights: [],
        relationships: [],
    };
}

function createSlowProvider(delayMs: number): LLMProvider {
    return {
        name: 'slow-mock',
        isConfigured: () => true,
        generate: async (_sys: string, _user: string): Promise<LLMResponse> => {
            await new Promise((resolve) => setTimeout(resolve, delayMs));
            return {
                text: JSON.stringify({
                    steps: [
                        makeValidStepPayload(1, 'Entry', []),
                        makeValidStepPayload(2, 'Service', []),
                        makeValidStepPayload(3, 'Config', []),
                    ],
                    graph: { nodes: [], edges: [] },
                }),
                finishReason: 'stop',
            };
        },
    };
}

function createFailingProvider(): LLMProvider {
    return {
        name: 'failing-mock',
        isConfigured: () => true,
        generate: async (): Promise<LLMResponse> => {
            throw new Error('API rate limit exceeded');
        },
    };
}

function createEmptyStepsProvider(): LLMProvider {
    return {
        name: 'empty-steps-mock',
        isConfigured: () => true,
        generate: async (): Promise<LLMResponse> => ({
            text: JSON.stringify({
                steps: [],
                graph: {
                    nodes: [{ id: 'src/index.ts', label: 'index.ts', type: 'entry' }],
                    edges: [],
                },
            }),
            finishReason: 'stop',
        }),
    };
}

function createCapturingProvider(name: string, onPrompt: (userPrompt: string) => void): LLMProvider {
    return {
        name,
        isConfigured: () => true,
        generate: async (_sys: string, userPrompt: string): Promise<LLMResponse> => {
            onPrompt(userPrompt);
            return {
                text: JSON.stringify({
                    steps: [
                        makeValidStepPayload(1, 'Entry', []),
                        makeValidStepPayload(2, 'Service', []),
                        makeValidStepPayload(3, 'Config', []),
                    ],
                    graph: { nodes: [], edges: [] },
                }),
                finishReason: 'stop',
            };
        },
    };
}

function createOversizedTourProvider(): LLMProvider {
    return {
        name: 'oversized-mock',
        isConfigured: () => true,
        generate: async (): Promise<LLMResponse> => ({
            text: JSON.stringify({
                steps: Array.from({ length: 40 }, (_, index) => ({
                    order: index + 1,
                    title: `Step ${index + 1} ${'x'.repeat(200)}`,
                    what_it_does: 'This module handles the full lifecycle of request processing across many layers. '.repeat(6),
                    why_it_matters: 'Critical for the architecture because it connects multiple layers together. '.repeat(5),
                    watch_out: 'Performance degrades under concurrent load and requires careful monitoring. '.repeat(5),
                    files: ['src/index.ts'],
                    highlights: [],
                    relationships: [],
                })),
                graph: {
                    nodes: [{ id: 'src/index.ts', label: 'index.ts', type: 'entry' }],
                    edges: [],
                },
            }),
            finishReason: 'stop',
        }),
    };
}

const minimalReport: AnalysisReport = {
    timestamp: new Date().toISOString(),
    workspaceRoot: '/workspace',
    indexTier: 1,
    frameworks: [],
    primaryLanguage: 'typescript',
    entryPoints: [{ file: 'src/index.ts', type: 'main', confidence: 'high', reason: 'package.json main' }],
    dependencyGraph: { nodes: ['src/index.ts', 'src/service.ts', 'src/config.ts'], edges: [], circularDependencies: [] },
    fileClassifications: [
        { path: 'src/index.ts', category: 'entry', confidence: 'high', reason: 'main' },
        { path: 'src/service.ts', category: 'service', confidence: 'medium', reason: 'naming' },
        { path: 'src/config.ts', category: 'config', confidence: 'medium', reason: 'naming' },
    ],
    metrics: {
        totalFiles: 3,
        totalLines: 30,
        fileMetrics: [
            { path: 'src/index.ts', lines: 10, importCount: 0, exportCount: 1, fanIn: 0, fanOut: 2 },
            { path: 'src/service.ts', lines: 10, importCount: 1, exportCount: 1, fanIn: 1, fanOut: 0 },
            { path: 'src/config.ts', lines: 10, importCount: 0, exportCount: 1, fanIn: 1, fanOut: 0 },
        ],
        hotFiles: [
            { path: 'src/index.ts', lines: 10, importCount: 0, exportCount: 1, fanIn: 0, fanOut: 2 },
            { path: 'src/service.ts', lines: 10, importCount: 1, exportCount: 1, fanIn: 1, fanOut: 0 },
            { path: 'src/config.ts', lines: 10, importCount: 0, exportCount: 1, fanIn: 1, fanOut: 0 },
        ],
        orphanFiles: [],
    },
    fileTree: {},
    keyFileContents: {},
};

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('TourGenerator', () => {
    it('generates a tour from a valid LLM response', async () => {
        const provider = createSlowProvider(10); // fast mock
        const generator = new TourGenerator(provider);
        const result = await generator.generateTour(minimalReport, 'overview', 'overview');

        expect(result.cacheHit).toBe(false);
        expect(result.tour.id).toMatch(/^tour_/);
        expect(result.tour.steps.length).toBeGreaterThan(0);
        expect(result.tour.tourType).toBe('overview');
        expect(result.tour.aiGenerated).toBe(true);
    });

    it('falls back to structural tour on LLM timeout', async () => {
        const provider = createSlowProvider(60_000); // 60s — way too slow
        const generator = new TourGenerator(provider, undefined, { timeoutMs: 500 });

        const result = await generator.generateTour(minimalReport, 'overview', 'overview');
        expect(result.cacheHit).toBe(false);
        expect(result.tour.id).toMatch(/^tour_/);
        expect(result.tour.steps.length).toBeGreaterThan(0);
        expect(result.tour.aiGenerated).toBe(false);
    });

    it('falls back to structural tour on LLM error', async () => {
        const provider = createFailingProvider();
        const generator = new TourGenerator(provider);

        const result = await generator.generateTour(minimalReport, 'overview', 'overview');
        expect(result.cacheHit).toBe(false);
        expect(result.tour.id).toMatch(/^tour_/);
        expect(result.tour.aiGenerated).toBe(false);
    });

    it('falls back to structural tour when the LLM returns no usable steps', async () => {
        const provider = createEmptyStepsProvider();
        const generator = new TourGenerator(provider);

        const result = await generator.generateTour(minimalReport, 'overview', 'overview');
        expect(result.cacheHit).toBe(false);
        expect(result.tour.steps.length).toBeGreaterThan(0);
        expect(result.tour.aiGenerated).toBe(false);
    });

    it('isReady returns false when provider is not configured', () => {
        const provider: LLMProvider = {
            name: 'unconfigured',
            isConfigured: () => false,
            generate: async () => ({ text: '', finishReason: 'error' }),
        };
        const generator = new TourGenerator(provider);
        expect(generator.isReady()).toBe(false);
    });

    it('uses the same shared prompt budget across providers', async () => {
        const largeReport: AnalysisReport = {
            ...minimalReport,
            dependencyGraph: {
                nodes: Array.from({ length: 1200 }, (_, i) => `src/module${i}.ts`),
                edges: Array.from({ length: 1000 }, (_, i) => ({
                    source: `src/module${i}.ts`,
                    target: `src/module${i + 1}.ts`,
                    specifiers: [],
                    isDynamic: false,
                    rawStatement: `import './module${i + 1}.ts';`,
                })),
                circularDependencies: [],
            },
            metrics: {
                totalFiles: 1200,
                totalLines: 60_000,
                fileMetrics: Array.from({ length: 1200 }, (_, i) => ({
                    path: `src/module${i}.ts`,
                    lines: 50,
                    importCount: 1,
                    exportCount: 1,
                    fanIn: i === 0 ? 0 : 1,
                    fanOut: i === 199 ? 0 : 1,
                })),
                hotFiles: Array.from({ length: 20 }, (_, i) => ({
                    path: `src/module${i}.ts`,
                    lines: 50,
                    importCount: 1,
                    exportCount: 1,
                    fanIn: 5,
                    fanOut: 5,
                })),
                orphanFiles: [],
            },
            fileClassifications: Array.from({ length: 400 }, (_, i) => ({
                path: `src/module${i}.ts`,
                category: 'service',
                confidence: 'high',
                reason: 'test fixture',
            })),
            keyFileContents: {
                'package.json': JSON.stringify({ dependencies: { express: '^5.0.0' } }, null, 2),
                'README.md': '# Example\n'.repeat(4000),
            },
        };

        let vscodeLmPrompt = '';
        let genericPrompt = '';

        const vscodeGenerator = new TourGenerator(
            createCapturingProvider('VS Code Language Model', (prompt) => {
                vscodeLmPrompt = prompt;
            })
        );
        const genericGenerator = new TourGenerator(
            createCapturingProvider('Generic Provider', (prompt) => {
                genericPrompt = prompt;
            })
        );

        await vscodeGenerator.generateTour(largeReport, 'Give me an architecture overview', 'overview');
        await genericGenerator.generateTour(largeReport, 'Give me an architecture overview', 'overview');

        expect(vscodeLmPrompt.length).toBe(genericPrompt.length);
        expect(vscodeLmPrompt.length).toBeLessThan(25_000);
    });

    it('falls back to a structural tour when the generated tour fails validation', async () => {
        const provider = createOversizedTourProvider();
        const generator = new TourGenerator(provider);

        const result = await generator.generateTour(minimalReport, 'overview', 'overview');

        expect(result.cacheHit).toBe(false);
        expect(result.tour.aiGenerated).toBe(false);
    });

    it('includes symbol-aware context in the prompt when tier 2 data is present', async () => {
        const previousFormat = process.env.REPONAV_TOUR_FORMAT;
        process.env.REPONAV_TOUR_FORMAT = 'markdown';
        let capturedPrompt = '';
        const provider = createCapturingProvider('VS Code Language Model', (prompt) => {
            capturedPrompt = prompt;
        });
        const generator = new TourGenerator(provider);

        await generator.generateTour({
            ...minimalReport,
            indexTier: 2,
            symbols: [
                {
                    name: 'bootstrapApp',
                    kind: 'function',
                    filePath: 'src/index.ts',
                    lineStart: 1,
                    lineEnd: 5,
                    isExported: true,
                    isEntryPoint: true,
                },
            ],
            symbolEdges: [
                {
                    sourceFile: 'src/server.ts',
                    sourceName: 'startServer',
                    targetFile: 'src/index.ts',
                    targetName: 'bootstrapApp',
                    edgeType: 'calls',
                    lineNumber: 4,
                },
            ],
            symbolMetrics: {
                totalSymbols: 1,
                totalSymbolEdges: 1,
                symbolsByKind: {
                    function: 1,
                } as any,
                deadCodeCount: 0,
            },
        }, 'Give me an overview of the startup path', 'overview');

        expect(capturedPrompt).toContain('## Symbol Summary');
        expect(capturedPrompt).toContain('## Symbol Hotspots (Tier 2)');
        expect(capturedPrompt).toContain('bootstrapApp');
        if (previousFormat === undefined) delete process.env.REPONAV_TOUR_FORMAT;
        else process.env.REPONAV_TOUR_FORMAT = previousFormat;
    });

    it('graph on generated tour comes from deterministic builder, not LLM', async () => {
        // Provider returns steps-only (no graph key) — graph must still be populated.
        const provider: LLMProvider = {
            name: 'steps-only-mock',
            isConfigured: () => true,
            generate: async (): Promise<LLMResponse> => ({
                text: JSON.stringify({
                    steps: [
                        makeValidStepPayload(1, 'Entry', ['src/index.ts']),
                        makeValidStepPayload(2, 'Service', ['src/service.ts']),
                        makeValidStepPayload(3, 'Config', ['src/config.ts']),
                    ],
                }),
                finishReason: 'stop',
            }),
        };
        const generator = new TourGenerator(provider);
        const result = await generator.generateTour(minimalReport, 'overview', 'overview');

        expect(result.tour.graph).toBeDefined();
        expect(result.tour.graph.nodes.length).toBeGreaterThanOrEqual(0);
        // Graph is not hallucinated by the LLM — it comes from the analysis report.
        expect(result.tour.aiGenerated).toBe(true);
    });

    it('step files with zero fan-in are pinned as graph nodes so the webview can highlight them', async () => {
        // Build a report with 201 files: 200 with fan-in=10, one with fan-in=0.
        // The zero-fan-in file won't reach top-200 without pinning.
        const OBSCURE_FILE = 'src/rarely-used.ts';
        const manyNodes = [
            ...Array.from({ length: 200 }, (_, i) => `src/popular${i}.ts`),
            OBSCURE_FILE,
        ];
        const manyMetrics = manyNodes.map((p) => ({
            path: p,
            lines: 10,
            importCount: 0,
            exportCount: 1,
            fanIn: p === OBSCURE_FILE ? 0 : 10,
            fanOut: 0,
        }));

        const largeReport: AnalysisReport = {
            ...minimalReport,
            dependencyGraph: { nodes: manyNodes, edges: [], circularDependencies: [] },
            metrics: { totalFiles: 201, totalLines: 2010, fileMetrics: manyMetrics, hotFiles: [], orphanFiles: [] },
        };

        const provider: LLMProvider = {
            name: 'pin-test-mock',
            isConfigured: () => true,
            generate: async (): Promise<LLMResponse> => ({
                text: JSON.stringify({
                    steps: [
                        makeValidStepPayload(1, 'Rarely Used', [OBSCURE_FILE]),
                        makeValidStepPayload(2, 'Connector', ['src/popular0.ts']),
                        makeValidStepPayload(3, 'Observer', ['src/popular1.ts']),
                    ],
                }),
                finishReason: 'stop',
            }),
        };

        const generator = new TourGenerator(provider);
        const result = await generator.generateTour(largeReport, 'explain src/rarely-used.ts data flow', 'custom');

        const nodeIds = new Set(result.tour.graph.nodes.map((n) => n.id));
        expect(nodeIds.has(OBSCURE_FILE)).toBe(true);
    });

    it('invalidates the cache when the live dependency graph changes even if DB edges stay stale', async () => {
        let callCount = 0;
        const provider: LLMProvider = {
            name: 'cache-regression-mock',
            isConfigured: () => true,
            generate: async (): Promise<LLMResponse> => {
                callCount += 1;
                return {
                    text: JSON.stringify({
                        steps: [
                            makeValidStepPayload(1, 'Entry', ['src/index.ts']),
                            makeValidStepPayload(2, 'Service', ['src/index.ts']),
                            makeValidStepPayload(3, 'Config', ['src/index.ts']),
                        ],
                    }),
                    finishReason: 'stop',
                };
            },
        };

        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reponav-tour-cache-'));
        const db = new RepoDatabase(tempDir);
        await db.open();

        try {
            const generator = new TourGenerator(provider, db);
            const initialReport: AnalysisReport = {
                ...minimalReport,
                dependencyGraph: {
                    nodes: ['src/index.ts', 'src/a.ts'],
                    edges: [{ source: 'src/index.ts', target: 'src/a.ts', specifiers: [], isDynamic: false, rawStatement: "import './a';" }],
                    circularDependencies: [],
                },
            };
            const changedReport: AnalysisReport = {
                ...minimalReport,
                dependencyGraph: {
                    nodes: ['src/index.ts', 'src/b.ts'],
                    edges: [{ source: 'src/index.ts', target: 'src/b.ts', specifiers: [], isDynamic: false, rawStatement: "import './b';" }],
                    circularDependencies: [],
                },
            };

            const first = await generator.generateTour(initialReport, 'overview', 'overview');
            const second = await generator.generateTour(changedReport, 'overview', 'overview');

            expect(first.cacheHit).toBe(false);
            expect(second.cacheHit).toBe(false);
            expect(callCount).toBe(2);
        } finally {
            await db.close();
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });
});
