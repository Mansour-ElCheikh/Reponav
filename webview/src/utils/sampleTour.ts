/**
 * Sample tour for demo/offline mode.
 *
 * A hardcoded tour of RepoNav itself — used when no API key is configured
 * or when the user wants to preview what a tour looks like.
 */

import type { Tour } from './types';

const LINE_START_ONE = 1;
const EXTENSION_ENTRY_END = 40;
const ANALYZER_INDEX_END = 50;
const IMPORT_ANALYZER_END = 30;
const TOUR_GENERATOR_END = 60;
const WEBVIEW_PROVIDER_START = 100;
const WEBVIEW_PROVIDER_END = 200;
const SHARED_TYPES_START = 92;
const SHARED_TYPES_END = 111;
const APP_HIGHLIGHT_START = 55;
const APP_HIGHLIGHT_END = 115;

const EXTENSION_ENTRY_HIGHLIGHT = [LINE_START_ONE, EXTENSION_ENTRY_END] as const;
const ANALYZER_INDEX_HIGHLIGHT = [LINE_START_ONE, ANALYZER_INDEX_END] as const;
const IMPORT_ANALYZER_HIGHLIGHT = [LINE_START_ONE, IMPORT_ANALYZER_END] as const;
const TOUR_GENERATOR_HIGHLIGHT = [LINE_START_ONE, TOUR_GENERATOR_END] as const;
const PROMPTS_HIGHLIGHT = [LINE_START_ONE, IMPORT_ANALYZER_END] as const;
const WEBVIEW_PROVIDER_HIGHLIGHT = [WEBVIEW_PROVIDER_START, WEBVIEW_PROVIDER_END] as const;
const SHARED_TYPES_HIGHLIGHT = [SHARED_TYPES_START, SHARED_TYPES_END] as const;
const APP_HIGHLIGHT = [APP_HIGHLIGHT_START, APP_HIGHLIGHT_END] as const;
const SIGMA_GRAPH_HIGHLIGHT = [LINE_START_ONE, ANALYZER_INDEX_END] as const;

