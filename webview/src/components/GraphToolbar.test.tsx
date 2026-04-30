/** @vitest-environment jsdom */

/**
 * GraphToolbar tests — flow count badge (epic 008 component 001).
 */
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GraphToolbar } from './GraphToolbar';
import type { Filters } from './sigmaGraphHelpers';

const DISABLED_FILTER_OPACITY = '0.4';

afterEach(() => {
    cleanup();
});

const baseFilters: Filters = { showTestFiles: true, showCircularOnly: false, groupDirs: false };

const baseProps = {
    hasTestNodes: false,
    hasCircularEdges: false,
    filters: baseFilters,
    onFiltersChange: vi.fn(),
    setExpandedClusters: vi.fn(),
    setSelectedNodeId: vi.fn(),
    deadCodeFiles: [],
    showDeadCode: false,
    onShowDeadCodeChange: vi.fn(),
    couplingPairs: [],
    showCouplingEdges: false,
    onShowCouplingEdgesChange: vi.fn(),
    toolingFlowCount: 0,
    showFlowEdges: false,
    onShowFlowEdgesChange: vi.fn(),
};

describe('GraphToolbar — flow count badge', () => {
    it('renders a compact Graph tools trigger before the full HUD is expanded', () => {
        render(<GraphToolbar {...baseProps} flows={[]} />);

        expect(screen.getByRole('button', { name: 'Graph tools' })).toBeTruthy();
        expect(screen.queryByTestId('graph-hud-group-visibility')).toBeNull();
    });

    it('renders visibility, layout, and analysis controls as separate labeled groups', () => {
        const user = userEvent.setup();
        render(<GraphToolbar {...baseProps} flows={[]} />);

        return user.click(screen.getByRole('button', { name: 'Graph tools' })).then(() => {
            expect(screen.getByTestId('graph-hud-group-visibility')).toBeTruthy();
            expect(screen.getByTestId('graph-hud-group-layout')).toBeTruthy();
            expect(screen.getByTestId('graph-hud-group-analysis')).toBeTruthy();
            expect(screen.getByText('Visibility')).toBeTruthy();
            expect(screen.getByText('Layout')).toBeTruthy();
            expect(screen.getByText('Analysis')).toBeTruthy();
        });
    });

    it('renders visibility and analysis controls as chips and layout controls as segments', () => {
        const user = userEvent.setup();
        const flows = [{ entryPoint: 'a.ts', steps: [], anomalies: [] }];
        render(<GraphToolbar {...baseProps} hasTestNodes={true} hasCircularEdges={true} flows={flows} showFlowEdges={true} />);
        return user.click(screen.getByRole('button', { name: 'Graph tools' })).then(() => {
            expect(screen.getByTestId('visibility-control-show-tests')).toHaveClass('graph-toolbar-control--chip');
            expect(screen.getByTestId('analysis-control-flow-edges')).toHaveClass('graph-toolbar-control--chip');
            expect(screen.getByTestId('layout-control-group-dirs')).toHaveClass('graph-toolbar-control--segment');
        });
    });

    it('preserves toggle behavior and checked state in grouped controls', async () => {
        const user = userEvent.setup();
        const onFiltersChange = vi.fn();
        render(<GraphToolbar {...baseProps} hasTestNodes={true} flows={[]} onFiltersChange={onFiltersChange} />);
        await user.click(screen.getByRole('button', { name: 'Graph tools' }));

        const showTests = screen.getByTestId('visibility-control-show-tests');
        expect(showTests).toHaveAttribute('aria-pressed', 'true');
        await user.click(showTests);
        expect(onFiltersChange).toHaveBeenCalledWith({ ...baseFilters, showTestFiles: false });
    });

    it('surfaces disabled-state explanations on unavailable controls', () => {
        const user = userEvent.setup();
        render(<GraphToolbar {...baseProps} flows={[]} />);
        return user.click(screen.getByRole('button', { name: 'Graph tools' })).then(() => {
            expect(screen.getByTestId('visibility-control-show-tests')).toHaveAttribute('title', 'No test files in this graph');
            expect(screen.getByTestId('analysis-control-flow-edges')).toHaveAttribute('title', 'No flow sequences in this graph');
        });
    });

    it('T01: badge shows count when flows.length > 0', () => {
        const user = userEvent.setup();
        const flows = [
            { entryPoint: 'a.ts', steps: [], anomalies: [] },
            { entryPoint: 'b.ts', steps: [], anomalies: [] },
        ];
        render(<GraphToolbar {...baseProps} flows={flows} />);
        return user.click(screen.getByRole('button', { name: 'Graph tools' })).then(() => {
            expect(screen.getByTestId('analysis-control-flow-edges')).toHaveTextContent('(2)');
        });
    });

    it('T02: no badge when flows is empty', () => {
        const user = userEvent.setup();
        render(<GraphToolbar {...baseProps} flows={[]} />);
        return user.click(screen.getByRole('button', { name: 'Graph tools' })).then(() => {
            expect(screen.getByTestId('analysis-control-flow-edges').textContent).not.toContain('(');
        });
    });

    it('T03: label surfaces hidden tooling flows separately from runtime flow edges', () => {
        const user = userEvent.setup();
        const flows = [
            { entryPoint: 'src/routes/a.ts', steps: [], anomalies: [] },
            { entryPoint: 'src/routes/b.ts', steps: [], anomalies: [] },
        ];
        render(<GraphToolbar {...baseProps} flows={flows} toolingFlowCount={2} />);
        return user.click(screen.getByRole('button', { name: 'Graph tools' })).then(() => {
            expect(screen.getByTestId('analysis-control-flow-edges')).toHaveTextContent('Flow edges (2)');
            expect(screen.getByTestId('analysis-control-flow-edges')).toHaveTextContent('2 tooling hidden');
        });
    });

    it('T04: disabled flow toggle keeps the reduced disabled opacity', () => {
        const user = userEvent.setup();
        render(<GraphToolbar {...baseProps} flows={[]} />);
        return user.click(screen.getByRole('button', { name: 'Graph tools' })).then(() => {
            expect(screen.getByTestId('analysis-control-flow-edges')).toHaveStyle({ opacity: DISABLED_FILTER_OPACITY });
        });
    });

    it('disables Flow edges while Circular only is active', async () => {
        const user = userEvent.setup();
        const flows = [{ entryPoint: 'a.ts', steps: [], anomalies: [] }];
        render(<GraphToolbar {...baseProps} hasCircularEdges={true} flows={flows} filters={{ ...baseFilters, showCircularOnly: true }} showFlowEdges={false} />);

        await user.click(screen.getByRole('button', { name: 'Graph tools' }));

        expect(screen.getByTestId('analysis-control-flow-edges')).toBeDisabled();
        expect(screen.getByTestId('analysis-control-flow-edges')).toHaveAttribute('title', 'Flow edges are unavailable while Circular only is active');
    });
});

