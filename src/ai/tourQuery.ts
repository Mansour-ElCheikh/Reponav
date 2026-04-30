import { formatReportForAI, type ReportFormat } from '../analyzers/index';
import type { AnalysisReport, TourType } from '../types';
import { buildUserPrompt } from './prompts';
import { sanitizeForProvider } from './promptSanitizer';

// Report budget in CHARACTERS (not tokens). 40K chars ≈ 10K tokens at 4 chars/token.
// R13 enforces a separate 24KB byte cap on prompts.ts itself.
const VSCODE_LM_REPORT_CHARS = 40_000;

const TOUR_TYPE_KEYWORDS: Record<TourType, string[]> = {
    'overview': ['overview', 'architecture', 'structure', 'how is this organized', 'high level', 'what does this do', 'explain this project'],
    'data-flow': ['data flow', 'request lifecycle', 'how does data', 'trace', 'follow a request', 'pipeline', 'flow'],
    'onboarding': ['onboarding', 'getting started', 'new developer', 'first day', 'where to start', 'how to contribute', 'setup'],
    'dependency-audit': ['dependency', 'circular', 'health', 'audit', 'refactor', 'tech debt', 'code smell', 'coupling'],
    'api-surface': ['api', 'endpoints', 'routes', 'rest', 'graphql', 'external', 'interface'],
    'custom': [],
};

const CODE_TERMS = [
    'code', 'codebase', 'source', 'file', 'folder', 'directory', 'module', 'package',
    'class', 'function', 'method', 'variable', 'component', 'service', 'controller',
    'model', 'schema', 'interface', 'enum', 'constant',
    'architecture', 'structure', 'pattern', 'design', 'layer', 'middleware', 'hook',
    'import', 'export', 'dependency', 'inject', 'provider', 'factory', 'singleton',
    'flow', 'pipeline', 'request', 'response', 'route', 'endpoint', 'handler',
    'lifecycle', 'event', 'callback', 'promise', 'async', 'stream', 'queue',
    'test', 'build', 'deploy', 'config', 'setup', 'debug',
    'error', 'exception', 'logging', 'auth', 'database', 'query', 'migration',
    'api', 'rest', 'graphql', 'websocket', 'http', 'server', 'client',
    'overview', 'onboarding', 'audit', 'refactor', 'organize', 'entry',
    'react', 'vue', 'angular', 'express', 'next', 'node', 'typescript', 'javascript',
    'python', 'django', 'flask', 'spring', 'docker', 'webpack', 'vite', 'esbuild',
];

export interface PreparedTourRequest {
    tourType: TourType;
    analysisText: string;
    userPrompt: string;
}

/** Prepares the provider-specific analysis text and prompt for tour generation. */
export function prepareTourRequest(
    report: AnalysisReport,
    query: string,
    requestedTourType: TourType,
    providerName: string,
    analysisTextOverride?: string,
): PreparedTourRequest {
    const resolvedTourType = requestedTourType === 'custom'
        ? classifyTourType(query)
        : requestedTourType;

    const reportCharBudget = providerName === 'VS Code Language Model'
        ? VSCODE_LM_REPORT_CHARS
        : undefined;

    const format = (process.env.REPONAV_TOUR_FORMAT as ReportFormat) || 'toon';

    let analysisText = analysisTextOverride ?? formatReportForAI(report, reportCharBudget, format);
    // Hard-clamp: ensures text never exceeds the budget even if formatReportForAI
    // slightly overshoots due to header/footer additions.
    if (reportCharBudget !== undefined) {
        analysisText = analysisText.slice(0, reportCharBudget);
    }
    // Strip absolute workspace root from paths before sending to third-party providers.
    analysisText = sanitizeForProvider(analysisText, providerName, report.workspaceRoot ?? '');

    return {
        tourType: resolvedTourType,
        analysisText,
        userPrompt: buildUserPrompt(analysisText, query, resolvedTourType),
    };
}

/** Rejects a promise when it does not settle before the timeout window. */
export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(
            () => reject(new Error(`${label} timed out after ${ms}ms`)),
            ms
        );
        promise.then(
            (value) => { clearTimeout(timer); resolve(value); },
            (error) => { clearTimeout(timer); reject(error); }
        );
    });
}

export function hasWordMatch(text: string, term: string): boolean {
    const pattern = new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
    return pattern.test(text);
}

/** Returns true when a freeform query appears to target repository code. */
export function isCodeRelevantQuery(query: string): boolean {
    const lower = query.toLowerCase();
    return CODE_TERMS.some((term) => hasWordMatch(lower, term));
}

/** Classifies a query into the closest built-in tour type. */
export function classifyTourType(query: string): TourType {
    const lower = query.toLowerCase();

    if (!isCodeRelevantQuery(query)) {
        throw new Error(
            'This question doesn\'t appear to be about the codebase. ' +
            'Try asking about code structure, data flow, dependencies, or specific files.'
        );
    }

    let bestType: TourType = 'custom';
    let bestScore = 0;

    for (const [type, keywords] of Object.entries(TOUR_TYPE_KEYWORDS)) {
        if (type === 'custom') continue;
        const score = keywords.filter((keyword) => lower.includes(keyword)).length;
        if (score > bestScore) {
            bestScore = score;
            bestType = type as TourType;
        }
    }

    if (bestType === 'custom' && lower.length < 10) {
        bestType = 'overview';
    }

    return bestType;
}
