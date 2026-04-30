/**
 * Tests for the validation gate — validates tour output against schema + token budget + quality.
 */

import { describe, it, expect } from 'vitest';
import { validateTourOutput, ValidationResult } from './gate';

// Use content that meets the new minimum length requirements:
// what_it_does >= 30 chars, why_it_matters >= 15 chars, watch_out >= 1 char
const validTour = {
    id: 'tour-1',
    query: 'How does auth work?',
    tourType: 'overview' as const,
    steps: [
        {
            order: 1,
            title: 'Auth entry',
            what_it_does: 'AuthController.login handles incoming login requests, validating credentials against the user store.',
            why_it_matters: 'This is the single entry point for all authentication flows in the application.',
            watch_out: 'Token expiry is handled separately in the refresh endpoint.',
            files: ['src/auth.ts'],
            highlights: [],
            relationships: [],
        },
        {
            order: 2,
            title: 'Token validation',
            what_it_does: 'TokenService.verify checks JWT signatures and decodes the user payload for downstream middleware.',
            why_it_matters: 'Every protected route depends on this validation step for access control.',
            watch_out: 'Clock skew can cause premature token rejection.',
            files: ['src/auth.ts'],
            highlights: [],
            relationships: [],
        },
        {
            order: 3,
            title: 'Session management',
            what_it_does: 'SessionStore.persist writes validated sessions to the database via a transactional write pattern.',
            why_it_matters: 'Persistent sessions allow users to stay logged in across browser restarts.',
            watch_out: 'Session cleanup runs on a 24h cron — stale sessions can accumulate.',
            files: ['src/auth.ts'],
            highlights: [],
            relationships: [],
        },
    ],
    graph: { nodes: [], edges: [] },
    analysisSnapshot: {
        frameworks: ['express'],
        entryPoints: ['src/index.ts'],
        totalFiles: 42,
        totalEdges: 100,
        circularCount: 0,
    },
    createdAt: '2026-03-20T10:00:00Z',
};

describe('validateTourOutput', () => {
    it('passes for valid tour within budget', () => {
        const result = validateTourOutput(validTour);
        expect(result.valid).toBe(true);
        expect(result.errors).toHaveLength(0);
        expect(result.tokenEstimate).toBeGreaterThan(0);
    });

    it('fails for invalid tour (missing required fields)', () => {
        const { id, ...noId } = validTour;
        const result = validateTourOutput(noId);
        expect(result.valid).toBe(false);
        expect(result.errors.length).toBeGreaterThan(0);
    });

    it('fails when token budget exceeded', () => {
        const bigTour = {
            ...validTour,
            steps: Array.from({ length: 5 }, (_, i) => ({
                order: i + 1,
                title: 'Step '.padEnd(200, 'x'),
                what_it_does: 'This function handles the full lifecycle of request processing. '.repeat(10),
                why_it_matters: 'Critical for the architecture because it connects all layers. '.repeat(5),
                watch_out: 'Performance degrades under concurrent load due to synchronous I/O. '.repeat(5),
                files: ['src/auth.ts'],
                highlights: [],
                relationships: [],
            })),
        };
        const result = validateTourOutput(bigTour, { maxTokens: 100 });
        expect(result.valid).toBe(false);
        expect(result.errors.some(e => e.includes('Token budget'))).toBe(true);
    });

    it('allows custom token budget', () => {
        const result = validateTourOutput(validTour, { maxTokens: 100000 });
        expect(result.valid).toBe(true);
    });

    it('validates file references against known files when provided', () => {
        const knownFiles = new Set(['src/index.ts']);
        const result = validateTourOutput(validTour, { knownFiles });
        expect(result.valid).toBe(false);
        expect(result.errors.some(e => e.includes('src/auth.ts'))).toBe(true);
    });

    it('passes file validation when all files are known', () => {
        const knownFiles = new Set(['src/auth.ts', 'src/index.ts']);
        const result = validateTourOutput(validTour, { knownFiles });
        expect(result.valid).toBe(true);
    });

    it('skips file validation when knownFiles not provided', () => {
        const result = validateTourOutput(validTour);
        expect(result.valid).toBe(true);
    });

    it('reports schema version in result', () => {
        const result = validateTourOutput(validTour);
        expect(result.schemaVersion).toMatch(/^\d+\.\d+\.\d+$/);
    });

    // ─── New quality gate tests ──────────────────────────────────────────

    it('fails when too few steps (below minimum of 3)', () => {
        const tooFewSteps = {
            ...validTour,
            steps: [validTour.steps[0]],
        };
        const result = validateTourOutput(tooFewSteps);
        expect(result.valid).toBe(false);
        expect(result.errors.some(e => e.includes('Too few steps'))).toBe(true);
    });

    it('fails when too many steps (above maximum of 8)', () => {
        const tooManySteps = {
            ...validTour,
            steps: Array.from({ length: 9 }, (_, i) => ({
                ...validTour.steps[0],
                order: i + 1,
                title: `Step ${i + 1}`,
            })),
        };
        const result = validateTourOutput(tooManySteps);
        expect(result.valid).toBe(false);
        expect(result.errors.some(e => e.includes('Too many steps'))).toBe(true);
    });

    it('fails when what_it_does is too short', () => {
        const shortContent = {
            ...validTour,
            steps: validTour.steps.map((s, i) => i === 0 ? { ...s, what_it_does: 'too short' } : s),
        };
        const result = validateTourOutput(shortContent);
        expect(result.valid).toBe(false);
        expect(result.errors.some(e => e.includes('what_it_does'))).toBe(true);
    });

    it('fails when why_it_matters is too short', () => {
        const shortContent = {
            ...validTour,
            steps: validTour.steps.map((s, i) => i === 0 ? { ...s, why_it_matters: 'short' } : s),
        };
        const result = validateTourOutput(shortContent);
        expect(result.valid).toBe(false);
        expect(result.errors.some(e => e.includes('why_it_matters'))).toBe(true);
    });

    it('includes warnings for steps with zero files', () => {
        const noFileStep = {
            ...validTour,
            steps: validTour.steps.map((s, i) => i === 0 ? { ...s, files: [] } : s),
        };
        const result = validateTourOutput(noFileStep);
        expect(result.warnings.some(w => w.includes('no files'))).toBe(true);
    });

    it('returns a warnings array even when valid', () => {
        const result = validateTourOutput(validTour);
        expect(Array.isArray(result.warnings)).toBe(true);
    });
});
