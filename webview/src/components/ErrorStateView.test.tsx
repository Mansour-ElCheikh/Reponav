import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ErrorStateView } from './ErrorStateView';

function renderErrorState(error: string): string {
    return renderToStaticMarkup(
        <ErrorStateView
            error={error}
            canRetry={true}
            onRetry={vi.fn()}
            onDismiss={vi.fn()}
            onOpenSettings={vi.fn()}
        />
    );
}

describe('ErrorStateView API key UX', () => {
    it('shows settings action for API key errors', () => {
        const html = renderErrorState('Groq API key not configured');
        expect(html).toContain('Open RepoNav Settings');
    });

    it('hides settings action for non-config errors', () => {
        const html = renderErrorState('Request timed out while generating tour');
        expect(html).not.toContain('Open RepoNav Settings');
    });

    it('shows timeout hint for timeout errors', () => {
        const html = renderErrorState('Request timed out while generating tour');
        expect(html).toContain('The AI provider took too long.');
    });

    it('always renders dismiss action', () => {
        const html = renderErrorState('Any error');
        expect(html).toContain('Dismiss');
    });

    it('renders title, body, and the primary action before secondary actions', () => {
        const html = renderErrorState('Groq API key not configured');

        expect(html.indexOf('Something went wrong')).toBeGreaterThan(-1);
        expect(html.indexOf('Groq API key not configured')).toBeGreaterThan(html.indexOf('Something went wrong'));
        expect(html.indexOf('Open RepoNav Settings')).toBeGreaterThan(html.indexOf('Groq API key not configured'));
        expect(html.indexOf('Dismiss')).toBeGreaterThan(html.indexOf('Open RepoNav Settings'));
    });
});
