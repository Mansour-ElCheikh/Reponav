/**
 * Tests for tourResponseParser — LLM response parsing and validation.
 */
import { describe, it, expect } from 'vitest';
import type { AnalysisReport, Tour } from '../types';
import { parseTourResponse, assertValidTourOutput } from './tourResponseParser';

const minimalReport: AnalysisReport = {
    timestamp: new Date().toISOString(),
    workspaceRoot: '/workspace',
    indexTier: 1,
    frameworks: [],
    primaryLanguage: 'typescript',
    entryPoints: [],
    dependencyGraph: { nodes: ['src/index.ts'], edges: [], circularDependencies: [] },
    fileClassifications: [],
    metrics: { totalFiles: 1, totalLines: 10, fileMetrics: [], hotFiles: [], orphanFiles: [] },
    fileTree: {},
    keyFileContents: {},
};

// Helper: create a valid step with adequate content lengths
function makeStep(overrides: Record<string, any> = {}) {
    return {
        order: 1,
        title: 'Entry',
        what_it_does: 'The main entry point bootstraps the application by wiring up all dependency-injected services.',
        why_it_matters: 'Everything starts here — this is the root of the execution graph.',
        watch_out: 'Complex initialization order can cause subtle timing bugs.',
        files: ['src/index.ts'],
        highlights: [],
        relationships: [],
        ...overrides,
    };
}

describe('parseTourResponse', () => {
    it('parses valid JSON response', () => {
        const response = JSON.stringify({
            steps: [makeStep()],
            graph: { nodes: [{ id: 'src/index.ts', label: 'index.ts', type: 'entry' }], edges: [] },
        });

        const result = parseTourResponse(response, minimalReport);
        expect(result.steps).toHaveLength(1);
        expect(result.steps[0].title).toBe('Entry');
    });

    it('extracts JSON from markdown code blocks', () => {
        const response = '```json\n' + JSON.stringify({
            steps: [makeStep()],
            graph: { nodes: [], edges: [] },
        }) + '\n```';

        const result = parseTourResponse(response, minimalReport);
        expect(result.steps).toHaveLength(1);
    });

    it('throws on invalid JSON', () => {
        expect(() => parseTourResponse('not json at all', minimalReport)).toThrow('Failed to parse');
    });

    it('throws on rejected response', () => {
        const response = JSON.stringify({ rejected: true, reason: 'Off topic' });
        expect(() => parseTourResponse(response, minimalReport)).toThrow('Off topic');
    });

    it('returns only steps — no graph field (graph sourced deterministically in tourGenerator)', () => {
        const response = JSON.stringify({
            steps: [makeStep()],
            graph: { nodes: [{ id: 'src/index.ts', label: 'index.ts', type: 'entry' }], edges: [] },
        });
        const result = parseTourResponse(response, minimalReport);
        expect(result).not.toHaveProperty('graph');
    });

    // ─── New quality hardening tests ─────────────────────────────────

    it('filters out steps with what_it_does shorter than 30 characters', () => {
        const response = JSON.stringify({
            steps: [
                makeStep({ order: 1, title: 'Good step' }),
                makeStep({ order: 2, title: 'Bad step', what_it_does: 'too short' }),
            ],
        });

        const result = parseTourResponse(response, minimalReport);
        expect(result.steps).toHaveLength(1);
        expect(result.steps[0].title).toBe('Good step');
    });

    it('deduplicates steps with >80% file overlap, keeping the longer explanation', () => {
        const response = JSON.stringify({
            steps: [
                makeStep({ order: 1, title: 'First version', what_it_does: 'A short but valid explanation for the module — at least 30 chars.' }),
                makeStep({ order: 2, title: 'Duplicate version', what_it_does: 'A much longer and more detailed explanation of the same module that covers many aspects of the implementation and design decisions made.' }),
            ],
        });

        const result = parseTourResponse(response, minimalReport);
        expect(result.steps).toHaveLength(1);
        // Should keep the step with the longer what_it_does
        expect(result.steps[0].title).toBe('Duplicate version');
    });

    it('normalizes step orders to be sequential starting from 1', () => {
        const report = {
            ...minimalReport,
            dependencyGraph: { nodes: ['src/a.ts', 'src/b.ts', 'src/c.ts'], edges: [], circularDependencies: [] },
        };
        const response = JSON.stringify({
            steps: [
                makeStep({ order: 5, title: 'A', files: ['src/a.ts'] }),
                makeStep({ order: 10, title: 'B', files: ['src/b.ts'] }),
                makeStep({ order: 99, title: 'C', files: ['src/c.ts'] }),
            ],
        });

        const result = parseTourResponse(response, report);
        expect(result.steps.map(s => s.order)).toEqual([1, 2, 3]);
    });

    it('standardizes placeholder watch_out text to "No known issues."', () => {
        const response = JSON.stringify({
            steps: [makeStep({ watch_out: 'No major gotchas here.' })],
        });

        const result = parseTourResponse(response, minimalReport);
        expect(result.steps[0].watch_out).toBe('No known issues.');
    });

    it('preserves real watch_out text', () => {
        const response = JSON.stringify({
            steps: [makeStep({ watch_out: 'Token refresh logic is handled separately.' })],
        });

        const result = parseTourResponse(response, minimalReport);
        expect(result.steps[0].watch_out).toBe('Token refresh logic is handled separately.');
    });
});

