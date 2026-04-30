/**
 * Tests for tour Zod schemas — validates Tour and TourStep structures.
 */

import { describe, it, expect } from 'vitest';
import {
    TOUR_SCHEMA_VERSION,
    TourStepSchema,
    TourSchema,
    CodeHighlightSchema,
    FileRelationshipSchema,
    GraphNodeSchema,
    GraphEdgeSchema,
    TourGraphSchema,
} from './tourSchema';

describe('TOUR_SCHEMA_VERSION', () => {
    it('is a semver string', () => {
        expect(TOUR_SCHEMA_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    });

    it('is version 1.2.0 after quality hardening', () => {
        expect(TOUR_SCHEMA_VERSION).toBe('1.2.0');
    });
});

describe('CodeHighlightSchema', () => {
    it('rejects missing file', () => {
        const result = CodeHighlightSchema.safeParse({ lines: [1] });
        expect(result.success).toBe(false);
    });
});

describe('FileRelationshipSchema', () => {
    it('rejects invalid relationship type', () => {
        const result = FileRelationshipSchema.safeParse({
            from: 'a', to: 'b', type: 'destroys',
        });
        expect(result.success).toBe(false);
    });
});

describe('TourStepSchema', () => {
    const validStep = {
        order: 1,
        title: 'Entry Point',
        what_it_does: 'AuthController.login handles incoming login requests, validating credentials against the user store.',
        why_it_matters: 'Everything starts here — this is the main bootstrap path.',
        watch_out: 'Complex initialization may timeout under heavy load.',
        files: ['src/index.ts'],
        highlights: [],
        relationships: [],
    };

    it.each<readonly [string, object]>([
        ['missing title', (() => {
            const { title, ...noTitle } = validStep;
            return noTitle;
        })()],
        ['missing files array', (() => {
            const { files, ...noFiles } = validStep;
            return noFiles;
        })()],
        ['negative order', { ...validStep, order: -1 }],
    ])('rejects a step with %s', (_label, invalidStep) => {
        const result = TourStepSchema.safeParse(invalidStep);
        expect(result.success).toBe(false);
    });

    // ─── New minimum length enforcement tests ─────────────────────────

    it('rejects what_it_does shorter than 30 characters', () => {
        const result = TourStepSchema.safeParse({
            ...validStep,
            what_it_does: 'too short',
        });
        expect(result.success).toBe(false);
    });

    it('rejects why_it_matters shorter than 15 characters', () => {
        const result = TourStepSchema.safeParse({
            ...validStep,
            why_it_matters: 'short',
        });
        expect(result.success).toBe(false);
    });

    it('rejects empty watch_out', () => {
        const result = TourStepSchema.safeParse({
            ...validStep,
            watch_out: '',
        });
        expect(result.success).toBe(false);
    });

    it('accepts valid step with adequate content lengths', () => {
        const result = TourStepSchema.safeParse(validStep);
        expect(result.success).toBe(true);
    });
});

describe('TourGraphSchema', () => {
    it('rejects a graph edge without a source node id', () => {
        const result = TourGraphSchema.safeParse({
            nodes: [{ id: 'src/a.ts', label: 'a.ts', type: 'utility' }],
            edges: [{ target: 'src/b.ts', label: 'imports' }],
        });
        expect(result.success).toBe(false);
    });
});

describe('TourSchema', () => {
    const validTour = {
        id: 'tour-123',
        query: 'How does auth work?',
        tourType: 'overview' as const,
        steps: [{
            order: 1,
            title: 'Auth entry',
            what_it_does: 'AuthController.login handles incoming login requests, validating credentials against the user store.',
            why_it_matters: 'This is the single entry point for all authentication flows.',
            watch_out: 'Token expiry is handled separately in the refresh endpoint.',
            files: ['src/auth.ts'],
            highlights: [],
            relationships: [],
        }],
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

    it.each<readonly [string, object]>([
        ['missing steps', (() => {
            const { steps, ...noSteps } = validTour;
            return noSteps;
        })()],
        ['empty id', { ...validTour, id: '' }],
        ['invalid tourType', { ...validTour, tourType: 'invalid' }],
    ])('rejects a tour with %s', (_label, invalidTour) => {
        const result = TourSchema.safeParse(invalidTour);
        expect(result.success).toBe(false);
    });

    it('accepts all valid tourType values', () => {
        for (const tourType of ['overview', 'data-flow', 'onboarding', 'dependency-audit', 'api-surface', 'custom']) {
            const result = TourSchema.safeParse({ ...validTour, tourType });
            expect(result.success).toBe(true);
        }
    });
});

describe('tour schemas — valid examples', () => {
    it.each<readonly [string, unknown]>([
        ['highlight', { file: 'src/foo.ts', lines: [1, 2, 3] }],
        ['relationship', { from: 'src/a.ts', to: 'src/b.ts', type: 'imports' }],
        ['step', {
            order: 1,
            title: 'Entry Point',
            what_it_does: 'AuthController.login handles incoming login requests, validating credentials against the user store.',
            why_it_matters: 'Everything starts here — this is the main bootstrap path.',
            watch_out: 'Complex initialization may timeout under heavy load.',
            files: ['src/index.ts'],
            highlights: [],
            relationships: [],
        }],
        ['graph with nodes and edges', {
            nodes: [{ id: 'src/a.ts', label: 'a.ts', type: 'utility' }],
            edges: [{ source: 'src/a.ts', target: 'src/b.ts', label: 'imports' }],
        }],
        ['empty graph', { nodes: [], edges: [] }],
        ['tour', {
            id: 'tour-123',
            query: 'How does auth work?',
            tourType: 'overview',
            steps: [{
                order: 1,
                title: 'Auth entry',
                what_it_does: 'AuthController.login handles incoming login requests, validating credentials against the user store.',
                why_it_matters: 'This is the single entry point for all authentication flows.',
                watch_out: 'Token expiry is handled separately in the refresh endpoint.',
                files: ['src/auth.ts'],
                highlights: [],
                relationships: [],
            }],
            graph: { nodes: [], edges: [] },
            analysisSnapshot: {
                frameworks: ['express'],
                entryPoints: ['src/index.ts'],
                totalFiles: 42,
                totalEdges: 100,
                circularCount: 0,
            },
            createdAt: '2026-03-20T10:00:00Z',
        }],
    ])('accepts a valid %s payload', (label, payload) => {
        const schema = label === 'highlight'
            ? CodeHighlightSchema
            : label === 'relationship'
                ? FileRelationshipSchema
                : label === 'step'
                    ? TourStepSchema
                    : label === 'graph with nodes and edges' || label === 'empty graph'
                        ? TourGraphSchema
                        : TourSchema;
        const result = schema.safeParse(payload);
        expect(result.success).toBe(true);
    });
});
