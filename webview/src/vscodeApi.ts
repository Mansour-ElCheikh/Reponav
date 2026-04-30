import type { TourType } from './types';

type OutgoingMessage =
    | { type: 'ready' }
    | { type: 'requestTour'; query: string; tourType: TourType }
    | { type: 'openFile'; path: string; line?: number }
    | { type: 'openSettings' }
    | { type: 'loadTour'; tourId: string }
    | { type: 'deleteTour'; tourId: string }
    | { type: 'analyzerQuery'; text: string }
    | { type: 'reponavHelp' }
    | { type: 'webviewLog'; level: 'debug' | 'error'; message: string; data?: Record<string, unknown> };

interface VSCodeApi {
    postMessage(message: OutgoingMessage): void;
    getState(): unknown;
    setState(state: unknown): void;
}

interface WindowWithVSCode extends Window {
    acquireVsCodeApi?: () => VSCodeApi;
}

export const vscodeApi: VSCodeApi =
    (window as WindowWithVSCode).acquireVsCodeApi?.() ?? {
        postMessage: (message: OutgoingMessage) => {
            console.log('vscode.postMessage:', message);
        },
        getState: () => null,
        setState: () => {
            // No-op in non-VSCode contexts.
        },
    };

/**
 * Unified webview logger — logs to browser console AND sends to extension host output channel.
 * All webview diagnostics appear in the RepoNav output channel alongside extension logs.
 */
export function webviewLog(level: 'debug' | 'error', message: string, data?: Record<string, unknown>) {
    const prefix = `[RepoNav][${level}][webview]`;
    if (level === 'error') {
        console.error(prefix, message, data ?? '');
    } else {
        console.log(prefix, message, data ?? '');
    }
    try {
        vscodeApi.postMessage({ type: 'webviewLog', level, message, data } as OutgoingMessage);
    } catch {
        // Swallow — logging must never crash the app
    }
}
