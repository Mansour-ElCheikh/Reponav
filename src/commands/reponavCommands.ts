/**
 * Command handlers for the RepoNav CLI.
 * 
 * Extracts logic from bin/reponav.ts to maintain SRP and adhere to R17 size limits.
 * All handlers return a standardized { exitCode, output, error } object.
 */

/** Implemented/Hardened by Antigravity (2026-04-26) */
import * as fs from 'fs';
import * as path from 'path';
import { computeBlastRadius, buildReverseAdjacency, computeBlastRadiusWithMap } from '../analyzers/blastRadiusAnalyzer';
import { getGitLog, mineChangeCoupling } from '../analyzers/changeCouplingAnalyzer';
import { analyzeTier0, analyzeTier1, analyzeTier2, analyzeTier3, analyzeTier4, analyzeTier5, analyzeTier6, formatReportForAI } from '../analyzers/index';
import { analyzeRisk } from '../analyzers/riskAnalyzer';
import { detectSeams } from '../analyzers/seamDetector';
import { withAnalysisCompleteness } from '../services/analysisCompleteness';
import { computeCacheKey, readAnalysisCache, writeAnalysisCache, readCouplingCache, writeCouplingCache } from '../services/diskAnalysisCache';
import { TreeSitterProvider } from '../analyzers/TreeSitterProvider';
import type { WorkspaceAdapter } from '../WorkspaceAdapter';
import type { AnalysisReport, DeadCodeCandidate, CoChangePair, FlowSequence } from '../types';

const HEADLESS_ANALYSIS_OPTIONS = { scope: 'fullWorkspace' as const };
const DEFAULT_CONFIDENCE_THRESHOLD = 0.5;
const COUPLING_CONFIDENCE_DECIMALS = 3;

/** Standard result shape for command handlers. */
export interface CommandResult {
    exitCode: number;
    output: string;
    error: string;
}

/** Runs the change coupling miner against a repo. */
export async function runCoupling(
    repo: string | null,
    format: string,
    minSupport: number
): Promise<CommandResult> {
    if (!repo) return { exitCode: 2, output: '', error: 'Error: --repo <path> is required.\n' };
    const resolvedRepo = path.resolve(repo);
    if (!fs.existsSync(resolvedRepo)) {
        return { exitCode: 2, output: '', error: `Error: cannot access path "${resolvedRepo}" — does not exist.\n` };
    }

    // Cache check — coupling is git-log derived so fileCount is not relevant (gitHead covers invalidation)
    const cacheKey = await computeCacheKey(resolvedRepo, []);
    const cached = readCouplingCache(cacheKey, minSupport, resolvedRepo);
    if (cached) {
        const output = format === 'table' ? formatCouplingTable(cached) : JSON.stringify(cached, null, 2);
        return { exitCode: 0, output, error: '' };
    }

    let rawLog: string;
    try {
        rawLog = getGitLog(resolvedRepo);
    } catch {
        // Non-git directory: emit empty result rather than error.
        const empty = format === 'table' ? formatCouplingTable([]) : JSON.stringify([], null, 2);
        return { exitCode: 0, output: empty, error: '' };
    }
    const pairs = mineChangeCoupling(rawLog, { minSupport });
    writeCouplingCache(cacheKey, pairs, minSupport, resolvedRepo);
    const output = format === 'table' ? formatCouplingTable(pairs) : JSON.stringify(pairs, null, 2);
    return { exitCode: 0, output, error: '' };
}

/** Runs Tier 0+1+2 analysis and returns flow sequences. */
export async function runFlows(
    repo: string,
    format: string,
    adapter: WorkspaceAdapter,
    treeSitter: TreeSitterProvider
): Promise<CommandResult> {
    const { report: tier0, files } = await analyzeTier0(adapter, undefined, HEADLESS_ANALYSIS_OPTIONS);
    const tier1 = await analyzeTier1(adapter, files, tier0, undefined, treeSitter, HEADLESS_ANALYSIS_OPTIONS);
    const tier2 = await analyzeTier2(adapter, files, tier1);

    const flows = tier2.flows ?? [];
    const output = format === 'table' ? formatFlowsTable(flows) : JSON.stringify(flows, null, 2);
    return { exitCode: 0, output, error: '' };
}

