/**
 * Metrics Collector
 *
 * Computes lightweight, deterministic file metrics from workspace files
 * and resolved dependency edges.
 */

import { FileMetrics, ImportEdge } from '../types';

const MIN_HOT_FILES = 5;
const MAX_HOT_FILES = 100;
const HOT_FILES_COVERAGE_TARGET = 0.8;

interface MetricsSummary {
    totalFiles: number;
    totalLines: number;
    fileMetrics: FileMetrics[];
    hotFiles: FileMetrics[];
    orphanFiles: string[];
}

// Derive Instability (I) from fan-in / fan-out while preserving isolated files as null.
function computeInstability(fanIn: number, fanOut: number): number | null {
    const totalCoupling = fanIn + fanOut;
    if (totalCoupling === 0) return null;
    return fanOut / totalCoupling;
}

function countNonEmptyLines(content: string): number {
    return content
        .split(/\r?\n/)
        .filter((line) => line.trim().length > 0)
        .length;
}

function countImportStatements(content: string): number {
    const matches = content.match(/\bimport\b|require\s*\(/g);
    return matches ? matches.length : 0;
}

function countExportStatements(content: string): number {
    const matches = content.match(/\bexport\b|module\.exports|exports\./g);
    return matches ? matches.length : 0;
}

/** Computes file-level metrics (lines, fan-in, fan-out, orphan detection) from workspace files and import edges. */
export async function collectMetrics(
    files: Map<string, string>,
    edges: ImportEdge[]
): Promise<MetricsSummary> {
    const fanIn = new Map<string, number>();
    const fanOut = new Map<string, number>();

    for (const filePath of files.keys()) {
        fanIn.set(filePath, 0);
        fanOut.set(filePath, 0);
    }

    for (const edge of edges) {
        fanOut.set(edge.source, (fanOut.get(edge.source) ?? 0) + 1);
        fanIn.set(edge.target, (fanIn.get(edge.target) ?? 0) + 1);
    }

    const fileMetrics: FileMetrics[] = [];
    let totalLines = 0;

    for (const [filePath, content] of files) {
        const lines = countNonEmptyLines(content);
        totalLines += lines;

        fileMetrics.push({
            path: filePath,
            lines,
            importCount: countImportStatements(content),
            exportCount: countExportStatements(content),
            fanIn: fanIn.get(filePath) ?? 0,
            fanOut: fanOut.get(filePath) ?? 0,
            instability: computeInstability(fanIn.get(filePath) ?? 0, fanOut.get(filePath) ?? 0),
        });
    }

    const sortedByFanIn = [...fileMetrics].sort((a, b) => {
        if (b.fanIn !== a.fanIn) return b.fanIn - a.fanIn;
        if (b.fanOut !== a.fanOut) return b.fanOut - a.fanOut;
        return b.lines - a.lines;
    });
    const totalFanIn = sortedByFanIn.reduce((acc, m) => acc + m.fanIn, 0);
    const targetFanIn = totalFanIn * HOT_FILES_COVERAGE_TARGET;
    const hotFiles: FileMetrics[] = [];
    let cumulativeFanIn = 0;
    for (const metric of sortedByFanIn) {
        if (hotFiles.length >= MAX_HOT_FILES) break;
        hotFiles.push(metric);
        cumulativeFanIn += metric.fanIn;
        if (hotFiles.length >= MIN_HOT_FILES && cumulativeFanIn >= targetFanIn) break;
    }

    const orphanFiles = fileMetrics
        .filter((m) => m.fanIn === 0 && m.fanOut === 0)
        .map((m) => m.path);

    return {
        totalFiles: files.size,
        totalLines,
        fileMetrics,
        hotFiles,
        orphanFiles,
    };
}
