import type { EntryPoint, EntrySurface, FlowSequence } from '../types';

const TOOLING_ENTRY_PREFIXES = [
    'bin/',
    'scripts/',
    'presentation/',
    'presentation-v2/',
    'docs/',
    'dev/',
    '.github/',
    '.reponav/',
];

/** Infers whether an entry-like file belongs to a runtime or tooling surface. */
export function inferEntrySurface(filePath: string): EntrySurface {
    const normalizedPath = filePath.replace(/\\/g, '/');
    return TOOLING_ENTRY_PREFIXES.some((prefix) => normalizedPath.startsWith(prefix))
        ? 'tooling'
        : 'runtime';
}

/** Partitions flows by the entry surface already assigned in the analyzer model. */
export function partitionFlowsByEntrySurface(flows: FlowSequence[]): {
    runtimeFlows: FlowSequence[];
    toolingFlows: FlowSequence[];
} {
    const runtimeFlows: FlowSequence[] = [];
    const toolingFlows: FlowSequence[] = [];

    for (const flow of flows) {
        const entrySurface = flow.entrySurface ?? inferEntrySurface(flow.entryPoint);
        if (entrySurface === 'tooling') {
            toolingFlows.push(flow);
            continue;
        }
        runtimeFlows.push(flow);
    }

    return { runtimeFlows, toolingFlows };
}

/** Partitions detected entry points into runtime entry points and tooling launch surfaces. */
export function partitionEntryPointsBySurface(entryPoints: EntryPoint[]): {
    runtimeEntryPoints: string[];
    launchSurfaces: string[];
} {
    const runtimeEntryPoints: string[] = [];
    const launchSurfaces: string[] = [];

    for (const entryPoint of entryPoints) {
        const entrySurface = entryPoint.entrySurface ?? inferEntrySurface(entryPoint.file);
        if (entrySurface === 'tooling') {
            launchSurfaces.push(entryPoint.file);
            continue;
        }
        runtimeEntryPoints.push(entryPoint.file);
    }

    return { runtimeEntryPoints, launchSurfaces };
}