describe('assertValidTourOutput', () => {
    it('does not throw for valid tour', () => {
        const tour: Tour = {
            id: 'tour_test',
            query: 'test',
            tourType: 'overview',
            steps: [
                {
                    order: 1, title: 'Step 1',
                    what_it_does: 'The main entry point bootstraps all services via dependency injection.',
                    why_it_matters: 'Everything starts here — root of the execution graph.',
                    watch_out: 'Complex initialization order matters.',
                    files: ['src/index.ts'], highlights: [], relationships: [],
                },
                {
                    order: 2, title: 'Step 2',
                    what_it_does: 'The service layer contains the core business logic for request processing.',
                    why_it_matters: 'Encapsulates domain rules separate from transport layer.',
                    watch_out: 'Services should not import from controllers.',
                    files: ['src/index.ts'], highlights: [], relationships: [],
                },
                {
                    order: 3, title: 'Step 3',
                    what_it_does: 'The configuration module loads environment variables and validates them at startup.',
                    why_it_matters: 'Fail-fast on missing config prevents silent runtime failures.',
                    watch_out: 'Default values can mask missing production config.',
                    files: ['src/index.ts'], highlights: [], relationships: [],
                },
            ],
            graph: { nodes: [{ id: 'src/index.ts', label: 'index.ts', type: 'entry' }], edges: [] },
            analysisSnapshot: { frameworks: [], entryPoints: [], totalFiles: 1, totalEdges: 0, circularCount: 0 },
            createdAt: new Date().toISOString(),
            aiGenerated: true,
        };
        expect(() => assertValidTourOutput(tour, minimalReport)).not.toThrow();
    });
});

