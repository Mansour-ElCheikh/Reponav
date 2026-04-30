import { describe, it, expect } from 'vitest';
import { formatToonReport, formatReportForAI } from './reportFormatting';
import type { AnalysisReport } from '../types';

describe('reportFormatting', () => {
    const mockReport: AnalysisReport = {
        frameworks: [{ name: 'React', type: 'library', version: '18.0.0', indexTier: 1, evidence: 'package.json' }],
        primaryLanguage: 'TypeScript',
        entryPoints: [{ file: 'src/index.ts', confidence: 'high' }],
        dependencyGraph: {
            nodes: ['src/index.ts', 'src/App.tsx'],
            edges: [{ source: 'src/index.ts', target: 'src/App.tsx' }],
            circularDependencies: [['A.ts', 'B.ts', 'A.ts']],
        },
        symbols: [],
        symbolEdges: [],
        fileClassifications: [
            { path: 'src/index.ts', category: 'entry', confidence: 1 },
            { path: 'src/App.tsx', category: 'component', confidence: 0.9 },
        ],
        metrics: {
            totalFiles: 2,
            totalLines: 100,
            fileMetrics: [],
            hotFiles: [{ path: 'src/App.tsx', lines: 80, fanIn: 5, fanOut: 2 }],
        },
        symbolMetrics: {
            totalSymbols: 10,
            totalSymbolEdges: 5,
            symbolsByKind: { 'function': 5, 'class': 2 },
        },
        keyFileContents: { 'package.json': '{}' },
        layerViolations: [
            { sourceFile: 'src/utils.ts', targetFile: 'src/ui.ts', direction: 'up' }
        ],
        deadCode: [
            { symbolName: 'unusedVar', filePath: 'src/index.ts', lineStart: 10, reason: 'no-callers', confidence: 1 }
        ],
        flows: [
            { entryPoint: 'src/index.ts', steps: [{ filePath: 'src/index.ts' }, { filePath: 'src/App.tsx' }], anomalies: [] }
        ],
    };

    describe('formatToonReport', () => {
        it('should correctly format a report into TOON notation', () => {
            const toon = formatToonReport(mockReport);

            // High-signal assertions for TOON symbols
            expect(toon).toContain('@frameworks [');
            expect(toon).toContain('#name:React #type:library #v:18.0.0');
            expect(toon).toContain('#lang:TypeScript');
            expect(toon).toContain('@entry [');
            expect(toon).toContain('#f:src/index.ts #conf:high');
            expect(toon).toContain('@graph [');
            expect(toon).toContain('#nodes:2 #edges:1');
            expect(toon).toContain('#cycle:A.ts|B.ts|A.ts');
            expect(toon).toContain('@layers [');
            expect(toon).toContain('#entry:src/index.ts');
            expect(toon).toContain('#component:src/App.tsx');
            expect(toon).toContain('@hot [');
            expect(toon).toContain('#f:src/App.tsx #in:5 #out:2 #L:80');
            expect(toon).toContain('@symbols #total:10 #edges:5');
            expect(toon).toContain('@violations [');
            expect(toon).toContain('#f:src/utils.ts #dir:up');
            expect(toon).toContain('@dead [');
            expect(toon).toContain('#sym:unusedVar #f:src/index.ts #conf:100');
            expect(toon).toContain('@flows [');
            expect(toon).toContain('#p:src/index.ts|src/App.tsx');
            expect(toon).toContain('@stats #files:2 #LoC:100');
        });

        it('should handle empty lists gracefully', () => {
            const emptyReport: AnalysisReport = {
                ...mockReport,
                frameworks: [],
                layerViolations: [],
                deadCode: [],
                flows: [],
                keyFileContents: {},
            };
            const toon = formatToonReport(emptyReport);
            expect(toon).toContain('@frameworks [\n]');
            expect(toon).not.toContain('@violations');
            expect(toon).not.toContain('@dead');
        });

        it('should respect the maxChars budget', () => {
            const smallBudget = 100;
            const toon = formatToonReport(mockReport, smallBudget);
            expect(toon.length).toBeLessThanOrEqual(smallBudget);
        });
    });

    describe('formatReportForAI facade', () => {
        it('should route to formatToonReport when toon is requested', () => {
            const toon = formatReportForAI(mockReport, 1000, 'toon');
            expect(toon).toContain('@frameworks');
        });

        it('should route to markdown by default or explicitly', () => {
            const md = formatReportForAI(mockReport, 1000, 'markdown');
            expect(md).toContain('# Workspace Analysis Report');
        });

        it('should route to JSON when requested', () => {
            const jsonStr = formatReportForAI(mockReport, 4000, 'json');
            const parsed = JSON.parse(jsonStr);
            expect(parsed.primaryLanguage).toBe('TypeScript');
        });
    });
});
