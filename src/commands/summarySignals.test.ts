import { describe, expect, it } from 'vitest';
import type { AnalysisReport } from '../types';
import { buildSummaryPayload, validateSummarySignalContract } from './summarySignals';

describe('summarySignals', () => {
    function makeSummaryReport(): AnalysisReport {
        return {
            timestamp: new Date().toISOString(),
            workspaceRoot: '/repo',
            indexTier: 6,
            frameworks: [{ name: 'React', type: 'framework', evidence: 'pkg' }],
            primaryLanguage: 'typescript',
            entryPoints: [
                { file: 'src/main.ts', type: 'main', entrySurface: 'runtime', confidence: 'high', reason: 'bootstrap' },
                { file: 'bin/reponav.ts', type: 'cli', entrySurface: 'tooling', confidence: 'high', reason: 'cli' },
            ],
            dependencyGraph: {
                nodes: ['src/main.ts', 'src/app.ts', 'src/lib.ts', 'bin/reponav.ts'],
                edges: [
                    { source: 'src/app.ts', target: 'src/lib.ts', specifiers: [], isDynamic: false, rawStatement: '' },
                    { source: 'src/main.ts', target: 'src/app.ts', specifiers: [], isDynamic: false, rawStatement: '' },
                    { source: 'bin/reponav.ts', target: 'src/lib.ts', specifiers: [], isDynamic: false, rawStatement: '' },
                ],
                circularDependencies: [],
            },
            fileClassifications: [],
            metrics: {
                totalFiles: 4,
                totalLines: 100,
                fileMetrics: [
                    { path: 'src/main.ts', lines: 10, importCount: 1, exportCount: 1, fanIn: 0, fanOut: 1, instability: 1 },
                    { path: 'src/app.ts', lines: 20, importCount: 1, exportCount: 1, fanIn: 1, fanOut: 1, instability: 0.5 },
                    { path: 'src/lib.ts', lines: 30, importCount: 0, exportCount: 1, fanIn: 2, fanOut: 0, instability: 0 },
                    { path: 'bin/reponav.ts', lines: 12, importCount: 1, exportCount: 1, fanIn: 0, fanOut: 1, instability: 1 },
                ],
                hotFiles: [
                    { path: 'src/lib.ts', lines: 30, importCount: 0, exportCount: 1, fanIn: 2, fanOut: 0, instability: 0 },
                ],
                orphanFiles: ['src/orphan.ts'],
            },
            temporal: {
                averageChurn: 1,
                mostUnstableFiles: ['src/app.ts'],
                hotspots: [
                    { filePath: 'src/lib.ts', commitCount: 5, lastChangedAt: '2026-05-02T00:00:00.000Z', complexityScore: 2, riskScore: 4 },
                    { filePath: 'src/app.ts', commitCount: 3, lastChangedAt: '2026-01-10T00:00:00.000Z', complexityScore: 2, riskScore: 2 },
                ],
                knowledge: [
                    {
                        filePath: 'src/app.ts',
                        owners: [
                            { name: 'Alice', email: 'alice@example.com', commitCount: 5, percentage: 83 },
                            { name: 'Bob', email: 'bob@example.com', commitCount: 1, percentage: 17 },
                        ],
                    },
                    {
                        filePath: 'src/lib.ts',
                        owners: [
                            { name: 'Carol', email: 'carol@example.com', commitCount: 2, percentage: 100 },
                        ],
                    },
                ],
            },
            completeness: {
                analysisScope: 'fullWorkspace',
                analyzedFileCount: 4,
                graphNodeCount: 4,
                graphEdgeCount: 3,
                analysisCoverage: 'complete',
                graphCoverage: 'complete',
                isSampled: false,
            },
            fileTree: {},
            keyFileContents: {},
        };
    }

    it('builds the additive grouped summary contract including slice-2 risk signals', () => {
        const payload = buildSummaryPayload(makeSummaryReport()) as Record<string, any>;

        expect(payload.risk).toEqual(expect.arrayContaining([
            expect.objectContaining({ id: 'temporal-hotspots', family: 'risk', kind: 'fact' }),
            expect.objectContaining({ id: 'ownership-concentration', family: 'risk', kind: 'derived' }),
            expect.objectContaining({ id: 'dangerous-hotspots', family: 'risk', kind: 'derived' }),
        ]));
    });

    it('rejects unlabeled signal definitions', () => {
        expect(() => validateSummarySignalContract([
            { id: 'unlabeled-signal', family: 'architecture' },
        ] as any)).toThrow(/Invalid summary signal definition/);
    });
});
