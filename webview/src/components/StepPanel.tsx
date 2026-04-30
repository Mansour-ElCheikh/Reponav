/**
 * StepPanel — Tour Step Navigation
 *
 * Displays tour steps with structured explanations (what/why/watch_out).
 * Ported from original frontend and adapted for VS Code WebView.
 */

import { useState } from 'react';
import { AlertTriangle, FileText, GitBranch, Info, Layers, Lightbulb } from 'lucide-react';
import type { Tour } from '../types';
import './StepPanel.css';

const NAV_TITLE_VISIBLE_CHAR_COUNT = 47;
const REGION_DIVIDER_STYLE = {
    borderTop: '1px solid var(--border-color)',
    paddingTop: '12px',
} as const;

// Keep long step titles readable in a narrow sidebar by truncating only the trailing overflow.
function getStepNavLabel(title: string): string {
    if (title.length <= NAV_TITLE_VISIBLE_CHAR_COUNT) {
        return title;
    }

    return `${title.slice(0, NAV_TITLE_VISIBLE_CHAR_COUNT)}…`;
}

interface StepPanelProps {
    tour: Tour;
    currentStep: number;
    onStepChange: (step: number) => void;
    onFileClick: (filePath: string, line?: number) => void;
    isTourStreaming?: boolean;
    workspaceMode?: 'story' | 'analyst';
    onOpenStepWiz?: (context: string) => void;
}

/**
 * Renders tour steps with navigation, structured explanations, and a live step count badge.
 * Shows "N / ?" badge while streaming, "N / N" once the tour is complete.
 */
