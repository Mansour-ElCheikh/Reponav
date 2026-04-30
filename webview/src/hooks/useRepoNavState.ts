import { useCallback, useEffect, useRef, useState } from 'react';
import type {
    AnalysisReport,
    AppConfig,
    ExtensionToWebviewMessage,
    Tour,
    TourStep,
    TourType,
} from '../types';
import { vscodeApi } from '../vscodeApi';
import { isExtensionToWebviewMessage } from '../messageGuards';

export interface TourSummary {
    id: string;
    query: string;
    tourType: string;
    stepCount: number;
    createdAt: string;
}

export interface GitChange {
    path: string;
    status: string;
}

export interface GitState {
    branch?: string;
    changes: GitChange[];
}

const DEFAULT_APP_CONFIG: AppConfig = {
    demoMode: false,
};

export interface RepoNavMessageHandlers {
    setTour: (tour: Tour) => void;
    setCurrentStep: (step: number) => void;
    setIsGenerating: (value: boolean) => void;
    setStatus: (status: string) => void;
    setError: (error: string) => void;
    setReport: (report: AnalysisReport) => void;
    setSavedTours: (tours: TourSummary[]) => void;
    setGitState: (state: GitState) => void;
    setAppConfig: (config: AppConfig) => void;
    setAnalyzerReply: (text: string | null) => void;
    setAnalyzerError: (message: string) => void;
    setStreamingSteps?: (update: ((prev: TourStep[]) => TourStep[]) | TourStep[]) => void;
    getTour?: () => Tour | null;
    getStreamingSteps?: () => TourStep[];
    setClearStreamTimeout?: () => void;
    setStreamTimeout?: (callback: () => void) => void;
}

export function syncStepToGraphNode(
    tour: Tour | null,
    nodeId: string,
    setCurrentStep: (step: number) => void
): void {
    if (!tour) return;
    const stepIndex = tour.steps.findIndex((step) => step.files.includes(nodeId));
    if (stepIndex >= 0) {
        setCurrentStep(stepIndex);
    }
}

export function postOpenFileMessage(filePath: string, line?: number): void {
    vscodeApi.postMessage({ type: 'openFile', path: filePath, line });
}

export interface TourRequestHandlers {
    setIsGenerating: (value: boolean) => void;
    setStatus: (status: string) => void;
    setError: (error: string) => void;
}

export function startTourRequest(
    query: string,
    tourType: TourType,
    handlers: TourRequestHandlers
): void {
    handlers.setIsGenerating(true);
    handlers.setStatus('Preparing tour...');
    handlers.setError('');
    vscodeApi.postMessage({ type: 'requestTour', query, tourType });
}

/**
 * Keeps the streaming state visible while a provisional graph is already on screen.
 */
export function shouldShowTourStreaming(
    isGenerating: boolean,
    tour: Tour | null,
    streamingSteps: TourStep[]
): boolean {
    const hasProvisionalGraph = tour !== null && tour.steps.length === 0;
    return isGenerating && (hasProvisionalGraph || streamingSteps.length > 0);
}

/**
 * Dispatch an incoming extension-to-webview message to the appropriate state handler.
 * Handles tour streaming, analysis, errors, and git/config updates.
 */
