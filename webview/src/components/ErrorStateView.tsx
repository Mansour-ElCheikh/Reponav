import { AlertTriangle } from 'lucide-react';
import './ErrorStateView.css';

interface ErrorStateViewProps {
    error: string;
    canRetry: boolean;
    onRetry: () => void;
    onDismiss: () => void;
    onOpenSettings: () => void;
}

/** Renders recoverable and configuration-oriented error states for the webview. */
export function ErrorStateView({ error, canRetry, onRetry, onDismiss, onOpenSettings }: ErrorStateViewProps) {
    const lowerError = error.toLowerCase();
    const isApiKeyError = lowerError.includes('api key') || lowerError.includes('not configured');
    const isTimeoutError = lowerError.includes('timeout') || lowerError.includes('timed out');

    return (
        <div className="app error-state">
            <div className="error-container">
                <AlertTriangle className="error-icon" aria-hidden="true" />
                <h2>Something went wrong</h2>
                <p className="error-message">{error}</p>
                {isApiKeyError && (
                    <p className="error-hint">
                        Open Settings and search for &quot;RepoNav&quot; to configure your API key.
                    </p>
                )}
                {isTimeoutError && (
                    <p className="error-hint">
                        The AI provider took too long. Try again or switch to a faster provider (Groq is recommended).
                    </p>
                )}
                <div className="error-actions">
                    {canRetry && !isApiKeyError && (
                        <button className="btn-primary" onClick={onRetry}>
                            Try Again
                        </button>
                    )}
                    {isApiKeyError && (
                        <button className="btn-primary" onClick={onOpenSettings}>
                            Open RepoNav Settings
                        </button>
                    )}
                    {canRetry && isApiKeyError && (
                        <button className="btn-secondary" onClick={onRetry}>
                            Try Again
                        </button>
                    )}
                    <button className="btn-secondary" onClick={onDismiss}>
                        Dismiss
                    </button>
                </div>
            </div>
        </div>
    );
}
