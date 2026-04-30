import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { EmptyStateView } from './EmptyStateView';
import type { AnalysisReport, AppConfig, TourType } from '../types';

function renderEmptyState(config: AppConfig, report: AnalysisReport | null = null): string {
    return renderToStaticMarkup(
        <EmptyStateView
            report={report}
            gitState={null}
            appConfig={config}
            savedTours={[]}
            onRequestTour={(_query: string, _tourType: TourType) => {}}
            onOpenSettings={vi.fn()}
            onLoadSampleTour={vi.fn()}
            onLoadTour={vi.fn()}
            onDeleteTour={vi.fn()}
        />
    );
}

function makeReport(): AnalysisReport {
    return {
        indexTier: 1,
        frameworks: [],
        metrics: { totalFiles: 250, totalLines: 1000 },
        dependencyGraph: { edges: Array.from({ length: 480 }, (_, index) => ({ source: `a${index}`, target: `b${index}` })) },
        completeness: {
            analysisScope: 'interactive',
            analyzedFileCount: 250,
            graphNodeCount: 200,
            graphEdgeCount: 480,
            graphSampleLimit: 200,
            analysisCoverage: 'sampled',
            graphCoverage: 'sampled',
        },
    } as AnalysisReport;
}

describe('EmptyStateView demo mode gating', () => {
    it('shows sample tour controls in demo mode', () => {
        const html = renderEmptyState({ demoMode: true });
        expect(html).toContain('Load Sample Tour');
        expect(html).toContain('Demo Mode');
    });

    it('hides sample tour controls outside demo mode', () => {
        const html = renderEmptyState({ demoMode: false });
        expect(html).not.toContain('Load Sample Tour');
        expect(html).not.toContain('Demo Mode');
        expect(html).toContain('Open RepoNav Settings');
    });

    it('labels sampled interactive analysis as an overview instead of a complete graph', () => {
        const html = renderEmptyState({ demoMode: false }, makeReport());

        expect(html).toContain('250 files analyzed (interactive scope)');
        expect(html).toContain('480 dependency edges in sampled overview');
        expect(html).toContain('Sampled interactive overview');
    });

    it('renders title, body, and primary query action before secondary actions', () => {
        const html = renderEmptyState({ demoMode: false }, makeReport());

        expect(html.indexOf('Generate your next architecture tour')).toBeGreaterThan(-1);
        expect(html.indexOf('Ask a question or choose a preset to explore the workspace.')).toBeGreaterThan(html.indexOf('Generate your next architecture tour'));
        expect(html.indexOf('Generate Tour →')).toBeGreaterThan(html.indexOf('Ask a question or choose a preset to explore the workspace.'));
        expect(html.indexOf('Open RepoNav Settings')).toBeGreaterThan(html.indexOf('Generate Tour →'));
    });
});
