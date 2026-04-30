import { describe, expect, it } from 'vitest';
import { isExtensionToWebviewMessage } from './messageGuards';

describe('isExtensionToWebviewMessage', () => {
    it('accepts valid appConfig payload', () => {
        const payload = {
            type: 'appConfig',
            config: {
                demoMode: true,
            },
        };

        expect(isExtensionToWebviewMessage(payload)).toBe(true);
    });

    it('rejects malformed payload', () => {
        const payload = {
            type: 'error',
            message: 42,
        };

        expect(isExtensionToWebviewMessage(payload)).toBe(false);
    });

    it('rejects unknown message type', () => {
        const payload = {
            type: 'madeUpType',
        };

        expect(isExtensionToWebviewMessage(payload)).toBe(false);
    });

    it('accepts valid tourGenerated payload', () => {
        const payload = {
            type: 'tourGenerated',
            tour: {
                id: 'tour-1',
                query: 'overview',
                tourType: 'overview',
                createdAt: '2026-03-09T00:00:00.000Z',
                steps: [{
                    order: 1,
                    title: 'Step 1',
                    what_it_does: 'Does a thing',
                    why_it_matters: 'It matters',
                    watch_out: 'No major gotchas here.',
                    files: ['src/index.ts'],
                    highlights: [],
                    relationships: [],
                }],
                graph: {
                    nodes: [{ id: 'src/index.ts', label: 'index.ts', type: 'entry' }],
                    edges: [{ source: 'src/index.ts', target: 'src/app.ts', label: 'imports' }],
                },
                analysisSnapshot: {
                    frameworks: ['react'],
                    entryPoints: ['src/index.ts'],
                    totalFiles: 10,
                    totalEdges: 20,
                    circularCount: 0,
                },
            },
        };

        expect(isExtensionToWebviewMessage(payload)).toBe(true);
    });

    it('rejects malformed tourGenerated payload', () => {
        const payload = {
            type: 'tourGenerated',
            tour: {
                id: 'tour-1',
                // missing query
                tourType: 'overview',
                createdAt: '2026-03-09T00:00:00.000Z',
                steps: [],
                graph: { nodes: [], edges: [] },
                analysisSnapshot: {
                    frameworks: [],
                    entryPoints: [],
                    totalFiles: 10,
                    totalEdges: 20,
                    circularCount: 0,
                },
            },
        };

        expect(isExtensionToWebviewMessage(payload)).toBe(false);
    });

    it('rejects malformed savedTours payload entries', () => {
        const payload = {
            type: 'savedTours',
            tours: [
                {
                    id: '1',
                    query: 'overview',
                    tourType: 'overview',
                    stepCount: '4',
                    createdAt: '2026-03-09T00:00:00.000Z',
                },
            ],
        };

        expect(isExtensionToWebviewMessage(payload)).toBe(false);
    });

    it('rejects malformed gitStatus change entries', () => {
        const payload = {
            type: 'gitStatus',
            branch: 'main',
            changes: [
                { path: 'src/index.ts', status: 2 },
            ],
        };

        expect(isExtensionToWebviewMessage(payload)).toBe(false);
    });
});
