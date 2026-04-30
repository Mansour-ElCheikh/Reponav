/** Implemented by Antigravity (2026-04-26) */
import { execSync } from 'child_process';
import * as path from 'path';
import type { AnalysisReport, Diagnostic, DeadCodeCandidate } from '../types';

/**
 * SemanticBridge (Tier 3)
 * 
 * Fuses external compiler/linter signals into the static analysis report.
 */
export class SemanticBridge {
    /**
     * Run TypeScript compiler in check-only mode and capture diagnostics.
     */
    async runTscDiagnostics(repoPath: string): Promise<Diagnostic[]> {
        try {
            // Using npx to ensure tsc is available. --pretty false for easier parsing.
            const stdout = execSync('npx tsc --noEmit --pretty false', {
                cwd: repoPath,
                encoding: 'utf8',
                stdio: ['ignore', 'pipe', 'ignore'], // Ignore stderr to avoid noise
            });
            return this.parseTscOutput(stdout, repoPath);
        } catch (err: any) {
            // tsc exits with non-zero if there are errors, which is what we want to parse.
            if (err.stdout) {
                return this.parseTscOutput(err.stdout, repoPath);
            }
            return [];
        }
    }

    /**
     * Parse raw tsc output into structured Diagnostic objects.
     * Pattern: path/to/file.ts:line:col - error TS1234: message
     */
    parseTscOutput(stdout: string, repoPath: string): Diagnostic[] {
        const diagnostics: Diagnostic[] = [];
        const lines = stdout.split('\n');
        
        // Regex for standard tsc output
        const tscRegex = /^(.+?):(\d+):(\d+)\s-\s(error|warning|info)\sTS(\d+):\s(.+)$/;

        for (const line of lines) {
            const match = line.match(tscRegex);
            if (match) {
                const [_, filePath, lineNum, colNum, severity, code, message] = match;
                diagnostics.push({
                    filePath: path.relative(repoPath, path.resolve(repoPath, filePath)),
                    line: parseInt(lineNum, 10),
                    column: parseInt(colNum, 10),
                    severity: severity as any,
                    code: parseInt(code, 10),
                    message: message.trim(),
                    source: 'tsc',
                });
            }
        }
        return diagnostics;
    }

    /**
     * Fuse diagnostics into the report to enrich architectural signals.
     */
    fuseDiagnostics(report: AnalysisReport, diagnostics: Diagnostic[]): AnalysisReport {
        const updatedReport = { ...report, diagnostics };

        // Enrich Dead Code: If tsc flags a symbol as unused (TS6133), mark it as high confidence.
        if (report.deadCode) {
            const unusedDiagnostics = diagnostics.filter(d => d.code === 6133); // 'is declared but its value is never read'
            
            updatedReport.deadCode = report.deadCode.map(candidate => {
                const match = unusedDiagnostics.find(d => 
                    d.filePath === candidate.filePath && 
                    d.line === candidate.lineStart
                );
                
                if (match) {
                    return {
                        ...candidate,
                        confidence: 0.95, // Compiler-verified
                        reason: `${candidate.reason} (Verified by TSC: ${match.message})`,
                    };
                }
                return candidate;
            });
        }

        return updatedReport;
    }
}
