import type { ExtensionToWebviewMessage } from './types';

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

function hasString(value: Record<string, unknown>, key: string): boolean {
    return typeof value[key] === 'string';
}

function hasNumber(value: Record<string, unknown>, key: string): boolean {
    return typeof value[key] === 'number' && Number.isFinite(value[key] as number);
}

function isStringArray(value: unknown): value is string[] {
    return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isTourStep(value: unknown): boolean {
    if (!isRecord(value)) return false;
    if (!hasNumber(value, 'order')) return false;
    if (!hasString(value, 'title')) return false;
    if (!hasString(value, 'what_it_does')) return false;
    if (!hasString(value, 'why_it_matters')) return false;
    if (!hasString(value, 'watch_out')) return false;
    if (!Array.isArray(value.highlights)) return false;
    if (!Array.isArray(value.relationships)) return false;
    if (!isStringArray(value.files)) return false;
    return true;
}

function isGraphNode(value: unknown): boolean {
    if (!isRecord(value)) return false;
    return hasString(value, 'id') && hasString(value, 'label') && hasString(value, 'type');
}

function isGraphEdge(value: unknown): boolean {
    if (!isRecord(value)) return false;
    return hasString(value, 'source') && hasString(value, 'target') && hasString(value, 'label');
}

function isTour(value: unknown): boolean {
    if (!isRecord(value)) return false;
    if (!hasString(value, 'id')) return false;
    if (!hasString(value, 'query')) return false;
    if (!hasString(value, 'tourType')) return false;
    if (!hasString(value, 'createdAt')) return false;

    if (!Array.isArray(value.steps) || !value.steps.every(isTourStep)) return false;

    if (!isRecord(value.graph)) return false;
    if (!Array.isArray(value.graph.nodes) || !value.graph.nodes.every(isGraphNode)) return false;
    if (!Array.isArray(value.graph.edges) || !value.graph.edges.every(isGraphEdge)) return false;

    if (!isRecord(value.analysisSnapshot)) return false;
    if (!isStringArray(value.analysisSnapshot.frameworks)) return false;
    if (!isStringArray(value.analysisSnapshot.entryPoints)) return false;
    if (!hasNumber(value.analysisSnapshot, 'totalFiles')) return false;
    if (!hasNumber(value.analysisSnapshot, 'totalEdges')) return false;

    return true;
}

function isSavedTourSummary(value: unknown): boolean {
    if (!isRecord(value)) return false;
    return (
        hasString(value, 'id')
        && hasString(value, 'query')
        && hasString(value, 'tourType')
        && hasNumber(value, 'stepCount')
        && hasString(value, 'createdAt')
    );
}

function isGitChange(value: unknown): boolean {
    if (!isRecord(value)) return false;
    return hasString(value, 'path') && hasString(value, 'status');
}

export function isExtensionToWebviewMessage(value: unknown): value is ExtensionToWebviewMessage {
    if (!isRecord(value) || typeof value.type !== 'string') {
        return false;
    }

    switch (value.type) {
        case 'tourGenerated':
            return isTour(value.tour);
        case 'analysisComplete':
            return isRecord(value.report);
        case 'tourGenerating':
            return hasString(value, 'status');
        case 'error':
            return hasString(value, 'message');
        case 'openFile':
            return hasString(value, 'path');
        case 'gitStatus':
            return (
                (value.branch === undefined || typeof value.branch === 'string')
                && Array.isArray(value.changes)
                && value.changes.every(isGitChange)
            );
        case 'savedTours':
            return Array.isArray(value.tours) && value.tours.every(isSavedTourSummary);
        case 'appConfig':
            return isRecord(value.config) && typeof value.config.demoMode === 'boolean';
        case 'analyzerReply':
            return hasString(value, 'text');
        case 'analyzerError':
            return hasString(value, 'message');
        case 'tour.stream_chunk':
            return isRecord(value.payload) && (
                (value.payload as Record<string, unknown>).type === 'graph' ||
                (value.payload as Record<string, unknown>).type === 'step'
            );
        case 'tour.stream_end':
            return true;
        default:
            return false;
    }
}
