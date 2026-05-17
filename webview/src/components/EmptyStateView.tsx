import { BookOpen, Compass, GitBranch, Search } from 'lucide-react';
import type { GitState, TourSummary } from '../hooks/useRepoNavState';
import type { AnalysisReport, AppConfig, TourType } from '../types';
import { QueryBar } from './QueryBar';
import './EmptyStateView.css';

interface EmptyStateViewProps {
    report: AnalysisReport | null;
    gitState: GitState | null;
    appConfig: AppConfig;
    savedTours: TourSummary[];
    onRequestTour: (query: string, tourType: TourType) => void;
    onOpenSettings: () => void;
    onLoadSampleTour: () => void;
    onLoadTour: (tourId: string) => void;
    onDeleteTour: (tourId: string) => void;
}

/** Renders the pre-tour empty state with quick-start actions and saved tours. */
export function EmptyStateView({
    report,
    gitState,
    appConfig,
    savedTours,
    onRequestTour,
    onOpenSettings,
    onLoadSampleTour,
    onLoadTour,
    onDeleteTour,
}: EmptyStateViewProps) {
    const scopeLine = report?.completeness
        ? `${report.completeness.analyzedFileCount} files analyzed (${report.completeness.analysisScope} scope)`
        : `${report?.metrics.totalFiles ?? 0} files indexed`;
    const dependencyLine = report?.completeness?.graphCoverage === 'sampled'
        ? `${report.completeness.graphEdgeCount} dependency edges in sampled overview`
        : `${report?.dependencyGraph.edges.length ?? 0} dependency edges mapped`;
    const terminalLines = report
        ? [
            '$ reponav analyze .',
            `→ ${scopeLine}`,
            `→ ${dependencyLine}`,
            '→ Ready. Ask anything below ✓',
        ]
        : [
            '$ reponav analyze .',
            '→ Scanning workspace...',
            '→ Building dependency graph',
            '→ Ready. Ask anything below ✓',
        ];

    return (
        <div className="app empty-state">
            <div className="empty-container">
                <div className="empty-icon" aria-hidden="true">
                    <Compass size={44} strokeWidth={2.4} />
                </div>
                <h1 className="empty-title">Generate your next architecture tour</h1>
                <p className="empty-body">Ask a question or choose a preset to explore the workspace.</p>
                <div className="terminal-block" aria-label="RepoNav startup preview">
                    <div className="terminal-bar">
                        <span className="terminal-dot red" />
                        <span className="terminal-dot amber" />
                        <span className="terminal-dot green" />
                        <span className="terminal-label">reponav</span>
                    </div>
                    <div className="terminal-body">
                        {terminalLines.map((line, index) => (
                            <div
                                key={line}
                                className={`terminal-line line-${index + 1}`}
                            >
                                {line}
                            </div>
                        ))}
                    </div>
                </div>
                {report && (
                    <div className="analysis-summary">
                        <span>{report.completeness?.analyzedFileCount ?? report.metrics.totalFiles} files</span>
                        <span>•</span>
                        <span>
                            {report.completeness?.graphCoverage === 'sampled'
                                ? 'sampled overview'
                                : `${report.dependencyGraph.edges.length} dependencies`}
                        </span>
                        <span>•</span>
                        <span>{report.frameworks.map((f) => f.name).join(', ') || 'Unknown stack'}</span>
                    </div>
                )}
                {gitState?.branch && (
                    <div className="git-info">
                        <span className="git-branch">
                            <GitBranch className="inline-icon" aria-hidden="true" />
                            {gitState.branch}
                        </span>
                        {gitState.changes.length > 0 && (
                            <span className="git-changes">{gitState.changes.length} changes</span>
                        )}
                    </div>
                )}
                <QueryBar onSubmit={onRequestTour} />
                {!appConfig.demoMode && (
                    <button className="btn-secondary" onClick={onOpenSettings}>
                        Open RepoNav Settings
                    </button>
                )}
                {appConfig.demoMode && (
                    <div className="demo-mode-controls">
                        <span className="demo-badge">Demo Mode</span>
                        <button className="btn-sample-tour" onClick={onLoadSampleTour}>
                            Load Sample Tour
                        </button>
                    </div>
                )}
                {savedTours.length > 0 && (
                    <div className="saved-tours">
                        <h3>Saved Tours</h3>
                        <div className="saved-tours-list">
                            {savedTours.map((t) => (
                                <div key={t.id} className="saved-tour-item">
                                    <button className="saved-tour-load" onClick={() => onLoadTour(t.id)}>
                                        <span className="saved-tour-type">{t.tourType}</span>
                                        <span className="saved-tour-query">{t.query}</span>
                                        <span className="saved-tour-meta">
                                            {t.stepCount} steps • {new Date(t.createdAt).toLocaleDateString()}
                                        </span>
                                    </button>
                                    <button
                                        className="saved-tour-delete"
                                        onClick={() => onDeleteTour(t.id)}
                                        title="Delete tour"
                                    >
                                        ✕
                                    </button>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
                {savedTours.length === 0 && (
                    <div className="tour-preview">
                        <h3>What you&apos;ll get</h3>
                        <div className="preview-features">
                            <div className="preview-feature">
                                <GitBranch className="preview-feature-icon" aria-hidden="true" />
                                <div>
                                    <strong>Sampled interactive overview</strong>
                                    <span>Curated structural slice of how your modules connect</span>
                                </div>
                            </div>
                            <div className="preview-feature">
                                <BookOpen className="preview-feature-icon" aria-hidden="true" />
                                <div>
                                    <strong>Step-by-step walkthrough</strong>
                                    <span>Guided tour through the architecture</span>
                                </div>
                            </div>
                            <div className="preview-feature">
                                <Search className="preview-feature-icon" aria-hidden="true" />
                                <div>
                                    <strong>Real file references</strong>
                                    <span>Click any file to open it in the editor</span>
                                </div>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
