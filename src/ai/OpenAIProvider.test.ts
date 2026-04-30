import { describe, it, expect } from 'vitest';
import type { WorkspaceAdapter } from '../WorkspaceAdapter';
import { OpenAIProvider } from './OpenAIProvider';

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

describe('OpenAIProvider', () => {
    it('reports unconfigured when no API key is set', () => {
        const provider = new OpenAIProvider(mockWorkspace());
        expect(provider.isConfigured()).toBe(false);
    });

    it('reports configured when an API key is set', () => {
        const provider = new OpenAIProvider(mockWorkspace({ openAIApiKey: 'sk-test' }));
        expect(provider.isConfigured()).toBe(true);
    });

    it('has the expected display name', () => {
        const provider = new OpenAIProvider(mockWorkspace());
        expect(provider.name).toBe('GPT-4o');
    });
});