/** Runs Tier 0+1+2 analysis and returns dead code candidates. */
export async function runDeadCode(
    repo: string,
    format: string,
    threshold: number,
    adapter: WorkspaceAdapter,
    treeSitter: TreeSitterProvider
): Promise<CommandResult> {
    const { report: tier0, files } = await analyzeTier0(adapter, undefined, HEADLESS_ANALYSIS_OPTIONS);
    const tier1 = await analyzeTier1(adapter, files, tier0, undefined, treeSitter, HEADLESS_ANALYSIS_OPTIONS);
    const tier2 = await analyzeTier2(adapter, files, tier1);
    const tier3 = await analyzeTier3(adapter, files, tier2);

    const allCandidates = tier3.deadCode ?? [];
    const candidates = allCandidates.filter(c => c.confidence >= threshold);

    const output = format === 'table' ? formatDeadCodeTable(candidates) : JSON.stringify(candidates, null, 2);
    return { exitCode: candidates.length > 0 ? 1 : 0, output, error: '' };
}

/** Runs blast radius BFS for a specific symbol. */
export async function runImpact(
    repo: string,
    symbolName: string,
    filePath: string | null,
    adapter: WorkspaceAdapter,
    treeSitter: TreeSitterProvider
): Promise<CommandResult> {
    const { report: tier0, files } = await analyzeTier0(adapter, undefined, HEADLESS_ANALYSIS_OPTIONS);
    const tier1 = await analyzeTier1(adapter, files, tier0, undefined, treeSitter, HEADLESS_ANALYSIS_OPTIONS);
    const tier2 = await analyzeTier2(adapter, files, tier1);

    const edges = tier2.symbolEdges ?? [];
    const symbols = tier2.symbols ?? [];

    const candidate = symbols.find(s =>
        s.name === symbolName && (filePath ? s.filePath === filePath || s.filePath.endsWith(filePath) : true)
    );

    const originFile = candidate?.filePath ?? (filePath ?? '');
    const result = computeBlastRadius(symbolName, originFile, edges);
    return { exitCode: 0, output: JSON.stringify(result, null, 2), error: '' };
}

/** Runs full analysis and exits 1 if thresholds are breached. */
/**
 * Runs Tier 0+1+2 analysis and verifies if architectural thresholds are breached.
 * 
 * @param repo - Absolute path to the repository root.
 * @param maxViolations - Maximum allowed layer violations.
 * @param maxDeadCode - Maximum allowed dead code candidates.
 * @param maxBlastRadius - Maximum allowed blast radius score.
 * @param adapter - Workspace adapter for file access.
 * @param treeSitter - Tree-sitter provider for symbol extraction.
 * @returns A promise resolving to the command result (exit 1 if breached).
 */
export async function runCheck(
    repo: string,
    maxViolations: number,
    maxDeadCode: number,
    maxBlastRadius: number,
    adapter: WorkspaceAdapter,
    treeSitter: TreeSitterProvider
): Promise<CommandResult> {
    const { report: tier0, files } = await analyzeTier0(adapter, undefined, HEADLESS_ANALYSIS_OPTIONS);
    const tier1 = await analyzeTier1(adapter, files, tier0, undefined, treeSitter, HEADLESS_ANALYSIS_OPTIONS);
    const tier2 = await analyzeTier2(adapter, files, tier1);
    const tier3 = await analyzeTier3(adapter, files, tier2);

    const violationCount = (tier3.layerViolations ?? []).length;
    const deadCodeCount = (tier3.deadCode ?? []).filter(c => c.confidence >= DEFAULT_CONFIDENCE_THRESHOLD).length;

    const edges = tier3.symbolEdges ?? [];
    const symbols = tier3.symbols ?? [];
    const adjMap = buildReverseAdjacency(edges);
    let blastRadiusScore = 0;
    for (const sym of symbols) {
        const br = computeBlastRadiusWithMap(sym.name, sym.filePath, adjMap);
        if (br.score > blastRadiusScore) blastRadiusScore = br.score;
    }

    const breaches: string[] = [];
    if (violationCount > maxViolations) breaches.push(`layer-violations: ${violationCount} > max ${maxViolations}`);
    if (deadCodeCount > maxDeadCode) breaches.push(`dead-code: ${deadCodeCount} > max ${maxDeadCode}`);
    if (blastRadiusScore > maxBlastRadius) breaches.push(`blast-radius: ${blastRadiusScore} > max ${maxBlastRadius}`);

    const summary = { violations: violationCount, deadCode: deadCodeCount, blastRadius: blastRadiusScore, breaches };
    return { exitCode: breaches.length > 0 ? 1 : 0, output: JSON.stringify(summary, null, 2), error: '' };
}

