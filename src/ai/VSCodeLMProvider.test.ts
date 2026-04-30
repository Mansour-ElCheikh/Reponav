/* eslint-disable import/order */
/**
 * Tests for VSCodeLMProvider — wraps vscode.lm API for zero-BYOK LLM access.
 *
 * Since vscode.lm is only available in the extension host, these tests mock
 * the vscode module. The provider is tested in isolation.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
// Hoisted mocks — vi.mock factory can't reference variables declared after it
const { mockSendRequest, mockSelectChatModels } = vi.hoisted(() => ({
    mockSendRequest: vi.fn(),
    mockSelectChatModels: vi.fn(),
}));

vi.mock('vscode', () => ({
    lm: {
        selectChatModels: mockSelectChatModels,
    },
    LanguageModelChatMessage: {
        User: (content: string) => ({ role: 'user', content }),
    },
    LanguageModelTextPart: class {
        value: string;
        constructor(v: string) { this.value = v; }
    },
    CancellationTokenSource: class {
        token = {};
        cancel() {}
        dispose() {}
    },
    LanguageModelError: class extends Error {
        code: string;
        constructor(message: string, code = 'unknown') { super(message); this.code = code; }
    },
}));

import { VSCodeLMProvider } from './VSCodeLMProvider';

describe('VSCodeLMProvider', () => {
    let provider: VSCodeLMProvider;

    beforeEach(() => {
        vi.clearAllMocks();
        provider = new VSCodeLMProvider();
    });

    describe('isConfigured', () => {
        it('returns true when models are available', async () => {
            mockSelectChatModels.mockResolvedValue([{ id: 'model-1', name: 'Test Model' }]);
            const result = await provider.checkAvailability();
            expect(result).toBe(true);
        });

        it('returns false when no models available', async () => {
            mockSelectChatModels.mockResolvedValue([]);
            const result = await provider.checkAvailability();
            expect(result).toBe(false);
        });

        it('returns false on error', async () => {
            mockSelectChatModels.mockRejectedValue(new Error('not available'));
            const result = await provider.checkAvailability();
            expect(result).toBe(false);
        });
    });

    describe('generate', () => {
        it('returns text from streaming response', async () => {
            const mockModel = {
                id: 'copilot-gpt4o',
                name: 'GPT-4o',
                sendRequest: mockSendRequest,
            };
            mockSelectChatModels.mockResolvedValue([mockModel]);

            // Simulate streaming response via async iterable
            async function* textStream() {
                yield 'Hello ';
                yield 'world';
            }
            mockSendRequest.mockResolvedValue({ text: textStream() });

            const response = await provider.generate('system prompt', 'user prompt');
            expect(response.text).toBe('Hello world');
            expect(response.finishReason).toBe('stop');
        });

        it('reuses a recent model selection instead of querying models again', async () => {
            let now = 1_000;
            provider = new VSCodeLMProvider(undefined, () => now, 30_000);

            const mockModel = {
                id: 'copilot-gpt4o',
                name: 'GPT-4o',
                sendRequest: mockSendRequest,
            };
            mockSelectChatModels.mockResolvedValue([mockModel]);

            async function* textStream() { yield 'ok'; }
            mockSendRequest.mockResolvedValue({ text: textStream() });

            await provider.generate('system prompt', 'first request');
            now += 1_000;
            await provider.generate('system prompt', 'second request');

            expect(mockSelectChatModels).toHaveBeenCalledTimes(1);
            expect(mockSendRequest).toHaveBeenCalledTimes(2);
        });

        it('refreshes the model selection after the cache expires', async () => {
            let now = 1_000;
            provider = new VSCodeLMProvider(undefined, () => now, 50);

            const mockModel = {
                id: 'copilot-gpt4o',
                name: 'GPT-4o',
                sendRequest: mockSendRequest,
            };
            mockSelectChatModels.mockResolvedValue([mockModel]);

            async function* textStream() { yield 'ok'; }
            mockSendRequest.mockResolvedValue({ text: textStream() });

            await provider.generate('system prompt', 'first request');
            now += 100;
            await provider.generate('system prompt', 'second request');

            expect(mockSelectChatModels).toHaveBeenCalledTimes(2);
        });

        it('throws when no models available', async () => {
            mockSelectChatModels.mockResolvedValue([]);
            await expect(provider.generate('sys', 'user')).rejects.toThrow('No language models available');
        });

        it('handles model errors gracefully', async () => {
            const mockModel = {
                id: 'copilot-gpt4o',
                name: 'GPT-4o',
                sendRequest: mockSendRequest,
            };
            mockSelectChatModels.mockResolvedValue([mockModel]);
            mockSendRequest.mockRejectedValue(new Error('Rate limited'));

            await expect(provider.generate('sys', 'user')).rejects.toThrow('Rate limited');
        });

        it('clears the cache when a model request fails so the next call can reselect', async () => {
            let now = 1_000;
            provider = new VSCodeLMProvider(undefined, () => now, 30_000);

            const mockModel = {
                id: 'copilot-gpt4o',
                name: 'GPT-4o',
                sendRequest: mockSendRequest,
            };
            mockSelectChatModels.mockResolvedValue([mockModel]);
            mockSendRequest
                .mockRejectedValueOnce(new Error('Rate limited'))
                .mockResolvedValueOnce({
                    text: (async function* () { yield 'retry ok'; })(),
                });

            await expect(provider.generate('sys', 'user')).rejects.toThrow('Rate limited');
            await expect(provider.generate('sys', 'user')).resolves.toMatchObject({ text: 'retry ok' });

            expect(mockSelectChatModels).toHaveBeenCalledTimes(2);
        });

        it('passes system and user messages correctly', async () => {
            const mockModel = {
                id: 'copilot-gpt4o',
                name: 'GPT-4o',
                sendRequest: mockSendRequest,
            };
            mockSelectChatModels.mockResolvedValue([mockModel]);

            async function* textStream() { yield 'ok'; }
            mockSendRequest.mockResolvedValue({ text: textStream() });

            await provider.generate('be helpful', 'what is this code?');

            expect(mockSendRequest).toHaveBeenCalledOnce();
            const messages = mockSendRequest.mock.calls[0][0];
            expect(messages).toHaveLength(2);
            expect(messages[0].content).toBe('be helpful');
            expect(messages[1].content).toBe('what is this code?');
        });
    });

    describe('name', () => {
        it('is descriptive', () => {
            expect(provider.name).toContain('VS Code');
        });
    });

    describe('isConfigured (sync)', () => {
        it('returns true by default (optimistic)', () => {
            // isConfigured is sync per LLMProvider interface.
            // We can't call async selectChatModels here, so we're optimistic.
            expect(provider.isConfigured()).toBe(true);
        });
    });

    describe('preferredLMFamily', () => {
        function makeWorkspace(family: string) {
            return {
                getWorkspaceRoot: () => '/workspace',
                getConfig: <T>(_s: string, key: string, defaultVal: T): T =>
                    (key === 'preferredLMFamily' ? family as unknown as T : defaultVal),
                findFiles: async () => [],
                readFile: async () => '',
                showInfo: () => {},
                showError: () => {},
            };
        }

        it('selects the preferred family first when available', async () => {
            const claudeModel = { id: 'claude-3-7', family: 'claude', name: 'Claude 3.7', sendRequest: mockSendRequest };
            const gptModel = { id: 'gpt-4o', family: 'gpt-4o', name: 'GPT-4o', sendRequest: mockSendRequest };
            mockSelectChatModels.mockResolvedValue([gptModel, claudeModel]);
            async function* stream() { yield 'ok'; }
            mockSendRequest.mockResolvedValue({ text: stream() });

            provider = new VSCodeLMProvider(makeWorkspace('claude') as any);
            const result = await provider.generate('sys', 'user');
            expect(result.text).toBe('ok');
            // One selectChatModels() call, family preferred client-side
            expect(mockSelectChatModels).toHaveBeenCalledOnce();
            expect(mockSendRequest).toHaveBeenCalledOnce();
        });

        it('falls back to next family when preferred is unavailable', async () => {
            const gptModel = { id: 'gpt-4o', family: 'gpt-4o', name: 'GPT-4o', sendRequest: mockSendRequest };
            mockSelectChatModels.mockResolvedValue([gptModel]);
            async function* stream() { yield 'fallback'; }
            mockSendRequest.mockResolvedValue({ text: stream() });

            provider = new VSCodeLMProvider(makeWorkspace('claude') as any);
            const result = await provider.generate('sys', 'user');
            expect(result.text).toBe('fallback');
            expect(mockSelectChatModels).toHaveBeenCalledOnce();
        });

        it('matches claude when Copilot registers family as claude-3.5-sonnet (prefix match)', async () => {
            // Copilot registers models with family: 'claude-3.5-sonnet' not 'claude'
            const claudeModel = { id: 'claude-3.5-sonnet', family: 'claude-3.5-sonnet', name: 'Claude 3.5 Sonnet', sendRequest: mockSendRequest };
            const gptModel = { id: 'gpt-4o', family: 'gpt-4o', name: 'GPT-4o', sendRequest: mockSendRequest };
            mockSelectChatModels.mockResolvedValue([gptModel, claudeModel]);
            async function* stream() { yield 'claude-response'; }
            mockSendRequest.mockResolvedValue({ text: stream() });

            provider = new VSCodeLMProvider(makeWorkspace('claude') as any);
            const result = await provider.generate('sys', 'user');
            expect(result.text).toBe('claude-response');
            // claude model must have been selected (not gpt-4o), confirmed by modelId
            expect(result.modelId).toBe('claude-3.5-sonnet');
        });

        it('prefers sonnet over opus when preferred family is the bare "claude" prefix', async () => {
            // claude-opus-4.6 appears FIRST in the array (as returned by Copilot)
            // but sonnet is faster and should be preferred when the user just says "claude"
            const opusModel  = { id: 'claude-opus-4.6',   family: 'claude-opus-4.6',   name: 'Claude Opus 4.6',   sendRequest: mockSendRequest };
            const sonnetModel = { id: 'claude-sonnet-4.5', family: 'claude-sonnet-4.5', name: 'Claude Sonnet 4.5', sendRequest: mockSendRequest };
            mockSelectChatModels.mockResolvedValue([opusModel, sonnetModel]);
            async function* stream() { yield 'sonnet-response'; }
            mockSendRequest.mockResolvedValue({ text: stream() });

            provider = new VSCodeLMProvider(makeWorkspace('claude') as any);
            const result = await provider.generate('sys', 'user');
            expect(result.modelId).toBe('claude-sonnet-4.5');
        });

        it('respects an explicit "claude-opus" preference over speed ranking', async () => {
            const opusModel  = { id: 'claude-opus-4.6',   family: 'claude-opus-4.6',   name: 'Claude Opus 4.6',   sendRequest: mockSendRequest };
            const sonnetModel = { id: 'claude-sonnet-4.5', family: 'claude-sonnet-4.5', name: 'Claude Sonnet 4.5', sendRequest: mockSendRequest };
            mockSelectChatModels.mockResolvedValue([sonnetModel, opusModel]);
            async function* stream() { yield 'opus-response'; }
            mockSendRequest.mockResolvedValue({ text: stream() });

            provider = new VSCodeLMProvider(makeWorkspace('claude-opus') as any);
            const result = await provider.generate('sys', 'user');
            expect(result.modelId).toBe('claude-opus-4.6');
        });
    });
});
