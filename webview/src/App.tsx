import { GitBranch, MessageSquare, X, HelpCircle } from 'lucide-react';
import { Component, type ReactNode } from 'react';
import { useState, useEffect } from 'react';
import { EmptyStateView } from './components/EmptyStateView';
import { ErrorStateView } from './components/ErrorStateView';
import { LoadingStateView } from './components/LoadingStateView';
import { SigmaGraph } from './components/SigmaGraph';
import { StepPanel } from './components/StepPanel';
import { useRepoNavState } from './hooks/useRepoNavState';
import { SAMPLE_TOUR } from './utils/sampleTour';
import { vscodeApi, webviewLog } from './vscodeApi';

const BOLD_MARKER_LENGTH = 2;
const H2_MARKER_LENGTH = 3;
const H3_MARKER_LENGTH = 4;
const REPLY_SECTION_MARKER_LENGTH = 4;

// Converts a markdown string into React elements without any external library.
// Handles: ## headings, **bold**, `code`, bullet lists (- item), blank line paragraphs.
function MarkdownText({ text }: { text: string }) {
    const elements: React.ReactNode[] = [];
    const lines = text.split('\n');
    let key = 0;

    // Inline: replace **bold** and `code` spans
    function inlineFormat(line: string): React.ReactNode[] {
        const parts: React.ReactNode[] = [];
        const pattern = /(`[^`]+`|\*\*[^*]+\*\*)/g;
        let last = 0;
        let match: RegExpExecArray | null;
        while ((match = pattern.exec(line)) !== null) {
            if (match.index > last) parts.push(line.slice(last, match.index));
            const raw = match[0];
            if (raw.startsWith('`')) {
                parts.push(<code key={key++} className="assistant-inline-code">{raw.slice(1, -1)}</code>);
            } else {
                parts.push(<strong key={key++}>{raw.slice(BOLD_MARKER_LENGTH, raw.length - BOLD_MARKER_LENGTH)}</strong>);
            }
            last = match.index + raw.length;
        }
        if (last < line.length) parts.push(line.slice(last));
        return parts;
    }

    let i = 0;
    while (i < lines.length) {
        const line = lines[i];
        if (/^## /.test(line)) {
            elements.push(<h3 key={key++} className="assistant-h2">{line.slice(H2_MARKER_LENGTH)}</h3>);
        } else if (/^### /.test(line)) {
            elements.push(<h4 key={key++} className="assistant-h3">{line.slice(H3_MARKER_LENGTH)}</h4>);
        } else if (/^[-*] /.test(line)) {
            const items: React.ReactNode[] = [];
            while (i < lines.length && /^[-*] /.test(lines[i])) {
                items.push(<li key={key++}>{inlineFormat(lines[i].slice(2))}</li>);
                i++;
            }
            elements.push(<ul key={key++} className="assistant-list">{items}</ul>);
            continue;
        } else if (line.trim() === '') {
            // skip blank lines between blocks
        } else {
            elements.push(<p key={key++} className="assistant-reply">{inlineFormat(line)}</p>);
        }
        i++;
    }
    return <>{elements}</>;
}

interface ChatCard {
    id: string;
    header: string;
    body: string;
    isError?: boolean;
}

type WorkspaceTab = 'narrative' | 'graph';

