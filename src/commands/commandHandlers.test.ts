import { describe, expect, it, vi } from 'vitest';
import type { AnalysisReport } from '../types';
import {
    TOUR_TYPE_QUICK_PICK_OPTIONS,
    buildAnalysisCompleteMessage,
    createAnalyzeWorkspaceHandler,
    createClearCacheHandler,
    createGenerateTourHandler,
} from './commandHandlers';

function makeReport(): AnalysisReport {
    return {
        timestamp: new Date().toISOString(),
        workspaceRoot: '/workspace',
        indexTier: 1,
        frameworks: [{ name: 'React', type: 'framework', evidence: 'package.json dependency "react"' }],
        primaryLanguage: 'typescript',
        entryPoints: [
            { file: 'src/main.ts', type: 'main', entrySurface: 'runtime', confidence: 'high', reason: 'entrypoint' },
            { file: 'bin/reponav.ts', type: 'cli', entrySurface: 'tooling', confidence: 'high', reason: 'cli launch surface' },
        ],
        dependencyGraph: {
            nodes: ['src/main.ts', 'src/app.ts'],
            edges: [{ source: 'src/main.ts', target: 'src/app.ts', specifiers: [], isDynamic: false, rawStatement: '' }],
            circularDependencies: [],
        },
        fileClassifications: [],
        metrics: {
            totalFiles: 2,
            totalLines: 120,
            fileMetrics: [],
            hotFiles: [],
            orphanFiles: [],
        },
        completeness: {
            analysisScope: 'interactive',
            analyzedFileCount: 2,
            graphNodeCount: 2,
            graphEdgeCount: 1,
            graphSampleLimit: 200,
            analysisCoverage: 'sampled',
            graphCoverage: 'sampled',
        },
        fileTree: {},
        keyFileContents: {},
    };
}

describe('commandHandlers', () => {
    it('exports the expected tour type quick-pick options', () => {
        expect(TOUR_TYPE_QUICK_PICK_OPTIONS.map((option) => option.type)).toEqual([
            'overview',
            'data-flow',
            'onboarding',
            'dependency-audit',
            'api-surface',
            'custom',
        ]);
    });

    it('creates a generate-tour handler that uses a preset selection directly', async () => {
        const generateAndShowTour = vi.fn(async () => undefined);
        const handler = createGenerateTourHandler({
            promptForTourType: vi.fn(async () => TOUR_TYPE_QUICK_PICK_OPTIONS[0]),
            promptForCustomQuery: vi.fn(async () => undefined),
            generateAndShowTour,
        });

        await handler();

        expect(generateAndShowTour).toHaveBeenCalledWith(
            TOUR_TYPE_QUICK_PICK_OPTIONS[0].description,
            TOUR_TYPE_QUICK_PICK_OPTIONS[0].type
        );
    });

    it('creates a generate-tour handler that asks for a custom query when needed', async () => {
        const generateAndShowTour = vi.fn(async () => undefined);
        const handler = createGenerateTourHandler({
            promptForTourType: vi.fn(async () => TOUR_TYPE_QUICK_PICK_OPTIONS[5]),
            promptForCustomQuery: vi.fn(async () => 'How does auth work?'),
            generateAndShowTour,
        });

        await handler();

        expect(generateAndShowTour).toHaveBeenCalledWith('How does auth work?', 'custom');
    });

    it('builds the same analysis summary message shape used by the analyze command', () => {
        const message = buildAnalysisCompleteMessage(makeReport());

        expect(message).toContain('Analysis Complete');
        expect(message).toContain('Files: 2');
        expect(message).toContain('Dependencies: 1 edges');
        expect(message).toContain('Frameworks: React');
        expect(message).toContain('Entry Points: 1');
        expect(message).toContain('Launch Surfaces: 1');
        expect(message).toContain('Scope: interactive sampled overview');
    });

    it('creates an analyze-workspace handler that can trigger generate-tour follow-up', async () => {
        const showNoWorkspaceError = vi.fn();
        const executeGenerateTour = vi.fn();
        const handler = createAnalyzeWorkspaceHandler({
            getWorkspaceRoot: () => '/workspace',
            showNoWorkspaceError,
            runAnalysis: async () => makeReport(),
            promptAfterAnalysis: async () => 'Generate Tour',
            executeGenerateTour,
        });

        await handler();

        expect(showNoWorkspaceError).not.toHaveBeenCalled();
        expect(executeGenerateTour).toHaveBeenCalledTimes(1);
    });

    it('creates a clear-cache handler that deletes the DB file and invalidates memory cache', async () => {
        const deleteDbFile = vi.fn(async () => undefined);
        const invalidateMemoryCache = vi.fn();
        const showConfirmation = vi.fn();
        const handler = createClearCacheHandler({
            getWorkspaceRoot: () => '/workspace',
            showNoWorkspaceError: vi.fn(),
            deleteDbFile,
            invalidateMemoryCache,
            showConfirmation,
        });

        await handler();

        expect(deleteDbFile).toHaveBeenCalledWith('/workspace/.reponav/index.db');
        expect(invalidateMemoryCache).toHaveBeenCalledTimes(1);
        expect(showConfirmation).toHaveBeenCalledTimes(1);
    });

    it('creates a clear-cache handler that shows error when no workspace is open', async () => {
        const showNoWorkspaceError = vi.fn();
        const deleteDbFile = vi.fn(async () => undefined);
        const handler = createClearCacheHandler({
            getWorkspaceRoot: () => undefined,
            showNoWorkspaceError,
            deleteDbFile,
            invalidateMemoryCache: vi.fn(),
            showConfirmation: vi.fn(),
        });

        await handler();

        expect(showNoWorkspaceError).toHaveBeenCalledTimes(1);
        expect(deleteDbFile).not.toHaveBeenCalled();
    });
});