export function handleRepoNavMessage(
    message: ExtensionToWebviewMessage,
    handlers: RepoNavMessageHandlers
): void {
    switch (message.type) {
        case 'tourGenerated':
            handlers.setTour(message.tour);
            handlers.setCurrentStep(0);
            handlers.setIsGenerating(false);
            handlers.setStatus('');
            handlers.setError('');
            break;
        case 'analysisComplete':
            handlers.setReport(message.report);
            break;
        case 'tourGenerating':
            handlers.setIsGenerating(true);
            handlers.setStatus(message.status);
            handlers.setError('');
            break;
        case 'error':
            handlers.setError(message.message);
            handlers.setIsGenerating(false);
            handlers.setStatus('');
            break;
        case 'savedTours':
            handlers.setSavedTours(message.tours || []);
            break;
        case 'gitStatus':
            handlers.setGitState({
                branch: message.branch,
                changes: message.changes || [],
            });
            break;
        case 'appConfig':
            handlers.setAppConfig({
                demoMode: Boolean(message.config.demoMode),
            });
            break;
        case 'analyzerReply':
            handlers.setAnalyzerReply(message.text);
            handlers.setAnalyzerError('');
            break;
        case 'analyzerError':
            handlers.setAnalyzerReply(null);
            handlers.setAnalyzerError(message.message);
            break;
        case 'tour.stream_chunk':
            // Start 60s timeout on first chunk
            if (handlers.setStreamTimeout) {
                handlers.setStreamTimeout(() => {
                    handlers.setIsGenerating(false);
                    handlers.setError('Tour may be incomplete — stream did not finish within 60 seconds.');
                });
            }
            if (message.payload.type === 'graph') {
                // Graph chunk carries full Tour skeleton with real analysisSnapshot/query/tourType
                handlers.setTour({
                    ...message.payload.data,
                    steps: [], // Steps arrive via subsequent step chunks
                });
                handlers.setIsGenerating(true);
            } else if (message.payload.type === 'step' && handlers.setStreamingSteps) {
                // Step chunk — append to streaming steps array
                handlers.setStreamingSteps((prev) => [...prev, message.payload.data]);
            }
            break;
        case 'tour.stream_end':
            // Merge streaming steps into final tour
            if (handlers.getTour && handlers.getStreamingSteps && handlers.setStreamingSteps) {
                const currentTour = handlers.getTour();
                const streamedSteps = handlers.getStreamingSteps();
                if (currentTour) {
                    handlers.setTour({
                        ...currentTour,
                        steps: streamedSteps,
                    });
                }
                handlers.setStreamingSteps([]);
            }
            handlers.setIsGenerating(false);
            if (handlers.setClearStreamTimeout) {
                handlers.setClearStreamTimeout();
            }
            break;
        default:
            break;
    }
}

/**
 * Primary state hook for the RepoNav webview. Manages tour, graph, analysis, streaming,
 * git status, and app config. Wires the VS Code postMessage event listener.
 */