/** Split a reply string into cards. ### sections → one card each; prose → one card. */
function parseReplyToCards(text: string, defaultHeader: string): ChatCard[] {
    const sectionRe = /^### (.+)$/m;
    if (!sectionRe.test(text)) {
        return [{ id: String(Date.now()), header: defaultHeader, body: text.trim() }];
    }
    const cards: ChatCard[] = [];
    const parts = text.split(/^(?=### )/m).filter(Boolean);
    for (const part of parts) {
        const firstNewline = part.indexOf('\n');
        const header = firstNewline !== -1
            ? part.slice(REPLY_SECTION_MARKER_LENGTH, firstNewline).trim()
            : part.slice(REPLY_SECTION_MARKER_LENGTH).trim();
        const body = firstNewline !== -1 ? part.slice(firstNewline + 1).trim() : '';
        if (header) cards.push({ id: `${Date.now()}-${cards.length}`, header, body });
    }
    return cards.length > 0 ? cards : [{ id: String(Date.now()), header: defaultHeader, body: text.trim() }];
}

/**
 * App renders the single-workspace tour experience for the webview.
 */
export function App() {
    const {
        tour,
        report,
        currentStep,
        status,
        error,
        isGenerating,
        savedTours,
        gitState,
        lastQuery,
        appConfig,
        isTourStreaming,
        streamingSteps,
        setTour,
        setError,
        setCurrentStep,
        requestTour,
        retryLastTour,
        resetTour,
        selectGraphNode,
        openGraphNodeFile,
        openFile,
        openSettings,
        loadTour,
        deleteTour,
        analyzerReply,
        setAnalyzerReply,
        analyzerError,
        setAnalyzerError,
    } = useRepoNavState();
    const sampledOverview = tour?.analysisSnapshot.completeness?.graphCoverage === 'sampled';
    const analyzedFileCount = tour?.analysisSnapshot.completeness?.analyzedFileCount ?? tour?.analysisSnapshot.totalFiles ?? 0;
    const analyzedDependencyCount = tour?.analysisSnapshot.totalEdges ?? 0;
    const graphNodeCount = tour?.graph.nodes.length ?? 0;
    const graphEdgeCount = tour?.graph.edges.length ?? 0;

    const [chatText, setChatText] = useState('');
    const [chatPending, setChatPending] = useState(false);
    const [wizOpen, setWizOpen] = useState(false);
    const [cards, setCards] = useState<ChatCard[]>([]);
    const [pendingHeader, setPendingHeader] = useState<string | null>(null);
    const [workspaceTab, setWorkspaceTab] = useState<WorkspaceTab>('narrative');
    const [viewportWidth, setViewportWidth] = useState(() => (typeof window === 'undefined' ? 1024 : window.innerWidth));
    const [wizContext, setWizContext] = useState<string | null>(null);

    useEffect(() => {
        if (typeof window === 'undefined') {
            return undefined;
        }

        const handleResize = () => setViewportWidth(window.innerWidth);
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, []);

    // Convert incoming analyzerReply into cards — useEffect avoids calling setState during render
    useEffect(() => {
        if (analyzerReply !== null && pendingHeader !== null) {
            setCards(prev => [...prev, ...parseReplyToCards(analyzerReply, pendingHeader)]);
            setAnalyzerReply(null);
            setPendingHeader(null);
            setChatPending(false);
        }
    }, [analyzerReply]); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        if (analyzerError && pendingHeader !== null) {
            setCards(prev => [...prev, { id: String(Date.now()), header: 'Error', body: analyzerError, isError: true }]);
            setAnalyzerError('');
            setPendingHeader(null);
            setChatPending(false);
        }
    }, [analyzerError]); // eslint-disable-line react-hooks/exhaustive-deps

    const dismissCard = (id: string) => setCards(prev => prev.filter(c => c.id !== id));
    const clearCards = () => { setCards([]); setChatPending(false); setWizContext(null); };

    const openContextualWiz = (context: string) => {
        setWizOpen(true);
        setWizContext(context);
        setChatText(context);
    };

    const handleChatSend = () => {
        const trimmed = chatText.trim();
        if (!trimmed) return;
        setChatPending(true);
        setPendingHeader('Answer');
        vscodeApi.postMessage({ type: 'analyzerQuery', text: trimmed });
        setChatText('');
    };

    const handleHelpRequest = () => {
        setCards([]);
        setChatPending(true);
        setPendingHeader('RepoNav Wiz');
        vscodeApi.postMessage({ type: 'reponavHelp' });
    };

    const chatWidget = (
        <>
            {/* FAB — opens/closes the Wiz panel */}
            <button
                className="assistant-chat-fab"
                title="RepoNav Wiz"
                onClick={() => { setWizOpen(open => !open); clearCards(); }}
                aria-label="Open RepoNav Wiz"
            >
                <MessageSquare size={20} aria-hidden="true" />
            </button>

            {/* Card stack — rendered above FAB, newest card at bottom */}
            {wizOpen && cards.length > 0 && (
                <div className="wiz-card-stack" aria-label="RepoNav Wiz answers" role="log">
                    {cards.map(card => (
                        <div key={card.id} className={`wiz-card${card.isError ? ' wiz-card--error' : ''}`}>
                            <div className="wiz-card-header">
                                <span className="wiz-card-title">{card.header}</span>
                                <button
                                    className="wiz-card-dismiss"
                                    onClick={() => dismissCard(card.id)}
                                    aria-label={`Dismiss ${card.header}`}
                                >
                                    <X size={12} />
                                </button>
                            </div>
                            <div className="wiz-card-body">
                                {card.isError
                                    ? <p className="assistant-error">{card.body}</p>
                                    : <MarkdownText text={card.body} />
                                }
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* Input panel — always below the cards when open */}
            {wizOpen && (
                <div className="wiz-input-panel" role="dialog" aria-label="RepoNav Wiz">
                    <div className="wiz-input-header">
                        <span className="wiz-brand">RepoNav Wiz</span>
                        <div className="wiz-input-header-actions">
                            {cards.length > 0 && (
                                <button className="wiz-clear-btn" onClick={clearCards} title="Clear answers">
                                    Clear
                                </button>
                            )}
                            <button
                                className="wiz-help-btn"
                                onClick={handleHelpRequest}
                                disabled={chatPending}
                                title="RepoNav Usability Reference"
                                aria-label="RepoNav help"
                            >
                                <HelpCircle size={14} />
                            </button>
                        </div>
                    </div>
                    {wizContext && <div className="wiz-context" data-testid="wiz-context">{wizContext}</div>}
                    <div className="wiz-input-row">
                        <input
                            className="assistant-chat-input"
                            type="text"
                            placeholder={chatPending ? 'Thinking…' : 'Ask about the codebase…'}
                            value={chatText}
                            onChange={(e) => setChatText(e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Enter') handleChatSend(); }}
                            aria-label="RepoNav Wiz input"
                            disabled={chatPending}
                            autoFocus
                        />
                        <button className="assistant-chat-send" onClick={handleChatSend} disabled={!chatText.trim() || chatPending}>
                            Send
                        </button>
                    </div>
                </div>
            )}
        </>
    );

    // Full-screen spinner only when graph hasn't arrived yet
    if (isGenerating && !tour) {
        return <><LoadingStateView status={status} report={report} gitState={gitState} />{chatWidget}</>;
    }

    if (error) {
        return (
            <>
                <ErrorStateView
                    error={error}
                    canRetry={Boolean(lastQuery)}
                    onRetry={retryLastTour}
                    onDismiss={() => setError('')}
                    onOpenSettings={openSettings}
                />
                {chatWidget}
            </>
        );
    }

    if (!tour) {
        return (
            <>
                <EmptyStateView
                    report={report}
                    gitState={gitState}
                    appConfig={appConfig}
                    savedTours={savedTours}
                    onRequestTour={requestTour}
                    onOpenSettings={openSettings}
                    onLoadSampleTour={() => setTour(SAMPLE_TOUR)}
                    onLoadTour={loadTour}
                    onDeleteTour={deleteTour}
                />
                {chatWidget}
            </>
        );
    }

    // During streaming, merge accumulated steps so StepPanel has content to render.
    // After stream_end, tour.steps is already populated and streamingSteps is [].
    const tourForRender = isTourStreaming && streamingSteps.length > 0
        ? { ...tour, steps: streamingSteps }
        : tour;
    const isTabbedWorkspace = viewportWidth < 360;
    const isCompactWorkspace = viewportWidth >= 360 && viewportWidth < 600;
    const compactSidebarWidth = `${Math.min(320, Math.max(112, viewportWidth - 248))}px`;
    const sidebarStyle = isTabbedWorkspace
        ? { display: workspaceTab === 'narrative' ? undefined : 'none' }
        : isCompactWorkspace
            ? { width: compactSidebarWidth }
            : undefined;
    const graphStyle = {
        ...(isCompactWorkspace ? { minWidth: '240px' } : {}),
        ...(isTabbedWorkspace && workspaceTab !== 'graph' ? { display: 'none' } : {}),
    };

    return (
        <div className="app tour-view">
            {isTabbedWorkspace && (
                <div className="workspace-tabs" role="tablist" aria-label="Workspace views">
                    <button
                        type="button"
                        role="tab"
                        aria-selected={workspaceTab === 'narrative'}
                        className={`workspace-tab${workspaceTab === 'narrative' ? ' workspace-tab--active' : ''}`}
                        onClick={() => setWorkspaceTab('narrative')}
                    >
                        Narrative
                    </button>
                    <button
                        type="button"
                        role="tab"
                        aria-selected={workspaceTab === 'graph'}
                        className={`workspace-tab${workspaceTab === 'graph' ? ' workspace-tab--active' : ''}`}
                        onClick={() => setWorkspaceTab('graph')}
                    >
                        Graph
                    </button>
                </div>
            )}
            <div className="tour-layout" data-testid="tour-layout" style={{ gap: isCompactWorkspace ? '8px' : undefined }}>
                <div className="tour-sidebar" data-testid="tour-sidebar" style={sidebarStyle}>
                    <StepPanel
                        tour={tourForRender}
                        currentStep={currentStep}
                        onStepChange={setCurrentStep}
                        onFileClick={openFile}
                        isTourStreaming={isTourStreaming}
                        onOpenStepWiz={openContextualWiz}
                    />
                </div>

                <div className="tour-graph" data-testid="tour-graph" style={graphStyle}>
                    <SigmaGraph
                        tour={tour}
                        currentStep={currentStep}
                        onNodeClick={selectGraphNode}
                        onNodeDoubleClick={openGraphNodeFile}
                        deadCodeFiles={report?.deadCodeFiles}
                        flows={report?.flows}
                        toolingFlowCount={report?.toolingFlowCount}
                    />
                </div>
            </div>

            <div className="tour-bar">
                <div className="tour-bar-info">
                    <span className="tour-type-badge">{tour.tourType}</span>
                    {sampledOverview && <span className="tour-type-badge">Sampled interactive overview</span>}
                    <span className="tour-query">{tour.query}</span>
                    {gitState && gitState.branch && (
                        <span className="tour-git-badge">
                            <GitBranch className="tour-git-icon" aria-hidden="true" />
                            {gitState.branch}
                        </span>
                    )}
                </div>
                <div className="tour-bar-stats">
                    <span>{tour.steps.length} steps</span>
                    <span>•</span>
                    <span>{sampledOverview ? `${graphNodeCount} / ${analyzedFileCount} modules shown` : `${graphNodeCount} modules`}</span>
                    <span>•</span>
                    <span>{sampledOverview ? `${graphEdgeCount} / ${analyzedDependencyCount} dependencies shown` : `${graphEdgeCount} dependencies`}</span>
                    {gitState && gitState.changes.length > 0 && (
                        <>
                            <span>•</span>
                            <span className="tour-git-changes">{gitState.changes.length} uncommitted</span>
                        </>
                    )}
                    <button className="btn-new-tour" onClick={resetTour} title="Generate a new tour">
                        + New Tour
                    </button>
                </div>
            </div>
            {chatWidget}
        </div>
    );
}

// ─── Error Boundary — catches React crashes and logs to unified channel ──────

interface ErrorBoundaryState { hasError: boolean; errorMessage: string; }

class AppErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
    state: ErrorBoundaryState = { hasError: false, errorMessage: '' };

    static getDerivedStateFromError(error: Error) {
        return { hasError: true, errorMessage: error.message };
    }

    componentDidCatch(error: Error, info: { componentStack?: string | null }) {
        webviewLog('error', `React crash: ${error.message}`, {
            stack: error.stack ?? '',
            componentStack: info.componentStack ?? '',
        });
    }

    render() {
        if (this.state.hasError) {
            return (
                <div style={{ padding: 24, color: '#ef4444', fontFamily: 'monospace', fontSize: 13 }}>
                    <h3>RepoNav crashed</h3>
                    <p>{this.state.errorMessage}</p>
                    <button onClick={() => this.setState({ hasError: false, errorMessage: '' })} style={{ marginTop: 12, padding: '6px 12px', cursor: 'pointer' }}>
                        Retry
                    </button>
                </div>
            );
        }
        return this.props.children;
    }
}

/** Wrapped App with error boundary for unified crash logging. */
export function AppWithErrorBoundary() {
    return (
        <AppErrorBoundary>
            <App />
        </AppErrorBoundary>
    );
}
