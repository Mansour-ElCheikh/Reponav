/* eslint-disable no-magic-numbers */
// Report formatting uses many literal sizes/ratios for preview limits,
// percentage display, and budget thresholds. All intentional;
// extracting to constants would obscure the formatting intent.
import * as path from 'path';
import type { AnalysisReport, EntryPoint, FileClassification, FileMetrics, SymbolInfo } from '../types';
import type { FileCategory } from '../types';

/** Approximate token budget for the AI-facing report formatter. */
export const MAX_REPORT_TOKENS = 6_000;
const REPORT_CHARS_PER_TOKEN = 4;
/** Character budget derived from the report token budget. */
export const MAX_REPORT_CHARS = MAX_REPORT_TOKENS * REPORT_CHARS_PER_TOKEN;

const FALLBACK_TEXT_CONTENT_CHARS = 600;
const NON_SOURCE_PROMPT_CONTENT_CHARS = 2_000;
const CIRCULAR_DEPENDENCY_PREVIEW_LIMIT = 3;
const ENTRY_POINT_PREVIEW_LIMIT = 10;
const CATEGORY_FILE_PREVIEW_LIMIT = 8;
const HOT_FILE_PREVIEW_LIMIT = 5;
const KEY_FILE_CONTENT_LIMIT = 5_000;
const TOP_KIND_PREVIEW_LIMIT = 5;
const FLOW_PREVIEW_LIMIT = 4;
const FLOW_STEP_PREVIEW_LIMIT = 6;
const PERCENTAGE_SCALE = 100;
const ORPHAN_SECTION_BUDGET_SHARE = 0.55;
const SYMBOL_SECTION_BUDGET_SHARE = 0.72;
const ADVANCED_SECTION_BUDGET_SHARE = 0.82;
const PROMPT_CONTEXT_MIN_REMAINING_BUDGET = 1_200;

export type ReportFormat = 'markdown' | 'json' | 'toon';

const KEY_FILE_PATTERNS = [
    /^README\.md$/i,
    /^package\.json$/,
    /^pyproject\.toml$/,
    /^Cargo\.toml$/,
    /^go\.mod$/,
    /^docker-compose\.ya?ml$/,
    /^Dockerfile$/,
];

const CODE_EXTENSIONS = new Set([
    '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py',
]);

const CATEGORY_WEIGHTS: Partial<Record<FileCategory, number>> = {
    entry: 220,
    route: 170,
    controller: 160,
    middleware: 145,
    service: 140,
    model: 130,
    config: 120,
    component: 110,
    utility: 80,
    type: 40,
    test: -120,
    unknown: 0,
};

const DEFAULT_MAX_SOURCE_FILES = 8;
const MAX_RAW_SOURCE_CHARS = 8_000;
const MAX_SKELETON_LINES = 48;
const KEY_FILE_SCORE_BOOST = 180;
const ENTRY_POINT_SCORE_BOOST = 500;
const HOT_FILE_SCORE_BOOST = 180;
const FAN_IN_SCORE_WEIGHT = 20;
const FAN_OUT_SCORE_WEIGHT = 8;
const MAX_LINE_SCORE_LINES = 400;
const LINE_SCORE_DIVISOR = 8;
const TEST_FILE_SCORE_PENALTY = 150;
const MIN_RANKED_CONTEXT_FILE_BUDGET = 500;
const RANKED_CONTEXT_FILE_BUDGET_SHARE = 0.6;
const MAX_RANKED_CONTEXT_FILES = 6;
const RANKED_CONTEXT_SECTION_BUDGET_SHARE = 0.65;
const MIN_IMPORT_EDGE_SECTION_BUDGET = 500;
const IMPORT_EDGE_SOURCE_LIMIT = 24;
const IMPORT_EDGE_TARGET_PREVIEW_COUNT = 8;
const IMPORT_EDGE_BUDGET_BUFFER = 100;

function isKeyFilePath(filePath: string): boolean {
    return KEY_FILE_PATTERNS.some((pattern) => pattern.test(filePath));
}

