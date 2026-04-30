import { GitBranch } from 'lucide-react';
import type { AnalysisReport } from '../types';
import type { GitState } from '../hooks/useRepoNavState';
import './LoadingStateView.css';

type LoadingStage = 'scanning' | 'dependencies' | 'generating';

const LOADING_STAGES: { key: LoadingStage; label: string }[] = [
    { key: 'scanning', label: 'Scanning workspace' },
    { key: 'dependencies', label: 'Building dependency graph' },
    { key: 'generating', label: 'Generating tour with AI' },
];

function getStageFromStatus(status: string): LoadingStage {
    if (status.includes('dependency') || status.includes('graph')) return 'dependencies';
    if (status.includes('AI') || status.includes('Generating tour')) return 'generating';
    return 'scanning';
}

interface LoadingStateViewProps {
    status: string;
    report: AnalysisReport | null;
    gitState: GitState | null;
}

/** Renders staged progress while analysis or tour generation is running. */
export function LoadingStateView({ status, report, gitState }: LoadingStateViewProps) {
    const currentStage = getStageFromStatus(status);
    const stageIndex = LOADING_STAGES.findIndex((stage) => stage.key === currentStage);

    return (
        <div className="app loading-state" data-testid="loading-state">
            <div className="loading-container">
                <div className="loading-spinner" />
                <h2>Generating Tour</h2>
                <p className="loading-copy">RepoNav is analyzing the workspace and preparing your next action.</p>
                <div className="loading-stages">
                    {LOADING_STAGES.map((stage, i) => (
                        <div
                            key={stage.key}
                            className={`loading-stage ${i < stageIndex ? 'done' : ''} ${i === stageIndex ? 'active' : ''}`}
                        >
                            <span className="loading-stage-icon">
                                {i < stageIndex ? '\u2713' : i === stageIndex ? '\u25CF' : '\u25CB'}
                            </span>
                            <span>{stage.label}</span>
                        </div>
                    ))}
                </div>
                {report && (
                    <div className="loading-analysis-summary">
                        <span>{report.metrics.totalFiles} files</span>
                        <span>•</span>
                        <span>{report.frameworks.map((f) => f.name).join(', ') || 'Detecting stack...'}</span>
                        {report.dependencyGraph.edges.length > 0 && (
                            <>
                                <span>•</span>
                                <span>{report.dependencyGraph.edges.length} imports</span>
                            </>
                        )}
                        {gitState?.branch && (
                            <>
                                <span>•</span>
                                <span className="loading-git">
                                    <GitBranch className="loading-icon" aria-hidden="true" />
                                    {gitState.branch}
                                </span>
                            </>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
