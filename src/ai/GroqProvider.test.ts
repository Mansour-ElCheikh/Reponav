import { describe, it, expect, vi } from 'vitest';
import { WorkspaceAdapter } from '../WorkspaceAdapter';
import { GroqProvider } from './GroqProvider';

function mockWorkspace(config: Record<string, string> = {}): WorkspaceAdapter {
    return {
        getWorkspaceRoot: () => '/workspace',
        getConfig: <T>(_section: string, key: string, defaultValue: T): T => {
            return (config[key] as unknown as T) ?? defaultValue;
        },
        findFiles: async () => [],
        readFile: async () => '',
        showInfo: () => { },
        showError: () => { },
    } as WorkspaceAdapter;
}

describe('GroqProvider', () => {
    it('reports unconfigured when no API key is set', () => {
        const provider = new GroqProvider(mockWorkspace());
        expect(provider.isConfigured()).toBe(false);
    });

    it('reports configured when API key is set', () => {
        const provider = new GroqProvider(mockWorkspace({ groqApiKey: 'gsk_test123' }));
        expect(provider.isConfigured()).toBe(true);
    });

    it('has correct name', () => {
        const provider = new GroqProvider(mockWorkspace());
        expect(provider.name).toBe('Groq (Llama 3.3 70B)');
    });

    it('throws when generating without API key', async () => {
        const provider = new GroqProvider(mockWorkspace());
        await expect(provider.generate('sys', 'user')).rejects.toThrow('No Groq API key');
    });
});
