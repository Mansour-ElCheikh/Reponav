/** @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StepPanel } from './StepPanel';
import type { Tour } from '../types';

afterEach(() => {
    cleanup();
});

const tour: Tour = {
    id: 'tour-step',
    query: 'onboarding',
    tourType: 'onboarding',
    createdAt: new Date().toISOString(),
    analysisSnapshot: {
        frameworks: ['react'],
        entryPoints: ['src/main.tsx'],
        totalFiles: 3,
        totalEdges: 2,
    },
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
    graph: { nodes: [], edges: [] },
};

const sampledTour: Tour = {
    ...tour,
    analysisSnapshot: {
        frameworks: ['react'],
        entryPoints: ['src/main.tsx'],
        totalFiles: 2316,
        totalEdges: 1507,
        circularCount: 0,
        completeness: {
            analysisScope: 'interactive',
            analyzedFileCount: 2316,
            graphNodeCount: 560,
            graphEdgeCount: 624,
            graphSampleLimit: 560,
            analysisCoverage: 'sampled',
            graphCoverage: 'sampled',
        },
    },
};

const longTitleTour: Tour = {
    ...tour,
    steps: [
        {
            ...tour.steps[0],
            title: 'This is a deliberately long navigation title for sidebar truncation verification',
            files: ['src/features/deeply/nested/example/path/that/should/not/overflow/sidebar/rendering/component/file.tsx'],
        },
        tour.steps[1],
    ],
};

describe('StepPanel smoke', () => {
    it('renders current step content and navigation labels', () => {
        render(
            <StepPanel
                tour={tour}
                currentStep={0}
                onStepChange={vi.fn()}
                onFileClick={vi.fn()}
            />
        );

        expect(screen.getByText('Step 1 of 2')).toBeTruthy();
        expect(screen.getByRole('heading', { level: 2, name: 'Boot' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Next →' })).toBeTruthy();
    });

    it('fires onStepChange when selecting a different step and when clicking Next', async () => {
        const user = userEvent.setup();
        const onStepChange = vi.fn();

        render(
            <StepPanel
                tour={tour}
                currentStep={0}
                onStepChange={onStepChange}
                onFileClick={vi.fn()}
            />
        );

        await user.click(screen.getByRole('button', { name: /route/i }));
        await user.click(screen.getByRole('button', { name: 'Next →' }));

        expect(onStepChange).toHaveBeenCalledWith(1);
    });

    it('keeps story-mode navigation within the valid step range', async () => {
        const user = userEvent.setup();
        const onStepChange = vi.fn();

        const { rerender } = render(
            <StepPanel
                tour={tour}
                currentStep={0}
                onStepChange={onStepChange}
                onFileClick={vi.fn()}
                workspaceMode="story"
            />
        );

        expect(screen.getByRole('button', { name: '← Previous' })).toBeDisabled();
        await user.click(screen.getByRole('button', { name: 'Next →' }));
        expect(onStepChange).toHaveBeenCalledWith(1);

        rerender(
            <StepPanel
                tour={tour}
                currentStep={1}
                onStepChange={onStepChange}
                onFileClick={vi.fn()}
                workspaceMode="story"
            />
        );

        expect(screen.getByRole('button', { name: 'Next →' })).toBeDisabled();
        await user.click(screen.getByRole('button', { name: '← Previous' }));
        expect(onStepChange).toHaveBeenCalledWith(0);
    });

    it('fires onFileClick when file link is clicked', async () => {
        const user = userEvent.setup();
        const onFileClick = vi.fn();

        render(
            <StepPanel
                tour={tour}
                currentStep={0}
                onStepChange={vi.fn()}
                onFileClick={onFileClick}
            />
        );

        await user.click(screen.getByRole('button', { name: /src\/main.tsx/i }));
        expect(onFileClick).toHaveBeenCalledWith('src/main.tsx');
    });

    it('shows "N / ?" badge when isTourStreaming is true', () => {
        render(
            <StepPanel
                tour={{
                    ...tour,
                    steps: [tour.steps[0], tour.steps[1]],
                }}
                currentStep={0}
                onStepChange={vi.fn()}
                onFileClick={vi.fn()}
                isTourStreaming={true}
            />
        );

        // Streaming: show current count with "?"
        expect(screen.getByText('2 / ?')).toBeTruthy();
    });

    it('shows "N / N" badge when isTourStreaming is false', () => {
        render(
            <StepPanel
                tour={{
                    ...tour,
                    steps: [tour.steps[0], tour.steps[1]],
                }}
                currentStep={0}
                onStepChange={vi.fn()}
                onFileClick={vi.fn()}
                isTourStreaming={false}
            />
        );

        // Not streaming: show total/total
        expect(screen.getByText('2 / 2')).toBeTruthy();
    });

    it('shows a loading placeholder while the graph is visible but steps are still streaming', () => {
        render(
            <StepPanel
                tour={{
                    ...tour,
                    steps: [],
                }}
                currentStep={0}
                onStepChange={vi.fn()}
                onFileClick={vi.fn()}
                isTourStreaming={true}
            />
        );

        expect(screen.getByText('Preparing tour steps')).toBeTruthy();
        expect(screen.getByText('Analysis is complete. Waiting for narrated steps to stream in.')).toBeTruthy();
    });

    it('explains analyzed totals separately from sampled graph counts', () => {
        render(
            <StepPanel
                tour={sampledTour}
                currentStep={0}
                onStepChange={vi.fn()}
                onFileClick={vi.fn()}
            />
        );

        expect(screen.getByText('2316 files analyzed')).toBeTruthy();
        expect(screen.getByText('1507 deps mapped')).toBeTruthy();
        expect(screen.getByText('Interactive overview shows 560 modules and 624 dependencies.')).toBeTruthy();
    });

    it('renders header, step list, current step content, and file links as distinct sidebar regions', () => {
        render(
            <StepPanel
                tour={tour}
                currentStep={0}
                onStepChange={vi.fn()}
                onFileClick={vi.fn()}
            />
        );

        expect(screen.getByTestId('sidebar-region-header')).toBeTruthy();
        expect(screen.getByTestId('sidebar-region-step-list')).toBeTruthy();
        expect(screen.getByTestId('sidebar-region-current-step')).toBeTruthy();
        expect(screen.getByTestId('sidebar-region-files')).toBeTruthy();
    });

    it('does not duplicate the tour query as a sidebar header title', () => {
        render(
            <StepPanel
                tour={tour}
                currentStep={0}
                onStepChange={vi.fn()}
                onFileClick={vi.fn()}
            />
        );

        expect(screen.queryByRole('heading', { level: 3, name: tour.query })).toBeNull();
    });

    it('adds divider and spacing hooks between adjacent sidebar regions', () => {
        render(
            <StepPanel
                tour={tour}
                currentStep={0}
                onStepChange={vi.fn()}
                onFileClick={vi.fn()}
            />
        );

        expect(screen.getByTestId('sidebar-region-step-list')).toHaveStyle({ borderTop: '1px solid var(--border-color)', paddingTop: '12px' });
        expect(screen.getByTestId('sidebar-region-current-step')).toHaveStyle({ borderTop: '1px solid var(--border-color)', paddingTop: '12px' });
        expect(screen.getByTestId('sidebar-region-files')).toHaveStyle({ borderTop: '1px solid var(--border-color)', paddingTop: '12px' });
    });

    it('uses exact opacity values for active, visited, and inactive step rows', () => {
        const { rerender } = render(
            <StepPanel
                tour={tour}
                currentStep={1}
                onStepChange={vi.fn()}
                onFileClick={vi.fn()}
            />
        );

        expect(screen.getByTestId('step-nav-item-1')).toHaveStyle({ opacity: '1' });
        expect(screen.getByTestId('step-nav-item-0')).toHaveStyle({ opacity: '0.75' });

        rerender(
            <StepPanel
                tour={{ ...tour, steps: [...tour.steps, { ...tour.steps[1], order: 3, title: 'Inspect', files: ['src/inspect.ts'] }] }}
                currentStep={1}
                onStepChange={vi.fn()}
                onFileClick={vi.fn()}
            />
        );

        expect(screen.getByTestId('step-nav-item-2')).toHaveStyle({ opacity: '0.55' });
    });

    it('keeps at least 45 visible characters before ellipsis for long step titles', () => {
        render(
            <StepPanel
                tour={longTitleTour}
                currentStep={0}
                onStepChange={vi.fn()}
                onFileClick={vi.fn()}
            />
        );

        expect(screen.getByTestId('step-nav-title-0')).toHaveTextContent('This is a deliberately long navigation title fo…');
    });

    it('truncates only trailing overflow in step titles', () => {
        render(
            <StepPanel
                tour={longTitleTour}
                currentStep={0}
                onStepChange={vi.fn()}
                onFileClick={vi.fn()}
            />
        );

        expect(screen.getByTestId('step-nav-title-0').textContent?.startsWith('This is a deliberately')).toBe(true);
        expect(screen.getByTestId('step-nav-title-0')).toHaveTextContent('…');
    });

    it('keeps file paths on one ellipsized line without horizontal overflow', () => {
        render(
            <StepPanel
                tour={longTitleTour}
                currentStep={0}
                onStepChange={vi.fn()}
                onFileClick={vi.fn()}
            />
        );

        expect(screen.getByTestId('file-path-0')).toHaveStyle({ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' });
    });

    it('keeps navigation buttons at least 32px tall and aligned even when disabled', () => {
        render(
            <StepPanel
                tour={tour}
                currentStep={0}
                onStepChange={vi.fn()}
                onFileClick={vi.fn()}
            />
        );

        expect(screen.getByRole('button', { name: '← Previous' })).toHaveStyle({ minHeight: '32px' });
        expect(screen.getByRole('button', { name: 'Next →' })).toHaveStyle({ minHeight: '32px' });
        expect(screen.getByTestId('step-controls')).toHaveStyle({ alignItems: 'center' });
    });
});
