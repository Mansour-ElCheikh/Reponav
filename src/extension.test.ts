/* eslint-disable import/order */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
    aiProvider: 'groq',
    registeredCommands: [] as string[],
    providerCtorCounts: {} as Record<string, number>,
    repoDbOpen: vi.fn().mockResolvedValue(undefined),
    repoDbClose: vi.fn(),
    webviewShow: vi.fn(),
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
            return { text: `${providerId}-generated`, finishReason: 'stop' };
        }

        async *generateStream(): AsyncGenerator<string, void, unknown> {
            yield `${providerId}-stream`;
        }
    };
}

vi.mock('vscode', () => {
    return {
        window: {
            createOutputChannel: vi.fn(() => ({
                appendLine: vi.fn(),
                show: vi.fn(),
            })),
            createStatusBarItem: vi.fn(() => ({
                text: '',
                tooltip: '',
                command: undefined,
                show: vi.fn(),
                dispose: vi.fn(),
            })),
            showQuickPick: vi.fn(),
            showInputBox: vi.fn(),
            withProgress: vi.fn(),
            showInformationMessage: vi.fn(),
            showWarningMessage: vi.fn(),
            showErrorMessage: vi.fn(),
        },
        commands: {
            registerCommand: vi.fn((commandId: string, _handler: (...args: unknown[]) => unknown) => {
                state.registeredCommands.push(commandId);
                return { dispose: vi.fn() };
            }),
            executeCommand: vi.fn(),
            getCommands: vi.fn(async () => state.registeredCommands),
        },
        workspace: {},
        StatusBarAlignment: { Right: 1 },
        ProgressLocation: { Notification: 1 },
        ExtensionMode: {
            Production: 1,
            Development: 2,
            Test: 3,
        },
    };
});

vi.mock('./VSCodeWorkspaceAdapter', () => {
    return {
        VSCodeWorkspaceAdapter: class {
            getWorkspaceRoot() {
                return '/workspace';
            }

            getConfig<T>(_section: string, key: string, defaultValue: T): T {
                if (key === 'aiProvider') {
                    return state.aiProvider as T;
                }
                return defaultValue;
            }

            findFiles = vi.fn(async () => []);
            readFile = vi.fn(async () => '');
            showInfo = vi.fn();
            showError = vi.fn();
        },
        VSCodeDocumentSymbolEnricher: class {
            enrichSymbols = vi.fn(async () => []);
        },
    };
});

vi.mock('./webview/webviewProvider', () => {
    return {
        RepoNavWebviewProvider: class {
            generateAndShowTour = vi.fn(async () => undefined);
            show = state.webviewShow;
        },
    };
});

vi.mock('./ai/tourGenerator', () => {
    return {
        TourGenerator: class {},
    };
});

vi.mock('./db/RepoDatabase', () => {
    return {
        RepoDatabase: class {
            open = state.repoDbOpen;
            close = state.repoDbClose;
        },
    };
});

vi.mock('./VSCodeGitProvider', () => {
    return {
        VSCodeGitProvider: class {},
    };
});

vi.mock('./ai/llmClient', () => {
    class GeminiProvider {
        readonly name = 'gemini';

        constructor(_workspace?: unknown) {
            incrementProviderCtor('gemini');
        }

        isConfigured(): boolean {
            return true;
        }

        async generate(): Promise<{ text: string; finishReason: 'stop' }> {
            return { text: 'gemini-generated', finishReason: 'stop' };
        }
    }

    return { GeminiProvider };
});

vi.mock('./ai/AnthropicProvider', () => ({ AnthropicProvider: buildProviderClass('anthropic') }));
vi.mock('./ai/OpenAIProvider', () => ({ OpenAIProvider: buildProviderClass('openai') }));
vi.mock('./ai/GroqProvider', () => ({ GroqProvider: buildProviderClass('groq') }));
vi.mock('./ai/MockProvider', () => ({ MockProvider: buildProviderClass('mock') }));

import * as vscode from 'vscode';
import { activate, deactivate, REQUIRED_COMMAND_IDS } from './extension';

describe('activate', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        state.aiProvider = 'groq';
        state.registeredCommands = [];
        state.providerCtorCounts = {};
        state.repoDbOpen.mockClear();
        state.repoDbClose.mockClear();
        state.webviewShow.mockClear();
        vi.clearAllMocks();
    });

    it('registers required commands and defers database wiring off the activation path', () => {
        const context = {
            subscriptions: [] as Array<{ dispose(): void }>,
            extensionPath: '/extension-root',
            extensionUri: {},
            extensionMode: vscode.ExtensionMode.Production,
            extension: {
                packageJSON: {
                    version: '0.1.0',
                },
            },
        } as any;

        activate(context);

        expect(vscode.commands.registerCommand).toHaveBeenCalledTimes(REQUIRED_COMMAND_IDS.length);
        expect(state.registeredCommands.sort()).toEqual([...REQUIRED_COMMAND_IDS].sort());
        expect(state.repoDbOpen).not.toHaveBeenCalled();

        vi.advanceTimersByTime(15_000);
        expect(state.repoDbOpen).toHaveBeenCalledTimes(1);

        deactivate();
        expect(state.repoDbClose).toHaveBeenCalledTimes(1);
    });

    it('auto-opens the panel in development mode so F5 lands in RepoNav directly', () => {
        const context = {
            subscriptions: [] as Array<{ dispose(): void }>,
            extensionPath: '/extension-root',
            extensionUri: {},
            extensionMode: vscode.ExtensionMode.Development,
            extension: {
                packageJSON: {
                    version: '0.1.0',
                },
            },
        } as any;

        activate(context);

        expect(state.webviewShow).not.toHaveBeenCalled();

        vi.advanceTimersByTime(250);
        expect(state.webviewShow).toHaveBeenCalledTimes(1);
    });
});
