/** Implemented by Antigravity (2026-04-26) */
import * as path from 'path';
import { parseDiff } from '../utils/diffParser';
import { findSymbolsAtRange } from './symbolExtractor';
import { computeBlastRadius } from './blastRadiusAnalyzer';
import type { 
    AnalysisReport, 
    BlastRadius, 
    CoChangePair, 
    LayerViolation 
} from '../types';

export interface RiskReport {
    score: number;
    level: 'critical' | 'high' | 'medium' | 'low' | 'negligible';
    summary: string;
    touchedSymbols: string[];
    blastRadius: BlastRadius[];
    couplingImpact: CoChangePair[];
    newViolations: LayerViolation[];
}

/**
 * Orchestrates the PR Risk Assessment.
 */
export async function analyzeRisk(
    diffText: string,
    report: AnalysisReport
): Promise<RiskReport> {
    const hunks = parseDiff(diffText);
    const touchedSymbols: Set<string> = new Set();
    const blastRadii: BlastRadius[] = [];
    const couplingImpacts: CoChangePair[] = [];

    // 1. Identify touched symbols
    const allSymbols = report.symbols ?? [];
    
    for (const hunk of hunks) {
        const fileSymbols = allSymbols.filter(s => s.filePath === hunk.file);
        const symbolsInRange = findSymbolsAtRange(fileSymbols, hunk.startLine, hunk.endLine);
        for (const sym of symbolsInRange) {
            touchedSymbols.add(`${sym.filePath}:${sym.name}`);
        }
    }

    // 2. Compute Blast Radius for each touched symbol
    const symbolEdges = report.symbolEdges ?? [];
    for (const symKey of touchedSymbols) {
        const [filePath, symbolName] = symKey.split(':');
        const br = computeBlastRadius(symbolName, filePath, symbolEdges);
        blastRadii.push(br);
    }

    // 3. Check Change Coupling for touched files
    const touchedFiles = new Set(hunks.map(h => h.file));
    const allCoupling = report.changeCoupling ?? [];
    for (const file of touchedFiles) {
        // Find pairs where one of the files is in our touched set
        const matches = allCoupling.filter(c => c.fileA === file || c.fileB === file);
        
        // Only include the "other side" of the pair if it's NOT already in our touched set
        for (const match of matches) {
            const otherFile = match.fileA === file ? match.fileB : match.fileA;
            if (!touchedFiles.has(otherFile)) {
                couplingImpacts.push(match);
            }
        }
    }

    // Deduplicate coupling impacts
    const uniqueCoupling = Array.from(new Map(couplingImpacts.map(c => [`${c.fileA}|${c.fileB}`, c])).values());

    // 4. Scoring (Scientific weighting)
    // Blast Radius Score: max score among touched symbols, normalized (0-100)
    const maxBlastScore = Math.max(0, ...blastRadii.map(b => b.score));
    
    // Coupling Score: sum of confidence of impacted files
    const couplingScore = uniqueCoupling.reduce((sum, c) => sum + c.confidence, 0) * 10;
    
    let totalScore = (maxBlastScore * 5) + (couplingScore * 2);
    
    // Cap at 100
    totalScore = Math.min(100, totalScore);
    
    let level: RiskReport['level'] = 'negligible';
    if (totalScore > 80) level = 'critical';
    else if (totalScore > 60) level = 'high';
    else if (totalScore > 40) level = 'medium';
    else if (totalScore > 10) level = 'low';

    // 5. Narrative Summary
    const symCount = touchedSymbols.size;
    const impactedFiles = new Set(uniqueCoupling.map(c => [c.fileA, c.fileB]).flat()).size - touchedFiles.size;
    
    const summary = touchedSymbols.size > 0 
        ? `Modified ${symCount} symbols. Peak blast radius score of ${maxBlastScore.toFixed(1)}. Change coupling predicts side effects in ${impactedFiles} related files.`
        : `No significant symbols modified. Impact appears limited to file-level changes.`;

    return {
        score: Math.round(totalScore),
        level,
        summary,
        touchedSymbols: Array.from(touchedSymbols),
        blastRadius: blastRadii,
        couplingImpact: uniqueCoupling,
        newViolations: [],
    };
}