describe('parseNDJSONTourStream', () => {
    async function* createMockStream(lines: string[]): AsyncGenerator<string> {
        for (const line of lines) {
            yield line;
        }
    }

    it('yields 3 validated TourStep objects when given 3 complete step JSON lines', async () => {
        const report = {
            ...minimalReport,
            dependencyGraph: { nodes: ['src/index.ts', 'src/a.ts', 'src/b.ts'], edges: [], circularDependencies: [] },
        };

        const stream = createMockStream([
            JSON.stringify(makeStep({ order: 1, title: 'First', files: ['src/index.ts'] })) + '\n',
            JSON.stringify(makeStep({ order: 2, title: 'Second', files: ['src/a.ts'] })) + '\n',
            JSON.stringify(makeStep({ order: 3, title: 'Third', files: ['src/b.ts'] })) + '\n',
        ]);

        const { parseNDJSONTourStream } = await import('./tourResponseParser');
        const results: any[] = [];
        for await (const step of parseNDJSONTourStream(stream, report)) {
            results.push(step);
        }

        expect(results).toHaveLength(3);
        expect(results[0].title).toBe('First');
        expect(results[1].title).toBe('Second');
        expect(results[2].title).toBe('Third');
    });

    it('normalizes step orders sequentially during streaming', async () => {
        const stream = createMockStream([
            JSON.stringify(makeStep({ order: 5, title: 'A' })) + '\n',
            JSON.stringify(makeStep({ order: 99, title: 'B' })) + '\n',
        ]);

        const { parseNDJSONTourStream } = await import('./tourResponseParser');
        const results: any[] = [];
        for await (const step of parseNDJSONTourStream(stream, minimalReport)) {
            results.push(step);
        }

        expect(results[0].order).toBe(1);
        expect(results[1].order).toBe(2);
    });

    it('filters out steps with short what_it_does during streaming', async () => {
        const stream = createMockStream([
            JSON.stringify(makeStep({ order: 1, title: 'Good' })) + '\n',
            JSON.stringify({ ...makeStep({ order: 2, title: 'Bad' }), what_it_does: 'short' }) + '\n',
        ]);

        const { parseNDJSONTourStream } = await import('./tourResponseParser');
        const results: any[] = [];
        for await (const step of parseNDJSONTourStream(stream, minimalReport)) {
            results.push(step);
        }

        expect(results).toHaveLength(1);
        expect(results[0].title).toBe('Good');
    });

    it('buffers partial lines and emits only when complete', async () => {
        const step = makeStep();
        const stepJson = JSON.stringify(step);
        const splitPoint = Math.floor(stepJson.length / 2);
        const firstHalf = stepJson.slice(0, splitPoint);
        const secondHalf = stepJson.slice(splitPoint) + '\n';

        const stream = createMockStream([firstHalf, secondHalf]);

        const { parseNDJSONTourStream } = await import('./tourResponseParser');
        const results: any[] = [];
        for await (const step of parseNDJSONTourStream(stream, minimalReport)) {
            results.push(step);
        }

        expect(results).toHaveLength(1);
        expect(results[0].title).toBe('Entry');
    });

    it('falls back to one-shot parseTourResponse when stream starts with {"steps":', async () => {
        const oneShotResponse = {
            steps: [
                makeStep({ order: 1, title: 'Step One' }),
                makeStep({ order: 2, title: 'Step Two' }),
            ],
        };

        const stream = createMockStream([JSON.stringify(oneShotResponse)]);

        const { parseNDJSONTourStream } = await import('./tourResponseParser');
        const results: any[] = [];
        for await (const step of parseNDJSONTourStream(stream, minimalReport)) {
            results.push(step);
        }

        // Deduplication may merge these since they share 100% file overlap
        expect(results.length).toBeGreaterThanOrEqual(1);
        expect(results[0].title).toBeDefined();
    });

    it('detects one-shot JSON even when streamed as small token fragments (Groq-style)', async () => {
        // Groq and OpenAI-compatible APIs stream token-by-token:
        // first chunk is '{', then '"steps"', then ':', etc.
        // The parser must accumulate enough buffer before deciding the format.
        const report = {
            ...minimalReport,
            dependencyGraph: { nodes: ['src/index.ts', 'src/a.ts'], edges: [], circularDependencies: [] },
        };
        const oneShotResponse = {
            steps: [
                makeStep({ order: 1, title: 'First', files: ['src/index.ts'] }),
                makeStep({ order: 2, title: 'Second', files: ['src/a.ts'] }),
            ],
        };
        const fullJson = JSON.stringify(oneShotResponse);
        // Simulate token-by-token streaming: split into tiny chunks
        const chunks = fullJson.match(/.{1,8}/g) || [];

        const stream = createMockStream(chunks);

        const { parseNDJSONTourStream } = await import('./tourResponseParser');
        const results: any[] = [];
        for await (const step of parseNDJSONTourStream(stream, report)) {
            results.push(step);
        }

        expect(results.length).toBeGreaterThanOrEqual(1);
        expect(results[0].title).toBeDefined();
    });

    it('detects one-shot JSON even if wrapped in a markdown block', async () => {
        const report = {
            ...minimalReport,
            dependencyGraph: { nodes: ['src/index.ts', 'src/a.ts'], edges: [], circularDependencies: [] },
        };
        const oneShotResponse = {
            steps: [
                makeStep({ order: 1, title: 'First', files: ['src/index.ts'] }),
            ],
        };
        const fullJson = '```json\n' + JSON.stringify(oneShotResponse) + '\n```';
        const chunks = fullJson.match(/.{1,8}/g) || [];
        const stream = createMockStream(chunks);

        const { parseNDJSONTourStream } = await import('./tourResponseParser');
        const results: any[] = [];
        for await (const step of parseNDJSONTourStream(stream, report)) {
            results.push(step);
        }

        expect(results).toHaveLength(1);
        expect(results[0].title).toBe('First');
    });

    it('detects one-shot JSON even if pretty-printed with scattered newlines', async () => {
        const report = {
            ...minimalReport,
            dependencyGraph: { nodes: ['src/index.ts', 'src/a.ts'], edges: [], circularDependencies: [] },
        };
        const oneShotResponse = {
            steps: [
                makeStep({ order: 1, title: 'First', files: ['src/index.ts'] }),
            ],
        };
        const fullJson = '```json\n{\n  "steps": [\n' + JSON.stringify(oneShotResponse.steps[0]) + '\n  ]\n}\n```';
        const chunks = fullJson.match(/.{1,8}/g) || [];
        const stream = createMockStream(chunks);

        const { parseNDJSONTourStream } = await import('./tourResponseParser');
        const results: any[] = [];
        for await (const step of parseNDJSONTourStream(stream, report)) {
            results.push(step);
        }

        expect(results).toHaveLength(1);
        expect(results[0].title).toBe('First');
    });

    it('yields no items when stream is empty', async () => {
        const stream = createMockStream([]);

        const { parseNDJSONTourStream } = await import('./tourResponseParser');
        const results: any[] = [];
        for await (const step of parseNDJSONTourStream(stream, minimalReport)) {
            results.push(step);
        }

        expect(results).toHaveLength(0);
    });

    it('does not throw when stream closes with a partial line', async () => {
        const partialJson = '{"order":1,"title":"Incomplete"';
        const stream = createMockStream([partialJson]); // No newline, stream ends

        const { parseNDJSONTourStream } = await import('./tourResponseParser');
        const results: any[] = [];

        await expect(async () => {
            for await (const step of parseNDJSONTourStream(stream, minimalReport)) {
                results.push(step);
            }
        }).not.toThrow();

        expect(results).toHaveLength(0); // Partial line is not emitted
    });

    it('parses steps wrapped in markdown code fences (single-line JSON inside fence)', async () => {
        const report = {
            ...minimalReport,
            dependencyGraph: { nodes: ['src/index.ts', 'src/a.ts'], edges: [], circularDependencies: [] },
        };
        const stream = createMockStream([
            '```json\n',
            JSON.stringify(makeStep({ order: 1, title: 'A', files: ['src/index.ts'] })) + '\n',
            '```\n',
            '```json\n',
            JSON.stringify(makeStep({ order: 2, title: 'B', files: ['src/a.ts'] })) + '\n',
            '```\n',
        ]);
        const { parseNDJSONTourStream } = await import('./tourResponseParser');
        const results: any[] = [];
        for await (const s of parseNDJSONTourStream(stream, report)) results.push(s);
        expect(results).toHaveLength(2);
        expect(results[0].title).toBe('A');
        expect(results[1].title).toBe('B');
    });

    it('parses steps wrapped in markdown code fences (multi-line pretty JSON inside fence)', async () => {
        const step = makeStep({ order: 1, title: 'Pretty' });
        const prettyJson = JSON.stringify(step, null, 2);
        const stream = createMockStream([
            '```json\n',
            ...prettyJson.split('\n').map(l => l + '\n'),
            '```\n',
        ]);
        const { parseNDJSONTourStream } = await import('./tourResponseParser');
        const results: any[] = [];
        for await (const s of parseNDJSONTourStream(stream, minimalReport)) results.push(s);
        expect(results).toHaveLength(1);
        expect(results[0].title).toBe('Pretty');
    });

    it('parses multiple NDJSON steps inside a single markdown code fence', async () => {
        const report = {
            ...minimalReport,
            dependencyGraph: { nodes: ['src/index.ts', 'src/a.ts', 'src/b.ts'], edges: [], circularDependencies: [] },
        };
        const stream = createMockStream([
            '```json\n',
            JSON.stringify(makeStep({ order: 1, title: 'A', files: ['src/index.ts'] })) + '\n',
            JSON.stringify(makeStep({ order: 2, title: 'B', files: ['src/a.ts'] })) + '\n',
            JSON.stringify(makeStep({ order: 3, title: 'C', files: ['src/b.ts'] })) + '\n',
            '```\n',
        ]);
        const { parseNDJSONTourStream } = await import('./tourResponseParser');
        const results: any[] = [];
        for await (const s of parseNDJSONTourStream(stream, report)) results.push(s);
        expect(results).toHaveLength(3);
        expect(results[0].title).toBe('A');
        expect(results[1].title).toBe('B');
        expect(results[2].title).toBe('C');
    });

    it('recovers steps from unclosed fence when stream ends abruptly', async () => {
        const report = {
            ...minimalReport,
            dependencyGraph: { nodes: ['src/index.ts', 'src/a.ts'], edges: [], circularDependencies: [] },
        };
        const stream = createMockStream([
            '```json\n',
            JSON.stringify(makeStep({ order: 1, title: 'Recovered', files: ['src/index.ts'] })) + '\n',
            JSON.stringify(makeStep({ order: 2, title: 'Also recovered', files: ['src/a.ts'] })) + '\n',
            // No closing ``` — stream ends abruptly (hits VS Code LM token limit)
        ]);
        const { parseNDJSONTourStream } = await import('./tourResponseParser');
        const results: any[] = [];
        for await (const s of parseNDJSONTourStream(stream, report)) results.push(s);
        expect(results).toHaveLength(2);
        expect(results[0].title).toBe('Recovered');
        expect(results[1].title).toBe('Also recovered');
    });
});
