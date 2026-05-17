import { describe, it, expect } from 'vitest';
import type { WorkspaceAdapter } from '../WorkspaceAdapter';
import { GroqProvider } from './GroqProvider';

// BaseOpenAICompatibleProvider is abstract — tested through GroqProvider as a concrete subclass.

function mockWorkspace(config: Record<string, string> = {}): WorkspaceAdapter {
    return {
        getWorkspaceRoot: () => '/workspace',
        getConfig: <T>(_section: string, key: string, defaultValue: T): T =>
            (config[key] as unknown as T) ?? defaultValue,
        findFiles: async () => [],
        readFile: async () => '',
        showInfo: () => {},
        showError: () => {},
    } as WorkspaceAdapter;
}

describe('BaseOpenAICompatibleProvider (via GroqProvider)', () => {
    it('client is null before any generate call', () => {
        const provider = new GroqProvider(mockWorkspace({ groqApiKey: 'gsk_test' }));
        // Access private field through cast — verifies lazy client construction
        expect((provider as unknown as { client: unknown }).client).toBeNull();
    });

    it('throws when generating without API key', async () => {
        const provider = new GroqProvider(mockWorkspace());
        await expect(provider.generate('sys', 'user')).rejects.toThrow('No Groq API key');
    });

    it('uses the correct base URL for Groq', () => {
        const provider = new GroqProvider(mockWorkspace());
        expect((provider as unknown as { getBaseURL(): string | undefined }).getBaseURL())
            .toBe('https://api.groq.com/openai/v1');
    });
});
