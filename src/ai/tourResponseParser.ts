import type {
    AnalysisReport,
    Tour,
    TourStep,
} from '../types';
import { validateTourOutput } from '../validation/gate';

interface ParsedTourData {
    steps: TourStep[];
}

/** Minimum character length for what_it_does to be considered meaningful. */
const MIN_WHAT_IT_DOES_CHARS = 30;

/** Standardized sentinel value for steps with no real gotchas. */
const NO_ISSUES_SENTINEL = 'No known issues.';

/** Placeholder phrases that should be replaced with the standard sentinel. */
const WATCH_OUT_PLACEHOLDERS = new Set([
    'no major gotchas here.',
    'no major gotchas here',
    'no gotchas.',
    'no gotchas',
    'none',
    'none.',
    'n/a',
    '',
]);

/**
 * Validates that a generated tour meets all schema and token budget requirements.
 * Throws if validation fails.
 */
export function assertValidTourOutput(tour: Tour, report: AnalysisReport): void {
    // Since Batch 2, the graph is deterministic (not LLM-generated). Check only steps
    // against the token budget — graph size is bounded by maxNodes in buildDeterministicTour.
    const validation = validateTourOutput(
        { ...tour, graph: { nodes: [], edges: [] } },
        { knownFiles: new Set(report.dependencyGraph.nodes) }
    );

    if (!validation.valid) {
        throw new Error(`Generated tour failed validation: ${validation.errors.join('; ')}`);
    }
}

/**
 * Standardize the watch_out field: replace known placeholder phrases with the sentinel.
 */
function standardizeWatchOut(value: string): string {
    if (WATCH_OUT_PLACEHOLDERS.has(value.trim().toLowerCase())) {
        return NO_ISSUES_SENTINEL;
    }
    return value || NO_ISSUES_SENTINEL;
}

/**
 * Normalize step orders to be sequential (1, 2, 3...) regardless of LLM output gaps.
 */
export function normalizeStepOrders(steps: TourStep[]): TourStep[] {
    return steps.map((step, index) => ({
        ...step,
        order: index + 1,
    }));
}

/**
 * Deduplicate steps that share >80% of the same files.
 * Keeps the step with the longer what_it_does explanation.
 */
export function deduplicateSteps(steps: TourStep[]): TourStep[] {
    if (steps.length <= 1) return steps;

    const result: TourStep[] = [];
    const merged = new Set<number>();

    for (let i = 0; i < steps.length; i++) {
        if (merged.has(i)) continue;

        let keeper = steps[i];
        for (let j = i + 1; j < steps.length; j++) {
            if (merged.has(j)) continue;

            const overlap = computeFileOverlap(keeper.files, steps[j].files);
            if (overlap > 0.8) {
                // Keep the step with the longer explanation
                if (steps[j].what_it_does.length > keeper.what_it_does.length) {
                    keeper = steps[j];
                }
                merged.add(j);
            }
        }
        result.push(keeper);
    }

    return result;
}

/**
 * Compute the Jaccard overlap ratio between two file arrays.
 * Returns 0 if both are empty, 1 if identical.
 */
export function computeFileOverlap(filesA: string[], filesB: string[]): number {
    if (filesA.length === 0 && filesB.length === 0) return 0;
    const setA = new Set(filesA);
    const setB = new Set(filesB);
    const intersection = [...setA].filter((f) => setB.has(f)).length;
    const union = new Set([...filesA, ...filesB]).size;
    return union === 0 ? 0 : intersection / union;
}

/**
 * Parse a one-shot LLM response containing tour steps.
 * Handles markdown code blocks, validates JSON structure, and filters steps against known files.
 */