/** Runs Tier 3 analysis and returns layer violations as JSON. */
export async function runLayerViolations(
    repo: string,
    top: number | null,
    adapter: WorkspaceAdapter,
    treeSitter: TreeSitterProvider,
): Promise<CommandResult> {
    const { report: tier0, files } = await analyzeTier0(adapter, undefined, HEADLESS_ANALYSIS_OPTIONS);
    const tier1 = await analyzeTier1(adapter, files, tier0, undefined, treeSitter, HEADLESS_ANALYSIS_OPTIONS);
    const tier2 = await analyzeTier2(adapter, files, tier1);
    const tier3 = await analyzeTier3(adapter, files, tier2);
    let violations = tier3.layerViolations ?? [];
    if (top !== null && top > 0) violations = violations.slice(0, top);
    return { exitCode: 0, output: JSON.stringify(violations, null, 2), error: '' };
}

/** Runs PR Risk Assessment for a diff. */
export async function runRisk(
    repo: string,
    diffText: string,
    adapter: WorkspaceAdapter,
    treeSitter: TreeSitterProvider
): Promise<CommandResult> {
    const { report: tier0, files } = await analyzeTier0(adapter, undefined, HEADLESS_ANALYSIS_OPTIONS);
    const tier1 = await analyzeTier1(adapter, files, tier0, undefined, treeSitter, HEADLESS_ANALYSIS_OPTIONS);
    const tier2 = await analyzeTier2(adapter, files, tier1);
    // Tier 3 is optional for risk but recommended for dead code precision
    const tier3 = await analyzeTier3(adapter, files, tier2);

    const riskReport = await analyzeRisk(diffText, tier3);
    return { exitCode: 0, output: JSON.stringify(riskReport, null, 2), error: '' };
}

/** Detects architectural seams. */
export async function runSeams(
    repo: string,
    adapter: WorkspaceAdapter,
    treeSitter: TreeSitterProvider
): Promise<CommandResult> {
    const { report: tier0, files } = await analyzeTier0(adapter, undefined, HEADLESS_ANALYSIS_OPTIONS);
    const tier1 = await analyzeTier1(adapter, files, tier0, undefined, treeSitter, HEADLESS_ANALYSIS_OPTIONS);
    const tier2 = await analyzeTier2(adapter, files, tier1);

    const seams = detectSeams(
        tier2.dependencyGraph.nodes,
        tier2.dependencyGraph.edges,
        tier2.changeCoupling ?? []
    );

    return { exitCode: 0, output: JSON.stringify(seams, null, 2), error: '' };
}

/** Builds the summary payload shape from a report (used for both cache-hit and miss paths). */
export function buildSummaryPayload(report: AnalysisReport): object {
    return {
        workspaceRoot: report.workspaceRoot,
        primaryLanguage: report.primaryLanguage,
        frameworks: report.frameworks,
        completeness: report.completeness,
        entryPoints: report.entryPoints,
        hotFiles: report.metrics.hotFiles,
        orphanCount: report.metrics.orphanFiles.length,
        totalFiles: report.metrics.totalFiles,
        circularDeps: report.dependencyGraph.circularDependencies.length,
        hotFilesCoverage: report.metrics.hotFiles.reduce((acc, f) => acc + f.fanIn, 0) / Math.max(report.metrics.fileMetrics.reduce((acc, m) => acc + m.fanIn, 0), 1),
    };
}

