import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { LoadingStateView } from './LoadingStateView';
import type { AnalysisReport } from '../types';

const REPORT_FIXTURE: AnalysisReport = {
    indexTier: 1,
    frameworks: [{ name: 'react', type: 'frontend' }],
    metrics: {
        totalFiles: 12,
        totalLines: 1200,
    },
    dependencyGraph: {
        edges: [{ source: 'src/main.ts', target: 'src/App.tsx' }],
    },
};

describe('LoadingStateView variants', () => {
    it('renders dependency stage as active for graph status', () => {
        const html = renderToStaticMarkup(
            <LoadingStateView
                status="Building dependency graph..."
                report={null}
                gitState={null}
            />
        );

        expect(html).toContain('●');
        expect(html).toContain('Building dependency graph');
    });

    it('renders analysis summary when report is available', () => {
        const html = renderToStaticMarkup(
            <LoadingStateView
                status="Scanning workspace..."
                report={REPORT_FIXTURE}
                gitState={{ branch: 'main', changes: [] }}
            />
        );

        expect(html).toContain('12 files');
        expect(html).toContain('react');
        expect(html).toContain('1 imports');
        expect(html).toContain('loading-git');
        expect(html).toContain('main');
    });

    it('renders title before explanatory body copy', () => {
        const html = renderToStaticMarkup(
            <LoadingStateView
                status="Scanning workspace..."
                report={REPORT_FIXTURE}
                gitState={null}
            />
        );

        expect(html.indexOf('Generating Tour')).toBeGreaterThan(-1);
        expect(html.indexOf('RepoNav is analyzing the workspace and preparing your next action.')).toBeGreaterThan(html.indexOf('Generating Tour'));
    });
});
