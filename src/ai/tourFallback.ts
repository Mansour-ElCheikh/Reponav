import type {
    AnalysisReport,
    Tour,
    TourGraph,
    TourStep,
    TourType,
    GraphEdge,
    GraphNode,
    FileCategory,
} from '../types';

/** Minimum number of steps in a fallback tour. Padded with hot files if entry points are few. */
const MIN_FALLBACK_STEPS = 3;

/**
 * Describe a file's role based on its classification and metrics.
 */
export function describeFileRole(
    filePath: string,
    report: AnalysisReport,
): { what_it_does: string; why_it_matters: string } {
    const classification = report.fileClassifications.find((c) => c.path === filePath);
    const metric = report.metrics.fileMetrics.find((m) => m.path === filePath);
    const entryPoint = report.entryPoints.find((ep) => ep.file === filePath);

    const category = classification?.category ?? 'unknown';
    const fanIn = metric?.fanIn ?? 0;
    const fanOut = metric?.fanOut ?? 0;
    const lines = metric?.lines ?? 0;

    // Build concrete description
    const parts: string[] = [];
    if (entryPoint) {
        parts.push(`This is a ${entryPoint.type} entry point (${entryPoint.reason}, ${entryPoint.confidence} confidence).`);
    }
    parts.push(`Classified as "${category}" with ${lines} lines.`);
    if (fanIn > 0 || fanOut > 0) {
        parts.push(`It has ${fanIn} dependent${fanIn !== 1 ? 's' : ''} (fan-in) and imports ${fanOut} module${fanOut !== 1 ? 's' : ''} (fan-out).`);
    }

    // Build importance statement
    let importance: string;
    if (entryPoint) {
        importance = `As a ${entryPoint.type} entry point, this is where execution begins. Understanding this file first provides the right starting context for navigating the rest of the codebase.`;
    } else if (fanIn >= 5) {
        importance = `With ${fanIn} dependents, this is a highly-connected hub in the dependency graph. Changes here have wide-reaching impact across the codebase.`;
    } else if (category === 'config') {
        importance = `Configuration files define the project's build, runtime, and tooling behavior. Understanding the configuration is essential for local development setup.`;
    } else {
        importance = `This ${category} module contributes to the project's ${category === 'service' ? 'business logic' : category === 'utility' ? 'shared infrastructure' : 'overall architecture'}.`;
    }

    return {
        what_it_does: parts.join(' '),
        why_it_matters: importance,
    };
}

/** Builds a deterministic no-AI fallback tour from the analyzed workspace structure. */
export function buildStructuralFallbackTour(
    report: AnalysisReport,
    query: string,
    tourType: TourType,
): Tour {
    const entryPoints = report.entryPoints.slice(0, 5);
    const steps: TourStep[] = entryPoints.map((entryPoint, index) => {
        const { what_it_does, why_it_matters } = describeFileRole(entryPoint.file, report);

        // Build relationships from dependency graph
        const outEdges = report.dependencyGraph.edges
            .filter((edge) => edge.source === entryPoint.file)
            .slice(0, 3)
            .map((edge) => ({
                from: edge.source,
                to: edge.target,
                type: 'imports' as const,
            }));

        return {
            order: index + 1,
            title: `Entry point: ${entryPoint.file}`,
            what_it_does,
            why_it_matters,
            watch_out: 'AI narration unavailable — this tour shows structural data from the analysis report.',
            files: [entryPoint.file],
            highlights: [],
            relationships: outEdges,
        };
    });

    // Pad with hot files if we don't have enough entry points to meet minimum
    if (steps.length < MIN_FALLBACK_STEPS && report.metrics.hotFiles.length > 0) {
        const existingFiles = new Set(steps.map((s) => s.files[0]));
        const hotFilesToAdd = report.metrics.hotFiles
            .filter((hf) => !existingFiles.has(hf.path))
            .slice(0, MIN_FALLBACK_STEPS - steps.length);

        for (const hotFile of hotFilesToAdd) {
            const { what_it_does, why_it_matters } = describeFileRole(hotFile.path, report);
            const outEdges = report.dependencyGraph.edges
                .filter((edge) => edge.source === hotFile.path)
                .slice(0, 3)
                .map((edge) => ({
                    from: edge.source,
                    to: edge.target,
                    type: 'imports' as const,
                }));

            steps.push({
                order: steps.length + 1,
                title: `Hot file: ${hotFile.path}`,
                what_it_does,
                why_it_matters,
                watch_out: 'AI narration unavailable — this tour shows structural data from the analysis report.',
                files: [hotFile.path],
                highlights: [],
                relationships: outEdges,
            });
        }
    }

    // Final fallback: if still no steps, create a summary step
    if (steps.length === 0) {
        steps.push({
            order: 1,
            title: 'Workspace structural overview',
            what_it_does: `This workspace contains ${report.metrics.totalFiles} files with ${report.dependencyGraph.edges.length} dependency edges across ${report.dependencyGraph.nodes.length} modules. ${report.frameworks.length > 0 ? `Detected frameworks: ${report.frameworks.map((f) => f.name).join(', ')}.` : 'No known frameworks were detected.'}`,
            why_it_matters: 'Understanding the overall structure and scale of the project is the first step toward navigating it effectively.',
            watch_out: 'AI narration unavailable — this tour shows structural data from the analysis report.',
            files: [],
            highlights: [],
            relationships: [],
        });
    }

    const classificationMap = new Map(report.fileClassifications.map((classification) => [classification.path, classification.category]));
    const stepFiles = new Set(steps.flatMap((step) => step.files));
    const nodes: GraphNode[] = [...stepFiles].map((filePath) => ({
        id: filePath,
        label: filePath.split('/').pop() || filePath,
        type: classificationMap.get(filePath) ?? ('unknown' as FileCategory),
    }));
    const edges: GraphEdge[] = report.dependencyGraph.edges
        .filter((edge) => stepFiles.has(edge.source) && stepFiles.has(edge.target))
        .map((edge) => ({ source: edge.source, target: edge.target, label: 'imports' }));
    const graph: TourGraph = { nodes, edges };

    return {
        id: generateTourId(),
        query,
        tourType,
        steps,
        graph,
        analysisSnapshot: {
            frameworks: report.frameworks.map((framework) => framework.name),
            entryPoints: report.entryPoints.map((entryPoint) => entryPoint.file),
            totalFiles: report.metrics.totalFiles,
            totalEdges: report.dependencyGraph.edges.length,
            circularCount: report.dependencyGraph.circularDependencies.length,
        },
        createdAt: new Date().toISOString(),
        aiGenerated: false,
    };
}

/** Generates a stable-enough client id for newly created tours. */
export function generateTourId(): string {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 8);
    return `tour_${timestamp}_${random}`;
}
