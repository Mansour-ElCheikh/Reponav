import { rankFilePropagationReach } from '../analyzers/blastRadiusAnalyzer';
import { partitionEntryPointsBySurface } from '../analyzers/entrySurface';
import type { AnalysisReport, AnalysisSummaryPayload, FileCategory, FileClassification, SignalBasis, SummarySignal } from '../types';

const DEFAULT_SUMMARY_SIGNAL_LIMIT = 5;
const OWNERSHIP_CONCENTRATION_THRESHOLD_PERCENTAGE = 75;
const OWNERSHIP_CONCENTRATION_MIN_HISTORY_COMMITS = 4;

// Categories that the architecture and risk families exclude. fileClassifier is the single
// source of truth — every category here exists in the FileCategory enum, no path regex.
//   - test, e2e, fixture: not architectural or risk concerns; agents shouldn't be steered there
//   - example, archive: non-production source
//   - entry: CLI/runtime entry points are not architectural concerns themselves (their fanIn is
//     usually 0 or only from tests, and they tautologically score 1.0 instability)
const NON_STEERING_CATEGORIES: ReadonlySet<FileCategory> = new Set([
    'test', 'e2e', 'fixture', 'example', 'archive', 'entry',
]);

function isSteeringRelevant(filePath: string, categoryByPath: Map<string, FileCategory>): boolean {
    const category = categoryByPath.get(filePath);
    if (category === undefined) return true;
    return !NON_STEERING_CATEGORIES.has(category);
}

function buildCategoryMap(classifications: FileClassification[] | undefined): Map<string, FileCategory> {
    const map = new Map<string, FileCategory>();
    for (const c of classifications ?? []) map.set(c.path, c.category);
    return map;
}

// Derive Instability (I) from fan-in / fan-out while preserving isolated files as null.
function deriveInstability(fanIn: number, fanOut: number): number | null {
    const totalCoupling = fanIn + fanOut;
    if (totalCoupling === 0) return null;
    return fanOut / totalCoupling;
}

// Apply shared basis/sampling metadata to every surfaced summary signal.
// Truth-first: when completeness metadata is absent, basis is 'unknown' rather than overclaiming a scope.
function buildSignal<T>(
    report: AnalysisReport,
    definition: Pick<SummarySignal<T>, 'id' | 'label' | 'family' | 'kind'>,
    data: T,
): SummarySignal<T> {
    const basis: SignalBasis = report.completeness?.analysisScope ?? 'unknown';
    const sampled = report.completeness?.isSampled ?? report.completeness?.analysisCoverage === 'sampled';
    const cappedAt = report.completeness?.cappedAt ?? report.completeness?.graphSampleLimit;
    return {
        ...definition,
        basis,
        sampled,
        ...(cappedAt !== undefined ? { cappedAt } : {}),
        data,
    };
}

// Rank files by outward coupling while preserving zero-coupling files as null.
// Secondary sort by fanOut so high-magnitude purely-outward files outrank low-magnitude ones at value=1.
// Two filters:
//   1. Category (single source of truth — fileClassifier): exclude test, e2e, example, fixture,
//      archive, entry. High fanOut there is import surface or CLI orchestration, not architectural
//      instability of the dependency graph itself.
//   2. Math: exclude fanIn === 0 leaves — every leaf trivially scores 1.0, drowning out files in
//      the middle of the graph (which is where the Stable Dependencies Principle is meaningful).
function rankInstability(report: AnalysisReport, categoryByPath: Map<string, FileCategory>): Array<{ file: string; value: number | null; fanOut: number }> {
    return report.metrics.fileMetrics
        .filter((metric) => isSteeringRelevant(metric.path, categoryByPath) && metric.fanIn > 0)
        .map((metric) => ({
            file: metric.path,
            value: metric.instability ?? deriveInstability(metric.fanIn, metric.fanOut),
            fanOut: metric.fanOut,
        }))
        .sort((left, right) => {
            const leftValue = left.value ?? -1;
            const rightValue = right.value ?? -1;
            if (rightValue !== leftValue) return rightValue - leftValue;
            if (right.fanOut !== left.fanOut) return right.fanOut - left.fanOut;
            return left.file.localeCompare(right.file);
        })
        .slice(0, DEFAULT_SUMMARY_SIGNAL_LIMIT);
}

