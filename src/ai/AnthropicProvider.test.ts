import { describe, it, expect } from 'vitest';
import type { WorkspaceAdapter } from '../WorkspaceAdapter';
import { AnthropicProvider } from './AnthropicProvider';

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

describe('AnthropicProvider', () => {
    it('reports unconfigured when no API key is set', () => {
        const provider = new AnthropicProvider(mockWorkspace());
        expect(provider.isConfigured()).toBe(false);
    });

    it('reports configured when API key is set', () => {
        const provider = new AnthropicProvider(mockWorkspace({ anthropicApiKey: 'sk-ant-test' }));
        expect(provider.isConfigured()).toBe(true);
    });

    it('has correct name', () => {
        const provider = new AnthropicProvider(mockWorkspace());
        expect(provider.name).toBe('Claude 3.5 Sonnet');
    });

    it('throws when generating without API key', async () => {
        const provider = new AnthropicProvider(mockWorkspace());
        await expect(provider.generate('sys', 'user')).rejects.toThrow('No Anthropic API key');
    });
});
