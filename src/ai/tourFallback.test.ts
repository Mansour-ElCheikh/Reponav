/**
 * Tests for tourFallback — structural fallback tour generation.
 */
import { describe, it, expect } from 'vitest';
import type { AnalysisReport } from '../types';
import { buildStructuralFallbackTour, generateTourId } from './tourFallback';

const minimalReport: AnalysisReport = {
    timestamp: new Date().toISOString(),
    workspaceRoot: '/workspace',
    indexTier: 1,
    frameworks: [],
    primaryLanguage: 'typescript',
    entryPoints: [{ file: 'src/index.ts', type: 'main', confidence: 'high', reason: 'package.json main' }],
    dependencyGraph: {
        nodes: ['src/index.ts', 'src/app.ts'],
        edges: [{ source: 'src/index.ts', target: 'src/app.ts', specifiers: [], isDynamic: false, rawStatement: "import './app';" }],
        circularDependencies: [],
    },
    fileClassifications: [
        { path: 'src/index.ts', category: 'entry', confidence: 'high', reason: 'main' },
        { path: 'src/app.ts', category: 'service', confidence: 'medium', reason: 'naming' },
    ],
    metrics: {
        totalFiles: 2,
        totalLines: 50,
        fileMetrics: [
            { path: 'src/index.ts', lines: 30, importCount: 1, exportCount: 0, fanIn: 0, fanOut: 1 },
            { path: 'src/app.ts', lines: 20, importCount: 0, exportCount: 1, fanIn: 1, fanOut: 0 },
        ],
        hotFiles: [
            { path: 'src/app.ts', lines: 20, importCount: 0, exportCount: 1, fanIn: 1, fanOut: 0 },
        ],
        orphanFiles: [],
    },
    fileTree: {},
    keyFileContents: {},
};

describe('generateTourId', () => {
    it('produces IDs starting with tour_', () => {
        const id = generateTourId();
        expect(id).toMatch(/^tour_/);
    });

    it('produces unique IDs', () => {
        const ids = new Set(Array.from({ length: 100 }, () => generateTourId()));
        expect(ids.size).toBe(100);
    });
});

describe('buildStructuralFallbackTour', () => {
    it('produces a tour with steps from entry points', () => {
        const tour = buildStructuralFallbackTour(minimalReport, 'overview', 'overview');
        expect(tour.id).toMatch(/^tour_/);
        expect(tour.steps.length).toBeGreaterThan(0);
        expect(tour.steps[0].files).toContain('src/index.ts');
        expect(tour.aiGenerated).toBe(false);
    });

    it('produces a structural overview when no entry points exist', () => {
        const emptyReport = { ...minimalReport, entryPoints: [], metrics: { ...minimalReport.metrics, hotFiles: [] } };
        const tour = buildStructuralFallbackTour(emptyReport, 'overview', 'overview');
        expect(tour.steps.length).toBeGreaterThanOrEqual(1);
        expect(tour.steps[0].what_it_does).toContain('files');
    });

    it('includes analysisSnapshot', () => {
        const tour = buildStructuralFallbackTour(minimalReport, 'test query', 'overview');
        expect(tour.analysisSnapshot.totalFiles).toBe(2);
        expect(tour.query).toBe('test query');
    });

    // ─── New hardening tests ─────────────────────────────────────────

    it('produces at least 3 steps by padding with hot files', () => {
        // Only 1 entry point, but with hot files available, should pad to 3
        const reportWith3HotFiles: AnalysisReport = {
            ...minimalReport,
            dependencyGraph: {
                nodes: ['src/index.ts', 'src/a.ts', 'src/b.ts', 'src/c.ts'],
                edges: [],
                circularDependencies: [],
            },
            metrics: {
                ...minimalReport.metrics,
                hotFiles: [
                    { path: 'src/a.ts', lines: 100, importCount: 5, exportCount: 3, fanIn: 8, fanOut: 2 },
                    { path: 'src/b.ts', lines: 80, importCount: 3, exportCount: 2, fanIn: 6, fanOut: 1 },
                    { path: 'src/c.ts', lines: 50, importCount: 2, exportCount: 1, fanIn: 4, fanOut: 3 },
                ],
                fileMetrics: [
                    { path: 'src/index.ts', lines: 30, importCount: 1, exportCount: 0, fanIn: 0, fanOut: 1 },
                    { path: 'src/a.ts', lines: 100, importCount: 5, exportCount: 3, fanIn: 8, fanOut: 2 },
                    { path: 'src/b.ts', lines: 80, importCount: 3, exportCount: 2, fanIn: 6, fanOut: 1 },
                    { path: 'src/c.ts', lines: 50, importCount: 2, exportCount: 1, fanIn: 4, fanOut: 3 },
                ],
            },
            fileClassifications: [
                { path: 'src/index.ts', category: 'entry', confidence: 'high', reason: 'main' },
                { path: 'src/a.ts', category: 'service', confidence: 'medium', reason: 'naming' },
                { path: 'src/b.ts', category: 'utility', confidence: 'medium', reason: 'naming' },
                { path: 'src/c.ts', category: 'controller', confidence: 'medium', reason: 'naming' },
            ],
        };

        const tour = buildStructuralFallbackTour(reportWith3HotFiles, 'overview', 'overview');
        expect(tour.steps.length).toBeGreaterThanOrEqual(3);
    });

    it('includes file classifications in step descriptions', () => {
        const tour = buildStructuralFallbackTour(minimalReport, 'overview', 'overview');
        const firstStep = tour.steps[0];
        // Should mention the classification
        expect(firstStep.what_it_does).toContain('entry');
    });

    it('includes fan-in/fan-out metrics in step descriptions', () => {
        const tour = buildStructuralFallbackTour(minimalReport, 'overview', 'overview');
        const firstStep = tour.steps[0];
        // Should mention dependency metrics
        expect(firstStep.what_it_does).toMatch(/fan-in|dependent|imports/i);
    });

    it('includes relationships from dependency graph edges', () => {
        const tour = buildStructuralFallbackTour(minimalReport, 'overview', 'overview');
        const entryStep = tour.steps.find(s => s.files.includes('src/index.ts'));
        expect(entryStep?.relationships.length).toBeGreaterThan(0);
        expect(entryStep?.relationships[0]).toEqual({
            from: 'src/index.ts',
            to: 'src/app.ts',
            type: 'imports',
        });
    });

    it('provides richer why_it_matters for entry points', () => {
        const tour = buildStructuralFallbackTour(minimalReport, 'overview', 'overview');
        const firstStep = tour.steps[0];
        // Should be more descriptive than just "structural data only"
        expect(firstStep.why_it_matters.length).toBeGreaterThan(30);
        expect(firstStep.why_it_matters).not.toContain('showing structural data only');
    });
});
