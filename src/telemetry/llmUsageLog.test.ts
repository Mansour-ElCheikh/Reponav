import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

// Mock the append module BEFORE importing the SUT so the sink redirection takes effect.
let capturedRecord: Record<string, unknown> | null = null;
vi.mock('./append', () => ({
    appendJsonl: (_sink: string, record: Record<string, unknown>) => {
        capturedRecord = record;
    },
}));

import { logLLMUsage } from './llmUsageLog';

describe('logLLMUsage — schema normalization (S1.5a)', () => {
    beforeEach(() => {
        capturedRecord = null;
    });

    it('records prompt/completion tokens unchanged when supplied directly', () => {
        logLLMUsage({
            provider: 'mock',
            promptTokens: 100,
            completionTokens: 250,
            totalTokens: 350,
            durationMs: 500,
        });
        expect(capturedRecord).toMatchObject({
            provider: 'mock',
            promptTokens: 100,
            completionTokens: 250,
            totalTokens: 350,
            // The new schema mirrors prompt → input, completion → output.
            inputTokens: 100,
            outputTokens: 250,
        });
    });

    it('mirrors inputTokens/outputTokens back to promptTokens/completionTokens', () => {
        logLLMUsage({
            provider: 'stream-path',
            inputTokens: 42,
            outputTokens: 17,
            durationMs: 1,
        });
        expect(capturedRecord).toMatchObject({
            provider: 'stream-path',
            inputTokens: 42,
            outputTokens: 17,
            promptTokens: 42,
            completionTokens: 17,
            totalTokens: 59,
        });
    });

    it('omits token fields entirely when neither schema is supplied (failed call path)', () => {
        logLLMUsage({
            provider: 'failed-provider',
            durationMs: 5,
            cascadeFailed: true,
            error: 'no api key',
        });
        expect(capturedRecord).toBeTruthy();
        const r = capturedRecord as Record<string, unknown>;
        expect(r.provider).toBe('failed-provider');
        expect(r.cascadeFailed).toBe(true);
        expect(r.inputTokens).toBeUndefined();
        expect(r.outputTokens).toBeUndefined();
        expect(r.promptTokens).toBeUndefined();
        expect(r.completionTokens).toBeUndefined();
        expect(r.totalTokens).toBeUndefined();
    });

    it('preserves explicit totalTokens over derived sum when both pairs supplied', () => {
        logLLMUsage({
            provider: 'mock',
            promptTokens: 100,
            completionTokens: 200,
            totalTokens: 999, // explicit value should win
            durationMs: 1,
        });
        const r = capturedRecord as Record<string, unknown>;
        expect(r.totalTokens).toBe(999);
    });
});
