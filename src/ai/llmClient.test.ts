import { describe, it, expect } from 'vitest';
import type { WorkspaceAdapter } from '../WorkspaceAdapter';
import { GeminiProvider } from './llmClient';

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

describe('GeminiProvider', () => {
    it('reports unconfigured when no API key is set', () => {
        const provider = new GeminiProvider(mockWorkspace());
        expect(provider.isConfigured()).toBe(false);
    });

    it('reports configured when API key is set', () => {
        const provider = new GeminiProvider(mockWorkspace({ geminiApiKey: 'AIza_test' }));
        expect(provider.isConfigured()).toBe(true);
    });

    it('has correct name', () => {
        const provider = new GeminiProvider(mockWorkspace());
        expect(provider.name).toBe('Gemini 2.0 Flash');
    });

    it('throws when generating without API key', async () => {
        const provider = new GeminiProvider(mockWorkspace());
        await expect(provider.generate('sys', 'user')).rejects.toThrow('No Gemini API key');
    });

    it('model is null before any generate call', () => {
        const provider = new GeminiProvider(mockWorkspace({ geminiApiKey: 'AIza_test' }));
        expect((provider as unknown as { model: unknown }).model).toBeNull();
    });
});