export function StepPanel({
    tour,
    currentStep,
    onStepChange,
    onFileClick,
    isTourStreaming = false,
    workspaceMode = 'story',
    onOpenStepWiz,
}: StepPanelProps) {
    const [expandedSection, setExpandedSection] = useState<string | null>(null);
    const step = tour.steps[currentStep];
    const completeness = tour.analysisSnapshot.completeness;
    const sampledOverview = completeness?.graphCoverage === 'sampled';
    const analyzedFileCount = completeness?.analyzedFileCount ?? tour.analysisSnapshot.totalFiles;
    const analyzedDependencyCount = tour.analysisSnapshot.totalEdges;
    const shownModuleCount = completeness?.graphNodeCount ?? analyzedFileCount;
    const shownDependencyCount = completeness?.graphEdgeCount ?? analyzedDependencyCount;

    if (!step) {
        if (!isTourStreaming) {
            return null;
        }

        return (
            <div className="step-panel" data-testid="step-panel" data-workspace-mode={workspaceMode}>
                <div className="step-panel-header" data-testid="sidebar-region-header">
                    <div className="step-panel-title">
                        <span className="step-badge">{tour.tourType.replace('-', ' ')}</span>
                    </div>

                    <div className="step-panel-meta">
                        <span>
                            <FileText className="meta-icon" aria-hidden="true" />
                            {sampledOverview ? `${analyzedFileCount} files analyzed` : `${tour.analysisSnapshot.totalFiles} files`}
                        </span>
                        <span>
                            <GitBranch className="meta-icon" aria-hidden="true" />
                            {sampledOverview ? `${analyzedDependencyCount} deps mapped` : `${tour.analysisSnapshot.totalEdges} deps`}
                        </span>
                        <span>
                            <Layers className="meta-icon" aria-hidden="true" />
                            {tour.analysisSnapshot.frameworks.join(', ') || 'Unknown'}
                        </span>
                    </div>
                    {sampledOverview && (
                        <div className="step-panel-overview-note">
                            Interactive overview shows {shownModuleCount} modules and {shownDependencyCount} dependencies.
                        </div>
                    )}
                </div>

                <div className="step-content step-empty-state" data-testid="step-content">
                    <div className="step-header">
                        <div className="step-number">Streaming</div>
                        <h2 className="step-title">Preparing tour steps</h2>
                    </div>

                    <div className="section-content step-empty-copy">
                        <p>Analysis is complete. Waiting for narrated steps to stream in.</p>
                    </div>

                    <div className="step-controls step-controls-empty">
                        <span className="step-progress">0 / ?</span>
                    </div>
                </div>
            </div>
        );
    }

    const toggleSection = (section: string) => {
        setExpandedSection(expandedSection === section ? null : section);
    };

    return (
        <div className="step-panel" data-testid="step-panel" data-workspace-mode={workspaceMode}>
            {/* Tour Header */}
            <div className="step-panel-header" data-testid="sidebar-region-header">
                <div className="step-panel-title">
                    <span className="step-badge">{tour.tourType.replace('-', ' ')}</span>
                </div>

                {/* Analysis snapshot */}
                <div className="step-panel-meta">
                    <span>
                        <FileText className="meta-icon" aria-hidden="true" />
                        {sampledOverview ? `${analyzedFileCount} files analyzed` : `${tour.analysisSnapshot.totalFiles} files`}
                    </span>
                    <span>
                        <GitBranch className="meta-icon" aria-hidden="true" />
                        {sampledOverview ? `${analyzedDependencyCount} deps mapped` : `${tour.analysisSnapshot.totalEdges} deps`}
                    </span>
                    <span>
                        <Layers className="meta-icon" aria-hidden="true" />
                        {tour.analysisSnapshot.frameworks.join(', ') || 'Unknown'}
                    </span>
                </div>
                {sampledOverview && (
                    <div className="step-panel-overview-note">
                        Interactive overview shows {shownModuleCount} modules and {shownDependencyCount} dependencies.
                    </div>
                )}
            </div>

            {/* Step Navigation */}
            <div className="step-nav" data-testid="sidebar-region-step-list" style={REGION_DIVIDER_STYLE}>
                <div data-testid="step-nav">
                    {tour.steps.map((s, i) => (
                        <button
                            key={i}
                            className={`step-nav-item ${i === currentStep ? 'active' : ''} ${i < currentStep ? 'visited' : ''}`}
                            data-testid={`step-nav-item-${i}`}
                            onClick={() => onStepChange(i)}
                            title={s.title}
                            style={{ opacity: i === currentStep ? 1 : i < currentStep ? 0.75 : 0.55 }}
                        >
                            <span className="step-nav-number">{i + 1}</span>
                            <span className="step-nav-title" data-testid={`step-nav-title-${i}`}>{getStepNavLabel(s.title)}</span>
                        </button>
                    ))}
                </div>
            </div>

            {/* Current Step Content */}
            <div className="step-content" data-testid="step-content">
                <div data-testid="sidebar-region-current-step" style={REGION_DIVIDER_STYLE}>
                    <div className="step-header">
                        <div className="step-number">Step {step.order} of {tour.steps.length}</div>
                        <h2 className="step-title">{step.title}</h2>
                        {onOpenStepWiz && (
                            <button className="btn-nav" style={{ minHeight: '32px', marginTop: '12px' }} onClick={() => onOpenStepWiz(`Current step: ${step.title}`)}>
                                Ask Wiz About This Step
                            </button>
                        )}
                    </div>

                    {/* What It Does */}
                    <div className="step-section">
                        <button
                            className={`section-toggle ${expandedSection !== 'why' && expandedSection !== 'watch' ? 'active' : ''}`}
                            onClick={() => toggleSection('what')}
                        >
                            <Info className="section-icon" aria-hidden="true" />
                            <span className="section-label">What it does</span>
                        </button>
                        <div className="section-content">
                            <p>{step.what_it_does}</p>
                        </div>
                    </div>

                    {/* Why It Matters */}
                    <div className="step-section">
                        <button
                            className={`section-toggle ${expandedSection === 'why' ? 'active' : ''}`}
                            onClick={() => toggleSection('why')}
                        >
                            <Lightbulb className="section-icon" aria-hidden="true" />
                            <span className="section-label">Why it matters</span>
                        </button>
                        {(expandedSection === 'why' || expandedSection === null) && (
                            <div className="section-content insight">
                                <p>{step.why_it_matters}</p>
                            </div>
                        )}
                    </div>

                    {/* Watch Out */}
                    {step.watch_out && step.watch_out !== 'No major gotchas here.' && (
                        <div className="step-section">
                            <button
                                className={`section-toggle ${expandedSection === 'watch' ? 'active' : ''}`}
                                onClick={() => toggleSection('watch')}
                            >
                                <AlertTriangle className="section-icon" aria-hidden="true" />
                                <span className="section-label">Watch out</span>
                            </button>
                            {(expandedSection === 'watch' || expandedSection === null) && (
                                <div className="section-content warning">
                                    <p>{step.watch_out}</p>
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {/* File Links */}
                <div className="step-files" data-testid="sidebar-region-files" style={REGION_DIVIDER_STYLE}>
                    <h4>Files in this step</h4>
                    {step.files.map((file, index) => (
                        <button
                            key={file}
                            className="file-link"
                            onClick={() => onFileClick(file)}
                            title={`Open ${file}`}
                        >
                            <FileText className="file-icon" aria-hidden="true" />
                            <span
                                className="file-path"
                                data-testid={`file-path-${index}`}
                                style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                            >
                                {file}
                            </span>
                            <span className="file-arrow">→</span>
                        </button>
                    ))}
                </div>

                {/* Step navigation controls */}
                <div className="step-controls" data-testid="step-controls" style={{ alignItems: 'center' }}>
                    <button
                        className="btn-nav"
                        disabled={currentStep === 0}
                        onClick={() => onStepChange(currentStep - 1)}
                        style={{ minHeight: '32px', opacity: currentStep === 0 ? 0.45 : 1 }}
                    >
                        ← Previous
                    </button>
                    <span className="step-progress">
                        {isTourStreaming
                            ? `${tour.steps.length} / ?`
                            : `${tour.steps.length} / ${tour.steps.length}`}
                    </span>
                    <button
                        className="btn-nav"
                        disabled={currentStep === tour.steps.length - 1}
                        onClick={() => onStepChange(currentStep + 1)}
                        style={{ minHeight: '32px', opacity: currentStep === tour.steps.length - 1 ? 0.45 : 1 }}
                    >
                        Next →
                    </button>
                </div>
            </div>
        </div>
    );
}
