import { describe, expect, it } from 'vitest';
import type { WorkspaceAdapter } from '../WorkspaceAdapter';
import { BaseProvider } from './BaseProvider';
import type { FinishReason, LLMResponse } from './LLMProvider';

function mockWorkspace(config: Record<string, string> = {}): WorkspaceAdapter {
    return {
        getWorkspaceRoot: () => '/workspace',
        getConfig: <T>(_section: string, key: string, defaultValue: T): T =>
            (config[key] as unknown as T) ?? defaultValue,
        readFile: async () => null,
        findFiles: async () => [],
        showInfo: () => {},
        showError: () => {},
    } as WorkspaceAdapter;
}

class TestProvider extends BaseProvider {
    readonly name = 'Test Provider';
    protected readonly configKey = 'apiKey';
    protected readonly missingConfigMessage = 'Missing API key';

    async generate(): Promise<LLMResponse> {
        return { text: 'ok', finishReason: 'stop' };
    }

    readConfigValue(key: string): string {
        return this.getConfigValue(key);
    }

    requireConfigValue(key: string, message: string): string {
        return this.getRequiredConfigValue(key, message);
    }

    mapReason(reason: unknown): FinishReason {
        return this.mapOpenAIFinishReason(reason);
    }
}

describe('BaseProvider', () => {
    it('treats blank config values as unconfigured after trimming', () => {
        expect(new TestProvider(mockWorkspace({ apiKey: '   ' })).isConfigured()).toBe(false);
        expect(new TestProvider(mockWorkspace({ apiKey: '  token  ' })).isConfigured()).toBe(true);
    });

    it('returns trimmed required config values and throws when missing', () => {
        const configured = new TestProvider(mockWorkspace({ apiKey: '  token  ' }));
        expect(configured.readConfigValue('apiKey')).toBe('token');
        expect(configured.requireConfigValue('apiKey', 'Missing token')).toBe('token');

        const unconfigured = new TestProvider(mockWorkspace({ apiKey: '   ' }));
        expect(() => unconfigured.requireConfigValue('apiKey', 'Missing token')).toThrow('Missing token');
    });

    it.each<readonly [unknown, FinishReason]>([
        ['stop', 'stop'],
        ['length', 'length'],
        ['content_filter', 'content_filter'],
        ['other', 'unknown'],
        [undefined, 'unknown'],
    ])('maps OpenAI finish reason %s to %s', (reason, expected) => {
        const provider = new TestProvider(mockWorkspace());
        expect(provider.mapReason(reason)).toBe(expected);
    });
});