// Mirror the temporal analyzer's age buckets so dangerous-hotspot scoring uses the same recency semantics.
function getTemporalRecencyWeight(lastChangedAt: string): number {
    const changedAtMs = Date.parse(lastChangedAt);
    if (Number.isNaN(changedAtMs)) return 1;

    const ageDays = (Date.now() - changedAtMs) / (1000 * 60 * 60 * 24);
    if (ageDays < 30) return 1.5;
    if (ageDays < 90) return 1.2;
    if (ageDays < 180) return 1.0;
    return 0.8;
}

// Round derived steering values so the summary contract stays readable and stable in tests.
function roundSignalValue(value: number, decimals = 2): number {
    return Number(value.toFixed(decimals));
}

// Rank files where a single author dominates the known history while surfacing sparse-history truth explicitly.
function buildOwnershipConcentrationData(report: AnalysisReport, categoryByPath: Map<string, FileCategory>): {
    thresholdPercentage: number;
    minHistoryCommits: number;
    ranked: Array<{
        file: string;
        dominantOwner: string;
        dominantPercentage: number;
        totalCommits: number;
        sparseHistory: boolean;
        flagged: boolean;
    }>;
} | null {
    if (!report.temporal?.knowledge?.length) return null;

    const ranked = report.temporal.knowledge
        .filter((knowledge) => isSteeringRelevant(knowledge.filePath, categoryByPath))
        .map((knowledge) => {
            const dominantOwner = knowledge.owners[0];
            if (!dominantOwner) return null;
            const totalCommits = knowledge.owners.reduce((acc, owner) => acc + owner.commitCount, 0);
            const dominantPercentage = dominantOwner.percentage;
            const sparseHistory = totalCommits < OWNERSHIP_CONCENTRATION_MIN_HISTORY_COMMITS;
            const flagged = dominantPercentage >= OWNERSHIP_CONCENTRATION_THRESHOLD_PERCENTAGE;

            return {
                file: knowledge.filePath,
                dominantOwner: dominantOwner.name || dominantOwner.email,
                dominantPercentage,
                totalCommits,
                sparseHistory,
                flagged,
            };
        })
        // Drop sparse-history rows: a single-commit file with one author is not knowledge concentration.
        // Truth-first principle — the underlying basis (≥4 commits) does not support a concentration claim.
        .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry?.flagged && !entry.sparseHistory))
        .sort((left, right) => {
            if (right.dominantPercentage !== left.dominantPercentage) {
                return right.dominantPercentage - left.dominantPercentage;
            }
            if (right.totalCommits !== left.totalCommits) {
                return right.totalCommits - left.totalCommits;
            }
            return left.file.localeCompare(right.file);
        })
        .slice(0, DEFAULT_SUMMARY_SIGNAL_LIMIT);

    if (ranked.length === 0) return null;

    return {
        thresholdPercentage: OWNERSHIP_CONCENTRATION_THRESHOLD_PERCENTAGE,
        minHistoryCommits: OWNERSHIP_CONCENTRATION_MIN_HISTORY_COMMITS,
        ranked,
    };
}