export function parseTourResponse(
    responseText: string,
    report: AnalysisReport
): ParsedTourData {
    let jsonText = responseText.trim();
    const jsonMatch = jsonText.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
        jsonText = jsonMatch[1].trim();
    }

    let parsed: unknown;
    try {
        parsed = JSON.parse(jsonText);
    } catch (error) {
        throw new Error(`Failed to parse tour response as JSON: ${(error as Error).message}`);
    }

    if (typeof parsed !== 'object' || parsed === null) {
        throw new Error('LLM response was not a JSON object');
    }

    const payload = parsed as Record<string, any>;
    if (payload.rejected === true) {
        throw new Error(payload.reason || 'This question is not related to codebase exploration. Try asking about architecture, data flow, or dependencies.');
    }

    const validFiles = new Set(report.dependencyGraph.nodes);
    const isMock = payload.isMock === true;

    let steps: TourStep[] = (payload.steps || []).map((step: any, index: number) => ({
        order: step.order || index + 1,
        title: step.title || `Step ${index + 1}`,
        what_it_does: step.what_it_does || step.explanation || '',
        why_it_matters: step.why_it_matters || '',
        watch_out: standardizeWatchOut(step.watch_out || ''),
        files: (step.files || []).filter((file: string) => isMock || validFiles.has(file)),
        highlights: (step.highlights || []).filter((highlight: any) => isMock || validFiles.has(highlight.file)),
        relationships: (step.relationships || []).filter(
            (relationship: any) => isMock || (validFiles.has(relationship.from) && validFiles.has(relationship.to))
        ),
    }));

    // Filter out steps with insufficient content (unless mock)
    if (!isMock) {
        steps = steps.filter((step) => step.what_it_does.length >= MIN_WHAT_IT_DOES_CHARS);
    }

    // Deduplicate steps with overlapping file references
    steps = deduplicateSteps(steps);

    // Normalize step order to be sequential
    steps = normalizeStepOrders(steps);

    if (steps.length === 0) {
        throw new Error('LLM response did not contain any usable tour steps');
    }

    return { steps };
}

/**
 * Parse an NDJSON stream of tour steps.
 * Each line in the stream should be a complete JSON object representing a TourStep.
 * Yields validated TourStep objects as they become available.
 * Falls back to one-shot parsing if the stream contains a complete JSON object with "steps" array.
 */