function formatAnalysisOutput(report: AnalysisReport, format: string): string {
    if (format === 'json') return JSON.stringify(report, null, 2);
    if (format === 'compact') {
        return JSON.stringify({
            workspaceRoot: report.workspaceRoot,
            primaryLanguage: report.primaryLanguage,
            frameworks: report.frameworks,
            completeness: report.completeness,
            metrics: report.metrics,
            entryPoints: report.entryPoints,
        }, null, 2);
    }
    if (format === 'summary') return JSON.stringify(buildSummaryPayload(report), null, 2);
    if (format === 'toon') return formatReportForAI(report, 128000, 'toon');
    return formatReportForAI(report, 128000, 'markdown');
}

/** Runs full workspace analysis up to the specified tier, using disk cache when available. */
export async function runAnalyze(
    repo: string,
    format: string,
    tier: number,
    adapter: WorkspaceAdapter,
    treeSitter: TreeSitterProvider
): Promise<CommandResult> {
    const root = adapter.getWorkspaceRoot() ?? repo;

    // Cache check — compute key from git HEAD + file count (pre-analysis, cheap)
    const fileList = await adapter.findFiles('**/*', '**/node_modules/**', 100000);
    const cacheKey = await computeCacheKey(root, fileList);
    const cached = readAnalysisCache(cacheKey, tier, root);
    if (cached) {
        return { exitCode: 0, output: formatAnalysisOutput(cached, format), error: '' };
    }

    const { report: tier0, files } = await analyzeTier0(adapter, undefined, HEADLESS_ANALYSIS_OPTIONS);
    let currentReport = tier0;

    if (tier >= 1) {
        currentReport = await analyzeTier1(adapter, files, currentReport, undefined, treeSitter, HEADLESS_ANALYSIS_OPTIONS);
    }
    if (tier >= 2) {
        currentReport = await analyzeTier2(adapter, files, currentReport);
    }
    if (tier >= 3) {
        currentReport = await analyzeTier3(adapter, files, currentReport);
    }
    if (tier >= 4) {
        currentReport = await analyzeTier4(adapter, files, currentReport);
    }
    if (tier >= 5) {
        currentReport = await analyzeTier5(adapter, currentReport);
    }
    if (tier >= 6) {
        currentReport = await analyzeTier6(adapter, currentReport);
    }

    withAnalysisCompleteness(currentReport, 'fullWorkspace');
    writeAnalysisCache(cacheKey, currentReport, root);

    return { exitCode: 0, output: formatAnalysisOutput(currentReport, format), error: '' };
}

// ─── Table Formatters ────────────────────────────────────────────────────────

function formatCouplingTable(pairs: CoChangePair[]): string {
    const header = ['fileA', 'fileB', 'support', 'confidence'].join('\t');
    const rows = pairs.map(p =>
        [p.fileA, p.fileB, String(p.support), p.confidence.toFixed(COUPLING_CONFIDENCE_DECIMALS)].join('\t')
    );
    return [header, ...rows].join('\n');
}

function formatFlowsTable(sequences: FlowSequence[]): string {
    const header = ['entryPoint', 'steps', 'anomalies'].join('\t');
    const rows = sequences.map(s =>
        [s.entryPoint, String(s.steps.length), String(s.anomalies.length)].join('\t')
    );
    return [header, ...rows].join('\n');
}

function formatDeadCodeTable(candidates: DeadCodeCandidate[]): string {
    const header = ['File', 'Symbol', 'Line', 'Reason', 'Confidence'].join('\t');
    const rows = candidates.map(c =>
        [c.filePath, c.symbolName, String(c.lineStart), c.reason, c.confidence.toFixed(2)].join('\t')
    );
    return [header, ...rows].join('\n');
}