// Combine churn recency with structural centrality using the pinned slice-2 hotspot formula.
function buildDangerousHotspotsData(report: AnalysisReport, categoryByPath: Map<string, FileCategory>): {
    formula: string;
    structuralCentralityMetric: 'fanIn';
    ranked: Array<{
        file: string;
        value: number;
        recencyWeightedChurn: number;
        fanIn: number;
    }>;
} | null {
    if (!report.temporal?.hotspots?.length) return null;

    const metricsByFile = new Map(report.metrics.fileMetrics.map((metric) => [metric.path, metric]));
    const ranked = report.temporal.hotspots
        .filter((hotspot) => isSteeringRelevant(hotspot.filePath, categoryByPath))
        .map((hotspot) => {
            const metrics = metricsByFile.get(hotspot.filePath);
            if (!metrics) return null;

            const recencyWeightedChurn = roundSignalValue(
                hotspot.commitCount * getTemporalRecencyWeight(hotspot.lastChangedAt),
            );
            const fanIn = metrics.fanIn;
            const value = roundSignalValue(recencyWeightedChurn * fanIn);

            return {
                file: hotspot.filePath,
                value,
                recencyWeightedChurn,
                fanIn,
                commitCount: hotspot.commitCount,
            };
        })
        // Significance floor: at least one of churn or structural centrality must be non-trivial.
        // A single-commit file with one inbound dependency is not a dangerous hotspot regardless of recency.
        .filter((entry): entry is NonNullable<typeof entry> =>
            Boolean(entry && entry.value > 0 && (entry.commitCount > 1 || entry.fanIn > 1)),
        )
        .map(({ file, value, recencyWeightedChurn, fanIn }) => ({ file, value, recencyWeightedChurn, fanIn }))
        .sort((left, right) => {
            if (right.value !== left.value) return right.value - left.value;
            if (right.fanIn !== left.fanIn) return right.fanIn - left.fanIn;
            return left.file.localeCompare(right.file);
        })
        .slice(0, DEFAULT_SUMMARY_SIGNAL_LIMIT);

    if (ranked.length === 0) return null;

    return {
        formula: 'score = recencyWeightedChurn * fanIn',
        structuralCentralityMetric: 'fanIn',
        ranked,
    };
}

function buildArchitectureSignals(report: AnalysisReport, categoryByPath: Map<string, FileCategory>): SummarySignal[] {
    const productionHotFiles = report.metrics.hotFiles
        .filter((metric) => isSteeringRelevant(metric.path, categoryByPath))
        .slice(0, DEFAULT_SUMMARY_SIGNAL_LIMIT)
        .map((metric) => ({ file: metric.path, value: metric.fanIn }));

    // Compute propagation reach over the full graph (semantically correct — tests do depend on
    // production code), then surface only steering-relevant files in the ranked output.
    const fullReachRanking = rankFilePropagationReach(
        report.dependencyGraph.nodes,
        report.dependencyGraph.edges,
        report.dependencyGraph.nodes.length,
    );
    const productionPropagationReach = fullReachRanking
        .filter((entry) => isSteeringRelevant(entry.file, categoryByPath))
        .slice(0, DEFAULT_SUMMARY_SIGNAL_LIMIT);

    const signals: SummarySignal[] = [
        buildSignal(report, {
            id: 'hot-files',
            label: 'Hot files',
            family: 'architecture',
            kind: 'fact',
        }, productionHotFiles),
        buildSignal(report, {
            id: 'instability',
            label: 'Instability',
            family: 'architecture',
            kind: 'derived',
        }, rankInstability(report, categoryByPath)),
        buildSignal(report, {
            id: 'propagation-reach',
            label: 'Propagation reach',
            family: 'architecture',
            kind: 'derived',
        }, productionPropagationReach),
    ];

    if (report.layerViolations) {
        signals.push(buildSignal(report, {
            id: 'layer-violations',
            label: 'Layer violations',
            family: 'architecture',
            kind: 'fact',
        }, { count: report.layerViolations.length }));
    }

    signals.push(buildSignal(report, {
        id: 'circular-dependencies',
        label: 'Circular dependencies',
        family: 'architecture',
        kind: 'fact',
    }, { count: report.dependencyGraph.circularDependencies.length }));

    return signals;
}

