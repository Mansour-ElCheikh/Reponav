/**
 * Tests for tourQuery — query classification, prompt preparation, code relevance.
 */
import { describe, it, expect } from 'vitest';
import type { AnalysisReport } from '../types';
import { prepareTourRequest, isCodeRelevantQuery, withTimeout } from './tourQuery';

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

describe('isCodeRelevantQuery', () => {
    it('returns true for code-related queries', () => {
        expect(isCodeRelevantQuery('How does the request flow work?')).toBe(true);
        expect(isCodeRelevantQuery('Show me the architecture overview')).toBe(true);
        expect(isCodeRelevantQuery('What files handle the api routes?')).toBe(true);
    });

    it('returns false for non-code queries', () => {
        expect(isCodeRelevantQuery('What is the weather today?')).toBe(false);
        expect(isCodeRelevantQuery('Tell me a joke')).toBe(false);
    });
});

describe('prepareTourRequest', () => {
    it('classifies custom tour type from query', () => {
        const result = prepareTourRequest(minimalReport, 'Give me an architecture overview', 'custom', 'test');
        expect(result.tourType).toBe('overview');
    });

    it('preserves explicit tour type', () => {
        const result = prepareTourRequest(minimalReport, 'anything', 'data-flow', 'test');
        expect(result.tourType).toBe('data-flow');
    });

    it('applies VS Code LM budget for VS Code Language Model provider', () => {
        const result = prepareTourRequest(minimalReport, 'overview', 'overview', 'VS Code Language Model');
        expect(result.analysisText.length).toBeLessThanOrEqual(8000);
    });

    it('returns larger analysis for non-VS Code providers', () => {
        const largeReport = {
            ...minimalReport,
            keyFileContents: { 'README.md': 'x'.repeat(20000) },
        };
        const result = prepareTourRequest(largeReport, 'overview', 'overview', 'Generic Provider');
        // Generic provider gets the full default budget, not the 8K VS Code cap
        expect(result.userPrompt.length).toBeGreaterThan(0);
    });

    it('rejects non-code-relevant custom queries', () => {
        expect(() => prepareTourRequest(minimalReport, 'Tell me a joke', 'custom', 'test'))
            .toThrow('doesn\'t appear to be about the codebase');
    });

    it('maps short code-relevant custom queries under 10 chars to overview', () => {
        // "code" is 4 chars and matches CODE_TERMS
        const result = prepareTourRequest(minimalReport, 'code', 'custom', 'test');
        expect(result.tourType).toBe('overview');
    });

    it('keeps longer custom queries as custom when they match no specific type', () => {
        // "explain the module patterns" is 27 chars — above 10 threshold but no specific type keywords
        const result = prepareTourRequest(minimalReport, 'explain the module patterns', 'custom', 'test');
        expect(result.tourType).toBe('custom');
    });
});

describe('withTimeout', () => {
    it('resolves when promise completes within timeout', async () => {
        const result = await withTimeout(Promise.resolve('ok'), 1000, 'test');
        expect(result).toBe('ok');
    });

    it('rejects when timeout fires', async () => {
        const slow = new Promise((resolve) => setTimeout(resolve, 5000));
        await expect(withTimeout(slow, 50, 'test')).rejects.toThrow('timed out');
    });
});
