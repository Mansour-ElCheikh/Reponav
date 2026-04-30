import { describe, it, expect } from 'vitest';
import { analyzeRisk } from './riskAnalyzer';
import type { AnalysisReport } from '../types';

describe('riskAnalyzer', () => {
    const mockReport: AnalysisReport = {
        frameworks: [],
        primaryLanguage: 'TypeScript',
        entryPoints: [],
        dependencyGraph: { nodes: [], edges: [], circularDependencies: [] },
        fileClassifications: [],
        metrics: { totalFiles: 10, totalLines: 1000, fileMetrics: [], hotFiles: [] },
        keyFileContents: {},
        layerViolations: [],
        deadCode: [],
        flows: [],
        symbols: [
            { name: 'criticalFunc', filePath: 'src/core.ts', lineStart: 10, lineEnd: 20, kind: 'function', isExported: true },
            { name: 'helperFunc', filePath: 'src/utils.ts', lineStart: 5, lineEnd: 15, kind: 'function', isExported: false },
        ],
        symbolEdges: [
            { sourceFile: 'src/ui.ts', sourceName: 'button', targetFile: 'src/core.ts', targetName: 'criticalFunc', edgeType: 'calls', lineNumber: 1 },
            { sourceFile: 'src/api.ts', sourceName: 'request', targetFile: 'src/core.ts', targetName: 'criticalFunc', edgeType: 'calls', lineNumber: 1 },
            { sourceFile: 'src/db.ts', sourceName: 'query', targetFile: 'src/core.ts', targetName: 'criticalFunc', edgeType: 'calls', lineNumber: 1 },
        ],
        changeCoupling: [
            { fileA: 'src/core.ts', fileB: 'src/config.ts', support: 50, confidence: 1.0 },
            { fileA: 'src/core.ts', fileB: 'src/auth.ts', support: 40, confidence: 0.95 },
        ],
    };

    it('should assign a high risk score when a critical symbol is touched', async () => {
        const diff = `
diff --git a/src/core.ts b/src/core.ts
--- a/src/core.ts
+++ b/src/core.ts
@@ -12,2 +12,2 @@
- old
+ new critical change
        `.trim();

        const report = await analyzeRisk(diff, mockReport);

        expect(report.touchedSymbols).toContain('src/core.ts:criticalFunc');
        expect(report.score).toBeGreaterThan(40);
        expect(['high', 'critical', 'medium']).toContain(report.level);
        expect(report.summary).toContain('Modified 1 symbols');
    });

    it('should identify coupling impact', async () => {
        const diff = `
diff --git a/src/core.ts b/src/core.ts
--- a/src/core.ts
+++ b/src/core.ts
@@ -1,1 +1,1 @@
+ change
        `.trim();

        const report = await analyzeRisk(diff, mockReport);
        expect(report.couplingImpact).toHaveLength(2);
        expect(report.couplingImpact[0].fileB).toBe('src/config.ts');
    });

    it('should assign negligible risk for no-symbol changes', async () => {
        const diff = `
diff --git a/README.md b/README.md
--- a/README.md
+++ b/README.md
@@ -1,1 +1,1 @@
+ Just a doc change
        `.trim();

        const report = await analyzeRisk(diff, mockReport);
        expect(report.score).toBe(0);
        expect(report.level).toBe('negligible');
        expect(report.summary).toContain('No significant symbols modified');
    });
});