function buildRiskSignals(report: AnalysisReport, categoryByPath: Map<string, FileCategory>): SummarySignal[] {
    const signals: SummarySignal[] = [];

    if (report.temporal?.hotspots?.length) {
        const filteredHotspots = report.temporal.hotspots
            .filter((hotspot) => isSteeringRelevant(hotspot.filePath, categoryByPath))
            .slice(0, DEFAULT_SUMMARY_SIGNAL_LIMIT)
            .map((hotspot) => ({ file: hotspot.filePath, value: hotspot.riskScore }));
        if (filteredHotspots.length > 0) {
            signals.push(buildSignal(report, {
                id: 'temporal-hotspots',
                label: 'Temporal hotspots',
                family: 'risk',
                kind: 'fact',
            }, filteredHotspots));
        }
    }

    const ownershipConcentration = buildOwnershipConcentrationData(report, categoryByPath);
    if (ownershipConcentration) {
        signals.push(buildSignal(report, {
            id: 'ownership-concentration',
            label: 'Ownership concentration',
            family: 'risk',
            kind: 'derived',
        }, ownershipConcentration));
    }

    const dangerousHotspots = buildDangerousHotspotsData(report, categoryByPath);
    if (dangerousHotspots) {
        signals.push(buildSignal(report, {
            id: 'dangerous-hotspots',
            label: 'Dangerous hotspots',
            family: 'risk',
            kind: 'derived',
        }, dangerousHotspots));
    }

    return signals;
}

function buildConfidenceSignals(report: AnalysisReport): SummarySignal[] {
    const cappedAt = report.completeness?.cappedAt ?? report.completeness?.graphSampleLimit;
    return [
        buildSignal(report, {
            id: 'analysis-completeness',
            label: 'Analysis completeness',
            family: 'confidence',
            kind: 'fact',
        }, {
            analysisScope: report.completeness?.analysisScope ?? 'fullWorkspace',
            analyzedFileCount: report.completeness?.analyzedFileCount ?? report.metrics.totalFiles,
            graphNodeCount: report.completeness?.graphNodeCount ?? report.dependencyGraph.nodes.length,
            graphEdgeCount: report.completeness?.graphEdgeCount ?? report.dependencyGraph.edges.length,
            analysisCoverage: report.completeness?.analysisCoverage ?? 'complete',
            graphCoverage: report.completeness?.graphCoverage ?? 'complete',
            isSampled: report.completeness?.isSampled ?? false,
            ...(cappedAt !== undefined ? { cappedAt } : {}),
        }),
    ];
}

/** Validates the public summary signal inventory so ids stay unique across families. */
export function validateSummarySignalContract(
    signals: Array<Pick<SummarySignal, 'id' | 'family' | 'kind'>>,
): void {
    const seen = new Map<string, { family: string; kind: string }>();

    for (const signal of signals) {
        if (!signal.id || !signal.family || !signal.kind) {
            throw new Error(`Invalid summary signal definition: ${JSON.stringify(signal)}`);
        }
        const existing = seen.get(signal.id);
        if (existing) {
            throw new Error(`Duplicate summary signal id "${signal.id}" across ${existing.family} and ${signal.family}`);
        }
        seen.set(signal.id, { family: signal.family, kind: signal.kind });
    }
}

/** Builds the additive summary payload used by both CLI and MCP summary outputs. */
export function buildSummaryPayload(report: AnalysisReport): AnalysisSummaryPayload {
    const { runtimeEntryPoints, launchSurfaces } = partitionEntryPointsBySurface(report.entryPoints);
    const categoryByPath = buildCategoryMap(report.fileClassifications);
    const architecture = buildArchitectureSignals(report, categoryByPath);
    const risk = buildRiskSignals(report, categoryByPath);
    const confidence = buildConfidenceSignals(report);

    validateSummarySignalContract([...architecture, ...risk, ...confidence]);

    return {
        workspaceRoot: report.workspaceRoot,
        primaryLanguage: report.primaryLanguage,
        frameworks: report.frameworks,
        completeness: report.completeness,
        entryPoints: report.entryPoints,
        runtimeRoots: runtimeEntryPoints,
        launchSurfaces,
        hotFiles: report.metrics.hotFiles,
        orphanCount: report.metrics.orphanFiles.length,
        totalFiles: report.metrics.totalFiles,
        circularDeps: report.dependencyGraph.circularDependencies.length,
        hotFilesCoverage: report.metrics.hotFiles.reduce((acc, file) => acc + file.fanIn, 0) / Math.max(report.metrics.fileMetrics.reduce((acc, metric) => acc + metric.fanIn, 0), 1),
        architecture,
        risk,
        confidence,
    };
}
