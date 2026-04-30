import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DynamicLLMProvider } from './DynamicLLMProvider';

const state = vi.hoisted(() => ({
    aiProvider: 'groq',
    providerCtorCounts: {} as Record<string, number>,
    providerErrors: {} as Record<string, Error>,
}));

function incrementProviderCtor(providerId: string) {
    state.providerCtorCounts[providerId] = (state.providerCtorCounts[providerId] || 0) + 1;
}

function buildProviderClass(providerId: string) {
    return class {
        readonly name = providerId;

        constructor(_workspace?: unknown) {
            incrementProviderCtor(providerId);
        }

        isConfigured(): boolean {
            return true;
        }

        async generate(): Promise<{ text: string; finishReason: 'stop' }> {
            const err = state.providerErrors[providerId];
            if (err) throw err;
            return { text: `${providerId}-generated`, finishReason: 'stop' };
        }

        async *generateStream(): AsyncGenerator<string, void, unknown> {
            yield `${providerId}-stream`;
        }
    };
}

vi.mock('./llmClient', () => {
    class GeminiProvider {
        readonly name = 'gemini';

        constructor(_workspace?: unknown) {
            incrementProviderCtor('gemini');
        }

        isConfigured(): boolean {
            return true;
        }

        async generate(): Promise<{ text: string; finishReason: 'stop' }> {
            const err = state.providerErrors['gemini'];
            if (err) throw err;
            return { text: 'gemini-generated', finishReason: 'stop' };
        }
    }

    return { GeminiProvider };
});

vi.mock('./AnthropicProvider', () => ({ AnthropicProvider: buildProviderClass('anthropic') }));
vi.mock('./OpenAIProvider', () => ({ OpenAIProvider: buildProviderClass('openai') }));
vi.mock('./GroqProvider', () => ({ GroqProvider: buildProviderClass('groq') }));
vi.mock('./MockProvider', () => ({ MockProvider: buildProviderClass('mock') }));
vi.mock('./VSCodeLMProvider', () => ({ VSCodeLMProvider: buildProviderClass('VS Code Language Model') }));

describe('DynamicLLMProvider', () => {
    beforeEach(() => {
        state.aiProvider = 'groq';
        state.providerCtorCounts = {};
        state.providerErrors = {};
    });

    it('caches provider instances per active setting and switches when setting changes', async () => {
        const workspace = {
            getConfig: <T>(_section: string, key: string, defaultValue: T): T => {
                if (key === 'aiProvider') return state.aiProvider as T;
                return defaultValue;
            },
        };

        const provider = new DynamicLLMProvider(workspace as any);

        expect(provider.name).toBe('groq');
        expect(state.providerCtorCounts.groq).toBe(1);

        await provider.generate('sys', 'user');
        expect(state.providerCtorCounts.groq).toBe(1);

        state.aiProvider = 'openai';
        expect(provider.name).toBe('openai');
        expect(state.providerCtorCounts.openai).toBe(1);
    });

    it('falls back to gemini and streams via one-shot response when stream is unavailable', async () => {
        state.aiProvider = 'unknown-provider';

        const workspace = {
            getConfig: <T>(_section: string, key: string, defaultValue: T): T => {
                if (key === 'aiProvider') return state.aiProvider as T;
                return defaultValue;
            },
        };

        const provider = new DynamicLLMProvider(workspace as any);
        const chunks: string[] = [];

        for await (const chunk of provider.generateStream('sys', 'user')) {
            chunks.push(chunk);
        }

        expect(provider.name).toBe('gemini');
        expect(chunks.join('')).toBe('gemini-generated');
        expect(state.providerCtorCounts.gemini).toBe(1);
    });

    describe('cascade exhaustion (auto mode)', () => {
        const allRealProviderErrors = () => ({
            groq: new Error('groq unavailable'),
            gemini: new Error('gemini unavailable'),
            anthropic: new Error('anthropic unavailable'),
            openai: new Error('openai unavailable'),
            'VS Code Language Model': new Error('vscode lm unavailable'),
        });

        const autoWorkspace = () => ({
            getConfig: <T>(_section: string, key: string, defaultValue: T): T => {
                if (key === 'aiProvider') return 'auto' as T;
                return defaultValue;
            },
        });

        it('generate() returns MockProvider output when all real providers fail', async () => {
            state.aiProvider = 'auto';
            state.providerErrors = allRealProviderErrors();

            const provider = new DynamicLLMProvider(autoWorkspace() as any);
            const result = await provider.generate('sys', 'user');

            expect(result.text).toBe('mock-generated');
        });

        it('generateStream() yields MockProvider output when all real providers fail', async () => {
            state.aiProvider = 'auto';
            state.providerErrors = allRealProviderErrors();

            const provider = new DynamicLLMProvider(autoWorkspace() as any);
            const chunks: string[] = [];

            for await (const chunk of provider.generateStream('sys', 'user')) {
                chunks.push(chunk);
            }

            expect(chunks.join('')).toBe('mock-generated');
        });
    });
});