export async function* parseNDJSONTourStream(
    stream: AsyncGenerator<string>,
    report: AnalysisReport
): AsyncGenerator<TourStep> {
    const validFiles = new Set(report.dependencyGraph.nodes);
    let buffer = '';
    let firstChunkProcessed = false;
    let inFence = false;
    let fenceBuffer = '';
    let stepCounter = 0;

    // Helper: build a TourStep from a parsed object, filtering to valid files only.
    const makeStep = (parsed: any, files: Set<string>): TourStep | null => {
        if (!parsed || typeof parsed !== 'object' || parsed.rejected) return null;

        const whatItDoes = parsed.what_it_does || '';
        // Filter out steps with insufficient content during streaming too
        if (whatItDoes.length < MIN_WHAT_IT_DOES_CHARS) return null;

        stepCounter += 1;
        return {
            order: stepCounter,
            title: parsed.title || 'Untitled',
            what_it_does: whatItDoes,
            why_it_matters: parsed.why_it_matters || '',
            watch_out: standardizeWatchOut(parsed.watch_out || ''),
            files: (parsed.files || []).filter((f: string) => files.has(f)),
            highlights: (parsed.highlights || []).filter((h: any) => files.has(h.file)),
            relationships: (parsed.relationships || []).filter(
                (r: any) => files.has(r.from) && files.has(r.to)
            ),
        };
    };

    for await (const chunk of stream) {
        buffer += chunk;

        // Detect one-shot fallback: accumulate buffer until we have enough
        // characters to distinguish NDJSON (lines of step objects) from a
        // wrapped JSON object like {"steps": [...]}.
        //
        // OpenAI-compatible streaming APIs (Groq, Anthropic, OpenAI) send
        // token fragments: '{', '"', 'steps', '":' etc. The first chunk is
        // usually just '{' — not enough to check for '{"steps":'.
        // We wait until we have 20+ chars or hit a newline before deciding.
        if (!firstChunkProcessed) {
            const trimmedBuffer = buffer.trim();
            const hasNewline = buffer.includes('\n');
            const hasEnoughChars = trimmedBuffer.length >= 20;

            if (hasNewline || hasEnoughChars) {
                firstChunkProcessed = true;

                // Strip markdown formatting if present to check the actual content
                let cleanBuffer = trimmedBuffer;
                if (cleanBuffer.startsWith('```json')) cleanBuffer = cleanBuffer.slice(7).trim();
                else if (cleanBuffer.startsWith('```')) cleanBuffer = cleanBuffer.slice(3).trim();

                // Strip whitespace to detect pretty-printed output like "{\n  \"steps\": ["
                const noSpaceBuffer = cleanBuffer.replace(/\s+/g, '');

                if (noSpaceBuffer.startsWith('{"steps":')) {
                    // One-shot format detected — consume entire stream and parse at once
                    for await (const remainingChunk of stream) {
                        buffer += remainingChunk;
                    }
                    const parsed = parseTourResponse(buffer, report);
                    for (const step of parsed.steps) {
                        yield step;
                    }
                    return;
                }

                // If it starts with '{' but NOT '{"order"' or '{"title"', it's
                // likely a wrapped JSON object (like {"steps":...} with extra
                // whitespace or different key ordering). Accumulate everything.
                if (
                    cleanBuffer.startsWith('{') &&
                    !noSpaceBuffer.startsWith('{"order"') &&
                    !noSpaceBuffer.startsWith('{"title"') &&
                    !hasNewline
                ) {
                    // Likely a single JSON object being streamed token-by-token.
                    // Consume the full stream and parse as one-shot.
                    for await (const remainingChunk of stream) {
                        buffer += remainingChunk;
                    }
                    try {
                        const parsed = parseTourResponse(buffer, report);
                        for (const step of parsed.steps) {
                            yield step;
                        }
                        return;
                    } catch {
                        // Fall through to line-by-line parsing
                    }
                }
            } else {
                // Not enough data yet — keep accumulating
                continue;
            }
        }

        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // Keep incomplete line in buffer

        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue; // Skip empty lines

            // Handle markdown code fence wrapping (gpt-4o ignores "no markdown" instruction)
            if (trimmed.startsWith('```')) {
                if (!inFence) {
                    inFence = true;
                    fenceBuffer = '';
                } else {
                    // Closing fence: flush any accumulated pretty-printed JSON
                    inFence = false;
                    const accumulated = fenceBuffer.trim();
                    if (accumulated) {
                        try {
                            const parsedFence = JSON.parse(accumulated);
                            const step = makeStep(parsedFence, validFiles);
                            if (step) yield step;
                        } catch { /* incomplete object — discard */ }
                    }
                    fenceBuffer = '';
                }
                continue;
            }

            if (inFence) {
                // Try parsing the line as a complete JSON step (compact single-line NDJSON).
                // If it parses, yield immediately for progressive streaming.
                // If it fails, accumulate into fenceBuffer for pretty-printed JSON.
                try {
                    const parsed = JSON.parse(trimmed);
                    const step = makeStep(parsed, validFiles);
                    if (step) {
                        yield step;
                        fenceBuffer = '';  // reset — previous partial is superseded
                        continue;
                    }
                } catch { /* not standalone JSON — accumulate for multi-line object */ }
                fenceBuffer += line + '\n';
                continue;
            }

            let parsed: any;
            try {
                parsed = JSON.parse(trimmed);
            } catch (error) {
                console.warn(`[parseNDJSONTourStream] Skipping invalid JSON line: ${trimmed.slice(0, 100)}`);
                continue;
            }

            const step = makeStep(parsed, validFiles);
            if (step) yield step;
        }
    }

    // Post-stream flush: process any remaining buffered content.
    // This handles cases where the VS Code LM stream ends before a closing ```
    // (common when the model hits its token limit mid-fence).
    const remainingLine = buffer.trim();
    if (remainingLine) {
        try {
            const parsed = JSON.parse(remainingLine);
            const step = makeStep(parsed, validFiles);
            if (step) yield step;
        } catch { /* incomplete line — discard */ }
    }

    const remainingFence = fenceBuffer.trim();
    if (remainingFence) {
        try {
            const parsedFence = JSON.parse(remainingFence);
            const step = makeStep(parsedFence, validFiles);
            if (step) yield step;
        } catch {
            // Try line-by-line for NDJSON inside unclosed fence
            for (const fenceLine of remainingFence.split('\n')) {
                const ft = fenceLine.trim();
                if (!ft) continue;
                try {
                    const parsedLine = JSON.parse(ft);
                    const step = makeStep(parsedLine, validFiles);
                    if (step) yield step;
                } catch { /* discard */ }
            }
        }
    }
}
