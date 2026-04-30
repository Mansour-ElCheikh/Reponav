/** @vitest-environment jsdom */

import React, { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import type { AnalysisReport, Tour } from './types';

const GRAPH_NODE_COUNT = 200;

const mockUseRepoNavState = vi.fn();
const stepPanelPropsSpy = vi.fn();
const sigmaGraphPropsSpy = vi.fn();
let stateOverrides: Record<string, unknown> = {};

vi.mock('./hooks/useRepoNavState', () => ({
    useRepoNavState: () => mockUseRepoNavState(),
}));

vi.mock('./components/SigmaGraph', () => ({
    SigmaGraph: () => {
        const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
        const [activeFilterCount, setActiveFilterCount] = useState(0);
        sigmaGraphPropsSpy({ selectedNodeId, activeFilterCount });

        return (
            <div data-testid="sigma-graph">
                <div data-testid="sigma-selected-node">{selectedNodeId ?? 'none'}</div>
                <div data-testid="sigma-filter-count">{activeFilterCount}</div>
                <button>graph tools</button>
                <button onClick={() => setSelectedNodeId('src/node.ts')}>select graph node</button>
                <button onClick={() => setActiveFilterCount((count) => count + 1)}>toggle graph filter</button>
            </div>
        );
    },
}));

vi.mock('./components/StepPanel', () => ({
    StepPanel: ({ currentStep, onStepChange, isTourStreaming, onOpenStepWiz }: { currentStep: number; onStepChange: (step: number) => void; isTourStreaming?: boolean; onOpenStepWiz?: (context: string) => void }) => {
        stepPanelPropsSpy({ currentStep, isTourStreaming });

        return (
            <div data-testid="step-panel">
                <div data-testid="step-panel-current-step">{currentStep}</div>
                <div data-testid="step-panel-streaming">{String(Boolean(isTourStreaming))}</div>
                <button onClick={() => onStepChange(Math.max(0, currentStep - 1))}>mock previous</button>
                <button onClick={() => onStepChange(Math.min(1, currentStep + 1))}>mock next</button>
                <button onClick={() => onOpenStepWiz?.(`Current step: ${currentStep === 0 ? 'Boot' : 'Route'}`)}>open step wiz</button>
            </div>
        );
    },
}));

vi.mock('./components/LoadingStateView', () => ({
    LoadingStateView: () => <div>loading-state</div>,
}));

vi.mock('./components/ErrorStateView', () => ({
    ErrorStateView: () => <div>error-state</div>,
}));

vi.mock('./components/EmptyStateView', () => ({
    EmptyStateView: () => <div>empty-state</div>,
}));

vi.mock('./utils/sampleTour', () => ({
    SAMPLE_TOUR: null,
}));

vi.mock('./vscodeApi', () => ({
    webviewLog: vi.fn(),
    vscodeApi: { postMessage: vi.fn() },
}));

function makeTour(): Tour {
    return {
        id: 'tour-1',
        query: 'Dependency Graph',
        tourType: 'dependency-audit',
        steps: [
            {
                order: 1,
                title: 'Boot',
                what_it_does: 'Bootstraps app',
                why_it_matters: 'Starts runtime',
                watch_out: 'No major gotchas here.',
                files: ['src/main.tsx'],
                highlights: [],
                relationships: [],
            },
            {
                order: 2,
                title: 'Route',
                what_it_does: 'Handles routing',
                why_it_matters: 'Navigation flow',
                watch_out: 'Watch route ordering.',
                files: ['src/routes.tsx'],
                highlights: [],
                relationships: [],
            },
        ],
        graph: {
            nodes: Array.from({ length: GRAPH_NODE_COUNT }, (_, index) => ({
                id: `src/file${index}.ts`,
                label: `file${index}.ts`,
                type: 'unknown',
            })),
            edges: Array.from({ length: 480 }, (_, index) => ({
                source: `src/file${index % GRAPH_NODE_COUNT}.ts`,
                target: `src/file${(index + 1) % GRAPH_NODE_COUNT}.ts`,
                label: 'imports',
            })),
        },
        analysisSnapshot: {
            frameworks: [],
            entryPoints: [],
            totalFiles: 250,
            totalEdges: 480,
            circularCount: 0,
            completeness: {
                analysisScope: 'interactive',
                analyzedFileCount: 250,
                graphNodeCount: GRAPH_NODE_COUNT,
                graphEdgeCount: 480,
                graphSampleLimit: GRAPH_NODE_COUNT,
                analysisCoverage: 'sampled',
                graphCoverage: 'sampled',
            },
        },
        createdAt: new Date().toISOString(),
    };
}

function makeReport(): AnalysisReport {
    return {
        indexTier: 1,
        frameworks: [],
        metrics: { totalFiles: 250, totalLines: 1000 },
        dependencyGraph: { edges: [] },
        completeness: {
            analysisScope: 'interactive',
            analyzedFileCount: 250,
            graphNodeCount: GRAPH_NODE_COUNT,
            graphEdgeCount: 480,
            graphSampleLimit: GRAPH_NODE_COUNT,
            analysisCoverage: 'sampled',
            graphCoverage: 'sampled',
        },
    } as AnalysisReport;
}

describe('App sampled graph labels', () => {
    beforeEach(() => {
        stateOverrides = {};
        stepPanelPropsSpy.mockClear();
        sigmaGraphPropsSpy.mockClear();
        mockUseRepoNavState.mockImplementation(() => {
            const [currentStep, setCurrentStep] = useState(0);

            return {
                tour: makeTour(),
                report: makeReport(),
                currentStep,
                status: '',
                error: '',
                isGenerating: false,
                savedTours: [],
                gitState: null,
                lastQuery: '',
                appConfig: { demoMode: false },
                isTourStreaming: false,
                streamingSteps: [],
                setTour: vi.fn(),
                setError: vi.fn(),
                setCurrentStep,
                requestTour: vi.fn(),
                retryLastTour: vi.fn(),
                resetTour: vi.fn(),
                selectGraphNode: vi.fn(),
                openGraphNodeFile: vi.fn(),
                openFile: vi.fn(),
                openSettings: vi.fn(),
                loadTour: vi.fn(),
                deleteTour: vi.fn(),
                analyzerReply: null,
                setAnalyzerReply: vi.fn(),
                analyzerError: '',
                setAnalyzerError: vi.fn(),
                ...stateOverrides,
            };
        });
    });

    it('labels sampled tour graphs as an overview and marks visible counts as shown', () => {
        const html = renderToStaticMarkup(<App />);

        expect(html).toContain('Sampled interactive overview');
        expect(html).toContain('200 / 250 modules shown');
        expect(html).toContain('480 / 480 dependencies shown');
    });

    it('renders a single workspace without public mode buttons', () => {
        render(<App />);

        expect(screen.queryByRole('button', { name: /story mode/i })).toBeNull();
        expect(screen.queryByRole('button', { name: /analyst mode/i })).toBeNull();
        expect(screen.getByRole('button', { name: 'graph tools' })).toBeTruthy();
    });

    it('preserves selected step, selected node, and active filters in the single workspace', async () => {
        const user = userEvent.setup();

        render(<App />);
        await user.click(screen.getByRole('button', { name: 'mock next' }));
        await user.click(screen.getByRole('button', { name: 'select graph node' }));
        await user.click(screen.getByRole('button', { name: 'toggle graph filter' }));

        expect(screen.getByTestId('step-panel-current-step')).toHaveTextContent('1');
        expect(screen.getByTestId('sigma-selected-node')).toHaveTextContent('src/node.ts');
        expect(screen.getByTestId('sigma-filter-count')).toHaveTextContent('1');
    });

    it('preserves streaming state in the single workspace', () => {
        stateOverrides = { isTourStreaming: true };

        render(<App />);
        expect(screen.getByTestId('step-panel-streaming')).toHaveTextContent('true');
    });

    it('preserves a pending Wiz request while interacting with the graph', async () => {
        const user = userEvent.setup();

        render(<App />);
        await user.click(screen.getByRole('button', { name: /open reponav wiz/i }));
        await user.type(screen.getByRole('textbox', { name: /reponav wiz input/i }), 'Summarize the current step');
        await user.click(screen.getByRole('button', { name: 'Send' }));

        expect(screen.getByRole('textbox', { name: /reponav wiz input/i })).toHaveAttribute('placeholder', 'Thinking…');

        await user.click(screen.getByRole('button', { name: 'select graph node' }));
        await user.click(screen.getByRole('button', { name: 'toggle graph filter' }));

        expect(screen.getByRole('textbox', { name: /reponav wiz input/i })).toHaveAttribute('placeholder', 'Thinking…');
        expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
    });

    it('opens Wiz with visible current-step context from the workspace', async () => {
        const user = userEvent.setup();

        render(<App />);
        await user.click(screen.getByRole('button', { name: 'open step wiz' }));

        expect(screen.getByRole('textbox', { name: /reponav wiz input/i })).toHaveValue('Current step: Boot');
        expect(screen.getByTestId('wiz-context')).toHaveTextContent('Current step: Boot');
    });

    it('keeps pending completion visible after changing step or graph context', async () => {
        const user = userEvent.setup();

        render(<App />);
        await user.click(screen.getByRole('button', { name: 'open step wiz' }));
        await user.click(screen.getByRole('button', { name: 'Send' }));

        stateOverrides = { analyzerReply: 'Completed step answer' };
        await user.click(screen.getByRole('button', { name: 'mock next' }));

        expect(screen.getByText('Completed step answer')).toBeTruthy();
    });

    it('preserves workspace state while a Wiz response is pending and context changes', async () => {
        const user = userEvent.setup();

        render(<App />);
        await user.click(screen.getByRole('button', { name: 'open step wiz' }));
        await user.click(screen.getByRole('button', { name: 'Send' }));
        await user.click(screen.getByRole('button', { name: 'mock next' }));
        await user.click(screen.getByRole('button', { name: 'select graph node' }));
        await user.click(screen.getByRole('button', { name: 'toggle graph filter' }));

        expect(screen.getByTestId('step-panel-current-step')).toHaveTextContent('1');
        expect(screen.getByTestId('sigma-selected-node')).toHaveTextContent('src/node.ts');
        expect(screen.getByTestId('sigma-filter-count')).toHaveTextContent('1');
        expect(screen.getByRole('textbox', { name: /reponav wiz input/i })).toHaveAttribute('placeholder', 'Thinking…');
    });

    it('keeps the fallback Wiz FAB and current-step Wiz affordance without a node Wiz shortcut', () => {
        render(<App />);

        expect(screen.getByRole('button', { name: /open reponav wiz/i })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'open step wiz' })).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'open node wiz' })).toBeNull();
    });

    it('keeps the graph viewport at least 240px wide in the 360px to 599px range', () => {
        window.innerWidth = 480;

        render(<App />);

        expect(screen.getByTestId('tour-layout')).toHaveStyle({ gap: '8px' });
        expect(screen.getByTestId('tour-sidebar')).toHaveStyle({ width: '232px' });
        expect(screen.getByTestId('tour-graph')).toHaveStyle({ minWidth: '240px' });
    });

    it('switches to reachable Graph and Narrative tabs below 360px', async () => {
        const user = userEvent.setup();
        window.innerWidth = 320;

        render(<App />);

        expect(screen.getByRole('tab', { name: 'Narrative' })).toHaveAttribute('aria-selected', 'true');
        expect(screen.getByRole('tab', { name: 'Graph' })).toHaveAttribute('aria-selected', 'false');
        expect(screen.getByTestId('tour-sidebar')).not.toHaveStyle({ display: 'none' });
        expect(screen.getByTestId('tour-graph')).toHaveStyle({ display: 'none' });

        await user.click(screen.getByRole('tab', { name: 'Graph' }));

        expect(screen.getByRole('tab', { name: 'Graph' })).toHaveAttribute('aria-selected', 'true');
        expect(screen.getByTestId('tour-sidebar')).toHaveStyle({ display: 'none' });
        expect(screen.getByTestId('tour-graph')).not.toHaveStyle({ display: 'none' });
    });
});