export const SAMPLE_TOUR: Tour = {
    id: 'sample-reponav-overview',
    query: 'Give me an overview of this codebase',
    tourType: 'overview',
    createdAt: '2026-03-09T00:00:00.000Z',
    analysisSnapshot: {
        frameworks: ['VS Code Extension API', 'React', 'Vite'],
        entryPoints: ['src/extension.ts'],
        totalFiles: 28,
        totalEdges: 42,
        circularCount: 0,
    },
    graph: {
        nodes: [
            { id: 'src/extension.ts', label: 'extension.ts', type: 'entry', weight: 10 },
            { id: 'src/ai/tourGenerator.ts', label: 'tourGenerator.ts', type: 'service', weight: 8 },
            { id: 'src/analyzers/index.ts', label: 'analyzers/index.ts', type: 'service', weight: 9 },
            { id: 'src/webview/webviewProvider.ts', label: 'webviewProvider.ts', type: 'controller', weight: 7 },
            { id: 'src/ai/llmClient.ts', label: 'llmClient.ts', type: 'service', weight: 5 },
            { id: 'src/ai/GroqProvider.ts', label: 'GroqProvider.ts', type: 'service', weight: 4 },
            { id: 'src/ai/prompts.ts', label: 'prompts.ts', type: 'utility', weight: 4 },
            { id: 'src/analyzers/importAnalyzer.ts', label: 'importAnalyzer.ts', type: 'utility', weight: 5 },
            { id: 'src/analyzers/frameworkDetector.ts', label: 'frameworkDetector.ts', type: 'utility', weight: 3 },
            { id: 'src/db/RepoDatabase.ts', label: 'RepoDatabase.ts', type: 'model', weight: 5 },
            { id: 'src/services/tours/TourSerializer.ts', label: 'TourSerializer.ts', type: 'utility', weight: 4 },
            { id: 'shared/types.ts', label: 'types.ts', type: 'type', weight: 6 },
            { id: 'webview/src/App.tsx', label: 'App.tsx', type: 'component', weight: 7 },
            { id: 'webview/src/components/SigmaGraph.tsx', label: 'SigmaGraph.tsx', type: 'component', weight: 5 },
            { id: 'webview/src/components/StepPanel.tsx', label: 'StepPanel.tsx', type: 'component', weight: 4 },
            { id: 'src/WorkspaceAdapter.ts', label: 'WorkspaceAdapter.ts', type: 'type', weight: 4 },
        ],
        edges: [
            { source: 'src/extension.ts', target: 'src/webview/webviewProvider.ts', label: 'imports' },
            { source: 'src/extension.ts', target: 'src/ai/tourGenerator.ts', label: 'imports' },
            { source: 'src/extension.ts', target: 'src/db/RepoDatabase.ts', label: 'imports' },
            { source: 'src/webview/webviewProvider.ts', target: 'src/analyzers/index.ts', label: 'imports' },
            { source: 'src/webview/webviewProvider.ts', target: 'src/ai/tourGenerator.ts', label: 'imports' },
            { source: 'src/webview/webviewProvider.ts', target: 'src/services/tours/TourSerializer.ts', label: 'imports' },
            { source: 'src/ai/tourGenerator.ts', target: 'src/ai/llmClient.ts', label: 'imports' },
            { source: 'src/ai/tourGenerator.ts', target: 'src/ai/prompts.ts', label: 'imports' },
            { source: 'src/ai/llmClient.ts', target: 'src/ai/GroqProvider.ts', label: 'imports' },
            { source: 'src/analyzers/index.ts', target: 'src/analyzers/importAnalyzer.ts', label: 'imports' },
            { source: 'src/analyzers/index.ts', target: 'src/analyzers/frameworkDetector.ts', label: 'imports' },
            { source: 'src/analyzers/index.ts', target: 'src/WorkspaceAdapter.ts', label: 'imports' },
            { source: 'webview/src/App.tsx', target: 'webview/src/components/SigmaGraph.tsx', label: 'imports' },
            { source: 'webview/src/App.tsx', target: 'webview/src/components/StepPanel.tsx', label: 'imports' },
        ],
    },
    steps: [
        {
            order: 0,
            title: 'Entry Point — extension.ts',
            what_it_does:
                'This is where VS Code activates RepoNav. It registers the commands (Generate Tour, Open Panel), wires up all dependencies via constructor injection, and hands control to the WebviewProvider.',
            why_it_matters:
                'Everything starts here. When a user runs "RepoNav: Generate Architecture Tour", this file is what receives that command and kicks off the pipeline.',
            watch_out:
                'Only this file (plus VSCodeWorkspaceAdapter and webviewProvider) may import from `vscode`. All other modules must stay pure TypeScript so they can be unit-tested without a VS Code host.',
            files: ['src/extension.ts'],
            highlights: [{ file: 'src/extension.ts', lines: [...EXTENSION_ENTRY_HIGHLIGHT] }],
            relationships: [
                { from: 'src/extension.ts', to: 'src/webview/webviewProvider.ts', type: 'imports' },
                { from: 'src/extension.ts', to: 'src/ai/tourGenerator.ts', type: 'imports' },
            ],
        },
        {
            order: 1,
            title: 'Static Analysis Pipeline — analyzers/index.ts',
            what_it_does:
                'The analyzer orchestrator runs in two tiers. Tier 0 (~500ms) scans the file tree and reads package manifests. Tier 1 (1–3s) resolves imports, builds the dependency graph, detects frameworks, and collects per-file metrics.',
            why_it_matters:
                'This is the "80%" of the 80/20 rule — deterministic, AI-free analysis that generates a structured report. The AI only narrates; it does not discover structure. That makes tours reproducible and debuggable.',
            watch_out:
                'The analysis must complete before the AI call. Token budget for the report sent to the LLM is capped to stay under the provider limit — large repos use summarized hotfiles rather than full content.',
            files: [
                'src/analyzers/index.ts',
                'src/analyzers/importAnalyzer.ts',
                'src/analyzers/frameworkDetector.ts',
            ],
            highlights: [
                { file: 'src/analyzers/index.ts', lines: [...ANALYZER_INDEX_HIGHLIGHT] },
                { file: 'src/analyzers/importAnalyzer.ts', lines: [...IMPORT_ANALYZER_HIGHLIGHT] },
            ],
            relationships: [
                { from: 'src/analyzers/index.ts', to: 'src/analyzers/importAnalyzer.ts', type: 'calls' },
                { from: 'src/analyzers/index.ts', to: 'src/analyzers/frameworkDetector.ts', type: 'calls' },
            ],
        },
        {
            order: 2,
            title: 'AI Tour Generation — tourGenerator.ts + prompts.ts',
            what_it_does:
                'The TourGenerator takes the analysis report, formats it into a structured prompt (under 6K tokens), calls the configured LLM provider (Groq primary, Gemini fallback, Mock for offline), and validates + normalises the JSON response into a Tour object.',
            why_it_matters:
                'This is the "20%". The AI\'s job is to explain what the static analysis found — in plain language, with real file references. If the AI fails, the extension degrades gracefully and shows a deterministic-only view.',
            watch_out:
                'Prompt templates live in prompts.ts and must stay under 6K tokens. The LLM response is validated against the Tour schema — malformed responses are retried once, then fall back to a minimal tour rather than crashing.',
            files: ['src/ai/tourGenerator.ts', 'src/ai/prompts.ts', 'src/ai/GroqProvider.ts'],
            highlights: [
                { file: 'src/ai/tourGenerator.ts', lines: [...TOUR_GENERATOR_HIGHLIGHT] },
                { file: 'src/ai/prompts.ts', lines: [...PROMPTS_HIGHLIGHT] },
            ],
            relationships: [
                { from: 'src/ai/tourGenerator.ts', to: 'src/ai/prompts.ts', type: 'uses' },
                { from: 'src/ai/tourGenerator.ts', to: 'src/ai/GroqProvider.ts', type: 'uses' },
            ],
        },
        {
            order: 3,
            title: 'Webview Bridge — webviewProvider.ts',
            what_it_does:
                'The WebviewProvider creates and manages the VS Code WebView panel. It orchestrates the full generate-and-show flow, relays progress messages (tourGenerating), streams the finished tour (tourGenerated), and handles messages back from the React app (openFile, loadTour, deleteTour).',
            why_it_matters:
                'This is the boundary between the VS Code extension host and the React UI. All communication goes through a postMessage protocol defined in shared/types.ts — keeping the UI decoupled from VS Code internals.',
            watch_out:
                'The Content Security Policy in getWebviewContent() only allows scripts with a nonce. Inline scripts will be blocked. The React app is built into dist/webview/ — the webview serves static assets from there.',
            files: ['src/webview/webviewProvider.ts', 'shared/types.ts'],
            highlights: [
                { file: 'src/webview/webviewProvider.ts', lines: [...WEBVIEW_PROVIDER_HIGHLIGHT] },
                { file: 'shared/types.ts', lines: [...SHARED_TYPES_HIGHLIGHT] },
            ],
            relationships: [
                { from: 'src/webview/webviewProvider.ts', to: 'shared/types.ts', type: 'uses' },
                { from: 'src/webview/webviewProvider.ts', to: 'src/ai/tourGenerator.ts', type: 'calls' },
                { from: 'src/webview/webviewProvider.ts', to: 'src/analyzers/index.ts', type: 'calls' },
            ],
        },
        {
            order: 4,
            title: 'React UI — App.tsx + SigmaGraph.tsx',
            what_it_does:
                'The webview app renders three states: empty (no tour yet, with QueryBar to request one), loading (animated progress stages), and tour view (Sigma dependency graph + StepPanel side-by-side). Single-clicking a graph node highlights dependency context and syncs the relevant step; double-click opens the file in the editor.',
            why_it_matters:
                'The UI is what users actually see. The graph makes module relationships spatial and scannable. The step panel turns raw analysis into a narrative. Both must work within VS Code\'s theming constraints — only CSS custom properties from VS Code color tokens are used.',
            watch_out:
                'The webview has no direct filesystem access — everything goes through postMessage. File opens, tour loads, and new requests all round-trip through the extension host.',
            files: ['webview/src/App.tsx', 'webview/src/components/SigmaGraph.tsx', 'webview/src/components/StepPanel.tsx'],
            highlights: [
                { file: 'webview/src/App.tsx', lines: [...APP_HIGHLIGHT] },
                { file: 'webview/src/components/SigmaGraph.tsx', lines: [...SIGMA_GRAPH_HIGHLIGHT] },
            ],
            relationships: [
                { from: 'webview/src/App.tsx', to: 'webview/src/components/SigmaGraph.tsx', type: 'uses' },
                { from: 'webview/src/App.tsx', to: 'webview/src/components/StepPanel.tsx', type: 'uses' },
            ],
        },
    ],
};