function isSourceCodePath(filePath: string): boolean {
    return CODE_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

function buildScoreMaps(
    entryPoints: EntryPoint[],
    fileClassifications: FileClassification[],
    metrics: AnalysisReport['metrics'],
) {
    const entryPointPaths = new Set(entryPoints.map((entryPoint) => entryPoint.file));
    const classificationMap = new Map(fileClassifications.map((classification) => [classification.path, classification]));
    const fileMetricsMap = new Map(metrics.fileMetrics.map((metric) => [metric.path, metric]));
    const hotFilePaths = new Set(metrics.hotFiles.map((metric) => metric.path));

    return { entryPointPaths, classificationMap, fileMetricsMap, hotFilePaths };
}

function scorePromptFile(
    filePath: string,
    scoreMaps: ReturnType<typeof buildScoreMaps>,
): number {
    const { entryPointPaths, classificationMap, fileMetricsMap, hotFilePaths } = scoreMaps;
    const classification = classificationMap.get(filePath);
    const metric = fileMetricsMap.get(filePath);

    let score = 0;
    if (isKeyFilePath(filePath)) score += KEY_FILE_SCORE_BOOST;
    if (entryPointPaths.has(filePath)) score += ENTRY_POINT_SCORE_BOOST;
    if (hotFilePaths.has(filePath)) score += HOT_FILE_SCORE_BOOST;
    if (classification) score += CATEGORY_WEIGHTS[classification.category] ?? 0;
    if (metric) {
        score += metric.fanIn * FAN_IN_SCORE_WEIGHT;
        score += metric.fanOut * FAN_OUT_SCORE_WEIGHT;
        score += Math.min(metric.lines, MAX_LINE_SCORE_LINES) / LINE_SCORE_DIVISOR;
    }

    if (filePath.includes('/test') || filePath.includes('.test.') || filePath.includes('.spec.')) {
        score -= TEST_FILE_SCORE_PENALTY;
    }

    return score;
}

function compactTextContent(content: string, maxChars: number): string {
    const normalized = content
        .split('\n')
        .map((line) => line.trimEnd())
        .filter((line, index, lines) => line.length > 0 || (index > 0 && lines[index - 1].length > 0))
        .join('\n');
    return normalized.substring(0, maxChars);
}

function skeletonizeCodeContent(content: string): string {
    const keptLines: string[] = [];

    for (const rawLine of content.split('\n')) {
        const trimmed = rawLine.trim();
        if (!trimmed) continue;

        const normalized = trimmed.replace(/\s+/g, ' ').trim();
        const stripBraceSuffix = normalized.replace(/\s*\{\s*$/, '');

        if (
            normalized.startsWith('import ') ||
            normalized.startsWith('export import ') ||
            /^export\s+\{/.test(normalized) ||
            /^module\.exports\s*=/.test(normalized) ||
            normalized.startsWith('@') ||
            /^(export\s+)?(async\s+)?function\s+/.test(normalized) ||
            /^(export\s+)?(abstract\s+)?class\s+/.test(normalized) ||
            /^(export\s+)?interface\s+/.test(normalized) ||
            /^(export\s+)?type\s+/.test(normalized) ||
            /^(export\s+)?enum\s+/.test(normalized) ||
            /^(export\s+)?const\s+[A-Za-z_$][\w$]*\s*=\s*(async\s*)?\([^)]*\)\s*=>/.test(normalized) ||
            /^(public|private|protected|static|async|get|set|\*)*\s*[A-Za-z_$][\w$]*\s*\([^)]*\)\s*\{?$/.test(normalized) ||
            /\b(app|router)\.(get|post|put|patch|delete|use)\(/.test(normalized)
        ) {
            keptLines.push(stripBraceSuffix);
        }

        if (keptLines.length >= MAX_SKELETON_LINES) break;
    }

    if (keptLines.length === 0) {
        return compactTextContent(content, FALLBACK_TEXT_CONTENT_CHARS);
    }

    return keptLines.join('\n');
}

function formatPromptFileContent(filePath: string, content: string): string {
    if (isSourceCodePath(filePath)) {
        return skeletonizeCodeContent(content);
    }

    return compactTextContent(content, NON_SOURCE_PROMPT_CONTENT_CHARS);
}

function getOrderedPromptFiles(report: AnalysisReport): Array<[string, string]> {
    const scoreMaps = buildScoreMaps(report.entryPoints, report.fileClassifications, report.metrics);

    return Object.entries(report.keyFileContents)
        .sort(([pathA], [pathB]) => {
            const scoreDiff = scorePromptFile(pathB, scoreMaps) - scorePromptFile(pathA, scoreMaps);
            return scoreDiff !== 0 ? scoreDiff : pathA.localeCompare(pathB);
        });
}

function buildSymbolId(symbol: Pick<SymbolInfo, 'filePath' | 'name' | 'parentSymbol'>): string {
    return `${symbol.filePath}::${symbol.parentSymbol ? `${symbol.parentSymbol}.` : ''}${symbol.name}`;
}

function buildSymbolLookup(symbols: SymbolInfo[]): Map<string, string> {
    const lookup = new Map<string, string>();
    for (const symbol of symbols) {
        lookup.set(`${symbol.filePath}::${symbol.name}`, buildSymbolId(symbol));
    }
    return lookup;
}

function buildTopSymbolSection(report: AnalysisReport): string[] {
    if (!report.symbols || report.symbols.length === 0) {
        return [];
    }

    const symbolLookup = buildSymbolLookup(report.symbols);
    const incomingEdges = new Map<string, number>();
    for (const edge of report.symbolEdges ?? []) {
        const targetId = symbolLookup.get(`${edge.targetFile}::${edge.targetName}`)
            ?? `${edge.targetFile}::${edge.targetName}`;
        incomingEdges.set(targetId, (incomingEdges.get(targetId) ?? 0) + 1);
    }

    const rankedSymbols = [...report.symbols]
        .sort((a, b) => {
            const incomingDiff = (incomingEdges.get(buildSymbolId(b)) ?? 0) - (incomingEdges.get(buildSymbolId(a)) ?? 0);
            if (incomingDiff !== 0) return incomingDiff;
            if (a.isEntryPoint !== b.isEntryPoint) return a.isEntryPoint ? -1 : 1;
            if (a.isExported !== b.isExported) return a.isExported ? -1 : 1;
            return a.name.localeCompare(b.name);
        })
        .slice(0, CATEGORY_FILE_PREVIEW_LIMIT);

    if (rankedSymbols.length === 0) {
        return [];
    }

    const lines = ['## Symbol Hotspots (Tier 2)'];
    for (const symbol of rankedSymbols) {
        const incoming = incomingEdges.get(buildSymbolId(symbol)) ?? 0;
        const tags = [
            symbol.kind,
            incoming > 0 ? `${incoming} incoming edges` : 'isolated',
            symbol.isExported ? 'exported' : undefined,
            symbol.isEntryPoint ? 'entry-path' : undefined,
        ].filter(Boolean).join(', ');

        const label = symbol.parentSymbol ? `${symbol.parentSymbol}.${symbol.name}` : symbol.name;
        lines.push(`- \`${label}\` in \`${symbol.filePath}\` — ${tags}`);
    }
    lines.push('');

    return lines;
}

function buildHierarchySection(report: AnalysisReport): string[] {
    if (!report.symbolEdges || report.symbolEdges.length === 0) {
        return [];
    }

    const hierarchyEdges = report.symbolEdges
        .filter((edge) => edge.edgeType === 'extends' || edge.edgeType === 'implements')
        .slice(0, CATEGORY_FILE_PREVIEW_LIMIT);

    if (hierarchyEdges.length === 0) {
        return [];
    }

    const lines = ['## Key Class Hierarchies'];
    for (const edge of hierarchyEdges) {
        lines.push(
            `- \`${edge.sourceName}\` (\`${edge.sourceFile}\`) ${edge.edgeType} \`${edge.targetName}\` (\`${edge.targetFile}\`)`
        );
    }
    lines.push('');

    return lines;
}

// Serialize layer violations — shows concrete backward/skip-layer dependency errors
function buildLayerViolationsSection(report: AnalysisReport): string[] {
    if (!report.layerViolations || report.layerViolations.length === 0) return [];
    const lines = [`## Layer Violations (${report.layerViolations.length} total)`];
    for (const v of report.layerViolations.slice(0, CATEGORY_FILE_PREVIEW_LIMIT)) {
        lines.push(`- \`${v.sourceFile}\` (${v.sourceLayer}) → \`${v.targetFile}\` (${v.targetLayer}) — ${v.direction}`);
    }
    if (report.layerViolations.length > CATEGORY_FILE_PREVIEW_LIMIT) {
        lines.push(`- …and ${report.layerViolations.length - CATEGORY_FILE_PREVIEW_LIMIT} more`);
    }
    lines.push('');
    return lines;
}

// Serialize dead code candidates — symbols with no reachable callers
function buildDeadCodeSection(report: AnalysisReport): string[] {
    if (!report.deadCode || report.deadCode.length === 0) return [];
    const lines = [`## Dead Code Candidates (${report.deadCode.length} total)`];
    for (const c of report.deadCode.slice(0, CATEGORY_FILE_PREVIEW_LIMIT)) {
        lines.push(`- \`${c.symbolName}\` in \`${c.filePath}\`:${c.lineStart} — ${c.reason} (${Math.round(c.confidence * PERCENTAGE_SCALE)}% confidence)`);
    }
    if (report.deadCode.length > CATEGORY_FILE_PREVIEW_LIMIT) {
        lines.push(`- …and ${report.deadCode.length - CATEGORY_FILE_PREVIEW_LIMIT} more`);
    }
    lines.push('');
    return lines;
}

// Serialize co-change pairs — files that frequently change together in git history
function buildChangeCouplingSection(report: AnalysisReport): string[] {
    if (!report.changeCoupling || report.changeCoupling.length === 0) return [];
    const sorted = [...report.changeCoupling].sort((a, b) => b.confidence - a.confidence);
    const lines = [`## Co-Change Pairs (${sorted.length} total, sorted by confidence)`];
    for (const pair of sorted.slice(0, CATEGORY_FILE_PREVIEW_LIMIT)) {
        lines.push(`- \`${pair.fileA}\` ↔ \`${pair.fileB}\` — ${Math.round(pair.confidence * PERCENTAGE_SCALE)}% confidence, ${pair.support} commits`);
    }
    if (sorted.length > CATEGORY_FILE_PREVIEW_LIMIT) {
        lines.push(`- …and ${sorted.length - CATEGORY_FILE_PREVIEW_LIMIT} more`);
    }
    lines.push('');
    return lines;
}

// Serialize process flow traces — DFS paths from entry points through the layer DAG
function buildFlowsSection(report: AnalysisReport): string[] {
    if (!report.flows || report.flows.length === 0) return [];
    const lines = [`## Process Flows (${report.flows.length} traced from entry points)`];
    for (const flow of report.flows.slice(0, FLOW_PREVIEW_LIMIT)) {
        const path = flow.steps.slice(0, FLOW_STEP_PREVIEW_LIMIT).map((s: any) => `\`${s.filePath}\``).join(' → ');
        const more = flow.steps.length > FLOW_STEP_PREVIEW_LIMIT ? ` → …(${flow.steps.length - FLOW_STEP_PREVIEW_LIMIT} more)` : '';
        lines.push(`- ${path}${more}`);
    }
    lines.push('');
    return lines;
}

// Serialize temporal intelligence hotspots and ownership
function buildTemporalSection(report: AnalysisReport): string[] {
    if (!report.temporal || report.temporal.hotspots.length === 0) return [];
    const lines = [`## Temporal Intelligence (Tier 6 - Churn & Risk)`];
    lines.push(`- Average repository churn: **${report.temporal.averageChurn}** commits/file`);
    lines.push('### Risk Hotspots');
    for (const h of report.temporal.hotspots.slice(0, HOT_FILE_PREVIEW_LIMIT)) {
        lines.push(`- \`${h.filePath}\` — ${h.commitCount} commits, Risk: ${h.riskScore} (Complexity x Churn)`);
    }
    
    if (report.temporal.knowledge.length > 0) {
        lines.push('### Ownership Distribution');
        for (const k of report.temporal.knowledge.slice(0, 3)) {
            const topOwner = k.owners[0];
            lines.push(`- \`${k.filePath}\` — Top: ${topOwner.name} (${topOwner.percentage}%)`);
        }
    }
    lines.push('');
    return lines;
}

// Serialize database entities
function buildEntitiesSection(report: AnalysisReport): string[] {
    if (!report.entities || report.entities.length === 0) return [];
    const lines = [`## Data Models & Entities (Tier 4)`];
    for (const e of report.entities.slice(0, CATEGORY_FILE_PREVIEW_LIMIT)) {
        lines.push(`- **${e.name}** in \`${e.sourceFile}\` — ${e.fields.length} fields, ${e.relations.length} relations`);
    }
    lines.push('');
    return lines;
}

// Serialize federated repos
function buildFederationSection(report: AnalysisReport): string[] {
    if (!report.federation) return [];
    const lines = [`## Federated Workspace (Tier 5)`];
    lines.push(`- Sister repositories: ${report.federation.repos.map(r => `\`${r.name}\``).join(', ')}`);
    lines.push(`- Cross-repository edges: **${report.federation.edges.length}** detected`);
    lines.push('');
    return lines;
}


/** Builds the bounded file-content payload used in the Tier 1 AI prompt. */
export function buildTier1PromptFileContents(
    files: Map<string, string>,
    entryPoints: EntryPoint[],
    fileClassifications: FileClassification[],
    metrics: AnalysisReport['metrics'],
    maxSourceFiles: number = DEFAULT_MAX_SOURCE_FILES,
): Record<string, string> {
    const promptFiles: Record<string, string> = {};

    for (const [filePath, content] of files) {
        if (isKeyFilePath(filePath)) {
            promptFiles[filePath] = content.substring(0, KEY_FILE_CONTENT_LIMIT);
        }
    }

    const scoreMaps = buildScoreMaps(entryPoints, fileClassifications, metrics);
    const rankedSourcePaths = [...files.keys()]
        .filter((filePath) => isSourceCodePath(filePath))
        .sort((pathA, pathB) => {
            const scoreDiff = scorePromptFile(pathB, scoreMaps) - scorePromptFile(pathA, scoreMaps);
            return scoreDiff !== 0 ? scoreDiff : pathA.localeCompare(pathB);
        })
        .slice(0, maxSourceFiles);

    for (const filePath of rankedSourcePaths) {
        const content = files.get(filePath);
        if (!content) continue;
        promptFiles[filePath] = content.substring(0, MAX_RAW_SOURCE_CHARS);
    }

    return promptFiles;
}

/** Formats a deterministic analysis report into a compact AI prompt string. */
export function formatReportForAI(
    report: AnalysisReport,
    maxChars: number = MAX_REPORT_CHARS,
    format: ReportFormat = 'markdown'
): string {
    if (format === 'json') {
        return JSON.stringify(report, null, 2).substring(0, maxChars);
    }
    if (format === 'toon') {
        return formatToonReport(report, maxChars);
    }

    const sections: string[] = [];

    sections.push('# Workspace Analysis Report (Machine-Generated, Factual)');
    sections.push('');

    sections.push('## Frameworks & Technologies');
    if (report.frameworks.length > 0) {
        for (const framework of report.frameworks) {
            sections.push(`- **${framework.name}**${framework.version ? ` v${framework.version}` : ''} (${framework.type}) — ${framework.evidence}`);
        }
    } else {
        sections.push('- No known frameworks detected');
    }
    sections.push(`- Primary language: **${report.primaryLanguage}**`);
    sections.push('');

    sections.push('## Entry Points (Detected from manifests and patterns)');
    for (const entryPoint of report.entryPoints.slice(0, ENTRY_POINT_PREVIEW_LIMIT)) {
        sections.push(`- \`${entryPoint.file}\` — ${entryPoint.type} (${entryPoint.confidence} confidence: ${entryPoint.reason})`);
    }
    sections.push('');

    sections.push('## Dependency Graph Summary');
    sections.push(`- **${report.dependencyGraph.nodes.length}** modules`);
    sections.push(`- **${report.dependencyGraph.edges.length}** import edges`);
    if (report.dependencyGraph.circularDependencies.length > 0) {
        sections.push(`- **${report.dependencyGraph.circularDependencies.length}** circular dependencies detected:`);
        for (const cycle of report.dependencyGraph.circularDependencies.slice(0, CIRCULAR_DEPENDENCY_PREVIEW_LIMIT)) {
            sections.push(`  - ${cycle.map((filePath) => `\`${filePath}\``).join(' -> ')}`);
        }
    } else {
        sections.push('- No circular dependencies');
    }
    sections.push('');

    const summary = {} as Record<string, string[]>;
    for (const classification of report.fileClassifications) {
        if (classification.category === 'unknown') continue;
        if (!summary[classification.category]) summary[classification.category] = [];
        summary[classification.category].push(classification.path);
    }

    sections.push('## Architecture Layers (File Classifications)');
    const categoryOrder: FileCategory[] = [
        'entry', 'route', 'controller', 'middleware', 'service',
        'model', 'component', 'utility', 'config', 'type', 'test',
    ];

    for (const category of categoryOrder) {
        const categoryFiles = summary[category];
        if (!categoryFiles || categoryFiles.length === 0) continue;
        const display = categoryFiles.slice(0, CATEGORY_FILE_PREVIEW_LIMIT).map((filePath) => `\`${filePath}\``).join(', ');
        const more = categoryFiles.length > CATEGORY_FILE_PREVIEW_LIMIT ? ` (+${categoryFiles.length - CATEGORY_FILE_PREVIEW_LIMIT} more)` : '';
        sections.push(`- **${category.charAt(0).toUpperCase() + category.slice(1)}** (${categoryFiles.length}): ${display}${more}`);
    }
    sections.push('');

    if (report.metrics.hotFiles.length > 0) {
        sections.push('## Hot Files (Most Connected)');
        for (const metric of report.metrics.hotFiles.slice(0, HOT_FILE_PREVIEW_LIMIT)) {
            sections.push(`- \`${metric.path}\` — ${metric.fanIn} dependents, ${metric.fanOut} deps, ${metric.lines} lines`);
        }
        sections.push('');
    }

    if (report.symbolMetrics?.totalSymbols) {
        sections.push('## Symbol Summary');
        sections.push(`- **${report.symbolMetrics.totalSymbols}** symbols extracted`);
        sections.push(`- **${report.symbolMetrics.totalSymbolEdges}** symbol edges traced`);
        const topKinds = Object.entries(report.symbolMetrics.symbolsByKind)
            .sort((a, b) => b[1] - a[1])
            .slice(0, TOP_KIND_PREVIEW_LIMIT)
            .map(([kind, count]) => `${kind}: ${count}`)
            .join(', ');
        if (topKinds) {
            sections.push(`- By kind: ${topKinds}`);
        }
        sections.push('');
    }

    let current = sections.join('\n');
    if (current.length < maxChars * ORPHAN_SECTION_BUDGET_SHARE && report.metrics.orphanFiles.length > 0) {
        sections.push('## Orphan Files (Disconnected from import graph)');
        for (const filePath of report.metrics.orphanFiles.slice(0, HOT_FILE_PREVIEW_LIMIT)) {
            sections.push(`- \`${filePath}\``);
        }
        sections.push('');
    }

    current = sections.join('\n');
    if (current.length < maxChars * SYMBOL_SECTION_BUDGET_SHARE) {
        const symbolSections = [
            ...buildTopSymbolSection(report),
            ...buildHierarchySection(report),
        ];
        if (symbolSections.length > 0) {
            sections.push(...symbolSections);
        }
    }

    current = sections.join('\n');
    if (current.length < maxChars * ADVANCED_SECTION_BUDGET_SHARE) {
        sections.push(...buildLayerViolationsSection(report));
        sections.push(...buildDeadCodeSection(report));
        sections.push(...buildChangeCouplingSection(report));
        sections.push(...buildFlowsSection(report));
        sections.push(...buildEntitiesSection(report));
        sections.push(...buildFederationSection(report));
        sections.push(...buildTemporalSection(report));
    }

    current = sections.join('\n');
    const remainingBudget = maxChars - current.length;
    const orderedPromptFiles = getOrderedPromptFiles(report);

    if (remainingBudget > PROMPT_CONTEXT_MIN_REMAINING_BUDGET && orderedPromptFiles.length > 0) {
        sections.push('## Ranked Code & Config Context');
        let usedChars = 0;
        const maxFileBudget = Math.max(
            MIN_RANKED_CONTEXT_FILE_BUDGET,
            Math.floor(
                (remainingBudget * RANKED_CONTEXT_FILE_BUDGET_SHARE)
                / Math.min(orderedPromptFiles.length, MAX_RANKED_CONTEXT_FILES)
            )
        );

        for (const [filePath, content] of orderedPromptFiles) {
            const formatted = formatPromptFileContent(filePath, content).substring(0, maxFileBudget);
            if (!formatted.trim()) continue;

            const block = `### ${filePath}\n\`\`\`\n${formatted}\n\`\`\`\n`;
            if (usedChars + block.length > remainingBudget * RANKED_CONTEXT_SECTION_BUDGET_SHARE) break;

            sections.push(block);
            usedChars += block.length;
        }
    }

    sections.push('## Summary Statistics');
    sections.push(`- Total files analyzed: ${report.metrics.totalFiles}`);
    sections.push(`- Total lines of code: ${report.metrics.totalLines.toLocaleString()}`);
    sections.push(`- Average fan-out: ${(report.dependencyGraph.edges.length / Math.max(report.dependencyGraph.nodes.length, 1)).toFixed(1)} imports/file`);
    sections.push('');

    current = sections.join('\n');
    const edgeBudget = maxChars - current.length;
    if (edgeBudget > MIN_IMPORT_EDGE_SECTION_BUDGET) {
        sections.push('## Import Edges (Top sources)');
        const edgesBySource = new Map<string, string[]>();
        for (const edge of report.dependencyGraph.edges) {
            if (!edgesBySource.has(edge.source)) edgesBySource.set(edge.source, []);
            edgesBySource.get(edge.source)!.push(edge.target);
        }

        const scoreMaps = buildScoreMaps(report.entryPoints, report.fileClassifications, report.metrics);
        const sortedSources = [...edgesBySource.entries()]
            .sort((a, b) => {
                const scoreDiff = scorePromptFile(b[0], scoreMaps) - scorePromptFile(a[0], scoreMaps);
                return scoreDiff !== 0 ? scoreDiff : b[1].length - a[1].length;
            })
            .slice(0, IMPORT_EDGE_SOURCE_LIMIT);

        let edgeChars = 0;
        for (const [source, targets] of sortedSources) {
            const line = `- \`${source}\` imports: ${targets.slice(0, IMPORT_EDGE_TARGET_PREVIEW_COUNT).map((target) => `\`${target}\``).join(', ')}`;
            if (edgeChars + line.length > edgeBudget - IMPORT_EDGE_BUDGET_BUFFER) break;
            sections.push(line);
            edgeChars += line.length;
        }
    }

    const result = sections.join('\n');
    if (result.length > maxChars) {
        return result.substring(0, maxChars) + '\n\n[Report truncated to fit token budget]';
    }

    return result;
}

/** Formats a deterministic analysis report into the token-efficient TOON format. */
export function formatToonReport(report: AnalysisReport, maxChars: number = MAX_REPORT_CHARS): string {
    const sections: string[] = [];

    sections.push('@frameworks [');
    if (report.frameworks.length > 0) {
        for (const f of report.frameworks) {
            sections.push(`  #name:${f.name} #type:${f.type}${f.version ? ` #v:${f.version}` : ''}`);
        }
    }
    sections.push(']');
    sections.push(`#lang:${report.primaryLanguage}`);

    sections.push('@entry [');
    for (const e of report.entryPoints.slice(0, ENTRY_POINT_PREVIEW_LIMIT)) {
        sections.push(`  #f:${e.file} #conf:${e.confidence}`);
    }
    sections.push(']');

    sections.push('@graph [');
    sections.push(`  #nodes:${report.dependencyGraph.nodes.length} #edges:${report.dependencyGraph.edges.length}`);
    if (report.dependencyGraph.circularDependencies.length > 0) {
        for (const cycle of report.dependencyGraph.circularDependencies.slice(0, CIRCULAR_DEPENDENCY_PREVIEW_LIMIT)) {
            sections.push(`  #cycle:${cycle.join('|')}`);
        }
    }
    sections.push(']');

    sections.push('@layers [');
    const categoryOrder: FileCategory[] = [
        'entry', 'route', 'controller', 'middleware', 'service',
        'model', 'component', 'utility', 'config', 'type', 'test',
    ];
    for (const category of categoryOrder) {
        const categoryFiles = report.fileClassifications.filter(c => c.category === category);
        if (categoryFiles.length === 0) continue;
        const paths = categoryFiles.slice(0, CATEGORY_FILE_PREVIEW_LIMIT).map(c => c.path).join('|');
        sections.push(`  #${category}:${paths}${categoryFiles.length > CATEGORY_FILE_PREVIEW_LIMIT ? `+${categoryFiles.length - CATEGORY_FILE_PREVIEW_LIMIT}` : ''}`);
    }
    sections.push(']');

    if (report.metrics.hotFiles.length > 0) {
        sections.push('@hot [');
        for (const m of report.metrics.hotFiles.slice(0, HOT_FILE_PREVIEW_LIMIT)) {
            sections.push(`  #f:${m.path} #in:${m.fanIn} #out:${m.fanOut} #L:${m.lines}`);
        }
        sections.push(']');
    }

    if (report.symbolMetrics?.totalSymbols) {
        sections.push(`@symbols #total:${report.symbolMetrics.totalSymbols} #edges:${report.symbolMetrics.totalSymbolEdges}`);
    }

    if (report.layerViolations && report.layerViolations.length > 0) {
        sections.push('@violations [');
        for (const v of report.layerViolations.slice(0, CATEGORY_FILE_PREVIEW_LIMIT)) {
            sections.push(`  #f:${v.sourceFile} #dir:${v.direction}`);
        }
        sections.push(']');
    }

    if (report.deadCode && report.deadCode.length > 0) {
        sections.push('@dead [');
        for (const c of report.deadCode.slice(0, CATEGORY_FILE_PREVIEW_LIMIT)) {
            sections.push(`  #sym:${c.symbolName} #f:${c.filePath} #conf:${Math.round(c.confidence * 100)}`);
        }
        sections.push(']');
    }

    if (report.flows && report.flows.length > 0) {
        sections.push('@flows [');
        for (const flow of report.flows.slice(0, FLOW_PREVIEW_LIMIT)) {
            const path = flow.steps.slice(0, FLOW_STEP_PREVIEW_LIMIT).map((s: any) => s.filePath).join('|');
            sections.push(`  #p:${path}`);
        }
        sections.push(']');
    }

    if (report.entities && report.entities.length > 0) {
        sections.push('@entities [');
        for (const e of report.entities.slice(0, CATEGORY_FILE_PREVIEW_LIMIT)) {
            sections.push(`  #name:${e.name} #fields:${e.fields.length} #rels:${e.relations.length}`);
        }
        sections.push(']');
    }

    if (report.federation) {
        sections.push('@federation [');
        sections.push(`  #repos:${report.federation.repos.length} #crossEdges:${report.federation.edges.length}`);
        for (const r of report.federation.repos.slice(0, 3)) {
            sections.push(`  #sister:${r.name}`);
        }
        sections.push(']');
    }

    if (report.temporal) {
        sections.push('@temporal [');
        sections.push(`  #avgChurn:${report.temporal.averageChurn}`);
        for (const h of report.temporal.hotspots.slice(0, HOT_FILE_PREVIEW_LIMIT)) {
            sections.push(`  #hot:${h.filePath} #churn:${h.commitCount} #risk:${h.riskScore}`);
        }
        sections.push(']');
    }

    const remainingBudget = maxChars - sections.join('\n').length;
    if (remainingBudget > PROMPT_CONTEXT_MIN_REMAINING_BUDGET) {
        const orderedPromptFiles = getOrderedPromptFiles(report);
        if (orderedPromptFiles.length > 0) {
            sections.push('@context [');
            let usedChars = 0;
            for (const [filePath, content] of orderedPromptFiles.slice(0, MAX_RANKED_CONTEXT_FILES)) {
                const formatted = formatPromptFileContent(filePath, content).substring(0, 800);
                const block = `  #f:${filePath}\n${formatted}\n`;
                if (usedChars + block.length > remainingBudget * 0.7) break;
                sections.push(block);
                usedChars += block.length;
            }
            sections.push(']');
        }
    }

    sections.push(`@stats #files:${report.metrics.totalFiles} #LoC:${report.metrics.totalLines}`);

    const result = sections.join('\n');
    return result.length > maxChars ? result.substring(0, maxChars) : result;
}
