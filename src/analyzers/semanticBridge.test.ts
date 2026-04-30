import { describe, it, expect } from 'vitest';
import { SemanticBridge } from './semanticBridge';
import type { AnalysisReport, Diagnostic, DeadCodeCandidate } from '../types';

describe('SemanticBridge', () => {
    const bridge = new SemanticBridge();

    describe('parseTscOutput', () => {
        it('should correctly parse standard tsc error output', () => {
            const mockOutput = 'src/index.ts:10:5 - error TS6133: \'unusedVar\' is declared but its value is never read.\nsrc/utils.ts:5:2 - error TS2304: Cannot find name \'Foo\'.';
            const diagnostics = bridge.parseTscOutput(mockOutput, '/root');

            expect(diagnostics).toHaveLength(2);
            expect(diagnostics[0]).toEqual({
                filePath: 'src/index.ts',
                line: 10,
                column: 5,
                severity: 'error',
                code: 6133,
                message: "'unusedVar' is declared but its value is never read.",
                source: 'tsc',
            });
        });

        it('should handle multi-line or empty output', () => {
            expect(bridge.parseTscOutput('', '/root')).toEqual([]);
            expect(bridge.parseTscOutput('Random text without tsc pattern', '/root')).toEqual([]);
        });
    });

    describe('fuseDiagnostics', () => {
        it('should elevate dead code confidence when TSC confirms unused status', () => {
            const report: AnalysisReport = {
                metrics: { totalFiles: 1, totalLines: 100, fileMetrics: [], hotFiles: [] },
                deadCode: [
                    { symbolName: 'unusedVar', filePath: 'src/index.ts', lineStart: 10, reason: 'no-callers', confidence: 0.5 }
                ],
            } as any;

            const diagnostics: Diagnostic[] = [
                { 
                    filePath: 'src/index.ts', 
                    line: 10, 
                    column: 5, 
                    severity: 'error', 
                    code: 6133, 
                    message: "is never read", 
                    source: 'tsc' 
                }
            ];

            const fused = bridge.fuseDiagnostics(report, diagnostics);
            expect(fused.deadCode![0].confidence).toBe(0.95);
            expect(fused.deadCode![0].reason).toContain('Verified by TSC');
        });

        it('should not elevate confidence if line numbers do not match', () => {
            const report: AnalysisReport = {
                deadCode: [
                    { symbolName: 'var', filePath: 'src/index.ts', lineStart: 20, reason: 'no-callers', confidence: 0.5 }
                ],
            } as any;

            const diagnostics: Diagnostic[] = [
                { filePath: 'src/index.ts', line: 10, column: 5, severity: 'error', code: 6133, message: "msg", source: 'tsc' }
            ];

            const fused = bridge.fuseDiagnostics(report, diagnostics);
            expect(fused.deadCode![0].confidence).toBe(0.5);
        });
    });
});