export function useRepoNavState() {
    const [tour, setTour] = useState<Tour | null>(null);
    const [report, setReport] = useState<AnalysisReport | null>(null);
    const [currentStep, setCurrentStep] = useState(0);
    const [status, setStatus] = useState('');
    const [error, setError] = useState('');
    const [isGenerating, setIsGenerating] = useState(false);
    const [savedTours, setSavedTours] = useState<TourSummary[]>([]);
    const [gitState, setGitState] = useState<GitState | null>(null);
    const [lastQuery, setLastQuery] = useState<{ query: string; tourType: TourType } | null>(null);
    const [streamingSteps, setStreamingSteps] = useState<TourStep[]>([]);
    // Keep refs in sync with state so the stable useEffect([]) closure always reads current values
    const _setTourWithRef = (t: Tour | null) => { tourRef.current = t; setTour(t); };
    const _setStreamingStepsWithRef = (update: ((prev: TourStep[]) => TourStep[]) | TourStep[]) => {
        setStreamingSteps((prev) => {
            const next = typeof update === 'function' ? update(prev) : update;
            streamingStepsRef.current = next;
            return next;
        });
    };
    const [appConfig, setAppConfig] = useState<AppConfig>(DEFAULT_APP_CONFIG);
    const [analyzerReply, setAnalyzerReply] = useState<string | null>(null);
    const [analyzerError, setAnalyzerError] = useState('');
    const streamTimeoutRef = useRef<number | null>(null);
    const tourRef = useRef<Tour | null>(null);
    const streamingStepsRef = useRef<TourStep[]>([]);
    const GENERATION_WATCHDOG_MS = 150_000;
    const STREAM_TIMEOUT_MS = 60_000;

    useEffect(() => {
        const handler = (event: MessageEvent) => {
            if (!isExtensionToWebviewMessage(event.data)) {
                console.warn('[RepoNav][debug][webview] ignored malformed message', event.data);
                return;
            }
            const message: ExtensionToWebviewMessage = event.data;
            console.info('[RepoNav][debug][webview] extension->webview', {
                type: message.type,
                ...(message.type === 'tourGenerating' ? { status: message.status } : {}),
                ...(message.type === 'error' ? { error: message.message } : {}),
            });
            handleRepoNavMessage(message, {
                setTour: _setTourWithRef,
                setCurrentStep,
                setIsGenerating,
                setStatus,
                setError,
                setReport,
                setSavedTours,
                setGitState,
                setAppConfig,
                setAnalyzerReply,
                setAnalyzerError,
                setStreamingSteps: _setStreamingStepsWithRef,
                getTour: () => tourRef.current,
                getStreamingSteps: () => streamingStepsRef.current,
                setClearStreamTimeout: () => {
                    if (streamTimeoutRef.current !== null) {
                        window.clearTimeout(streamTimeoutRef.current);
                        streamTimeoutRef.current = null;
                    }
                },
                setStreamTimeout: (callback: () => void) => {
                    // Only set timeout once (on first chunk)
                    if (streamTimeoutRef.current === null) {
                        streamTimeoutRef.current = window.setTimeout(callback, STREAM_TIMEOUT_MS);
                    }
                },
            });
        };

        window.addEventListener('message', handler);
        vscodeApi.postMessage({ type: 'ready' });

        return () => window.removeEventListener('message', handler);
    }, []);

    useEffect(() => {
        if (!isGenerating) return;
        const timeoutId = window.setTimeout(() => {
            setIsGenerating(false);
            setStatus('');
            setError('Tour generation timed out. Please try again.');
        }, GENERATION_WATCHDOG_MS);
        return () => window.clearTimeout(timeoutId);
    }, [isGenerating, status, setError, setIsGenerating, setStatus]);

    const requestTour = useCallback((query: string, tourType: TourType) => {
        setLastQuery({ query, tourType });
        startTourRequest(query, tourType, {
            setIsGenerating,
            setStatus,
            setError,
        });
    }, []);

    const retryLastTour = useCallback(() => {
        if (streamTimeoutRef.current !== null) {
            window.clearTimeout(streamTimeoutRef.current);
            streamTimeoutRef.current = null;
        }
        _setStreamingStepsWithRef([]);
        setCurrentStep(0);
        setStatus('');
        if (tourRef.current && tourRef.current.steps.length === 0) {
            _setTourWithRef(null);
        }

        if (lastQuery) {
            setError('');
            requestTour(lastQuery.query, lastQuery.tourType);
            return;
        }
        setError('');
    }, [lastQuery, requestTour]);

    const resetTour = useCallback(() => {
        setTour(null);
        setCurrentStep(0);
    }, []);

    const selectGraphNode = useCallback(
        (nodeId: string) => {
            syncStepToGraphNode(tour, nodeId, setCurrentStep);
        },
        [tour]
    );

    const openGraphNodeFile = useCallback((nodeId: string) => {
        postOpenFileMessage(nodeId);
    }, []);

    const openFile = useCallback((filePath: string, line?: number) => {
        postOpenFileMessage(filePath, line);
    }, []);

    const openSettings = useCallback(() => {
        vscodeApi.postMessage({ type: 'openSettings' });
    }, []);

    const loadTour = useCallback((tourId: string) => {
        vscodeApi.postMessage({ type: 'loadTour', tourId });
    }, []);

    const deleteTour = useCallback((tourId: string) => {
        vscodeApi.postMessage({ type: 'deleteTour', tourId });
    }, []);

    return {
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
        streamingSteps,
        isTourStreaming: shouldShowTourStreaming(isGenerating, tour, streamingSteps),
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
    };
}
