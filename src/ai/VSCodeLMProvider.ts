/**
 * VSCodeLMProvider — zero-BYOK LLM access via VS Code's Language Model API.
 *
 * Uses vscode.lm.selectChatModels() to discover models registered by any
 * extension (Copilot, Claude, etc.). Model-agnostic: works with any provider
 * that registers a LanguageModelChat.
 *
 * This file imports vscode — it must be listed in governance.yaml R1 approved files.
 */

import * as vscode from 'vscode';
import type { WorkspaceAdapter } from '../WorkspaceAdapter';
import { LLMProvider, LLMResponse } from './LLMProvider';

/** Fallback families tried in order when the preferred family is unavailable. */
const FALLBACK_FAMILIES = ['claude', 'gpt-4o', 'gemini'];

/**
 * Speed-rank a model family string. Lower = faster / more preferred.
 * Used to break ties when multiple models match the same family prefix
 * (e.g. both claude-sonnet-4.5 and claude-opus-4.6 match the "claude" prefix).
 */
export function modelSpeedScore(family: string): number {
    if (family.includes('haiku'))  return 1;
    if (family.includes('sonnet')) return 2;
    if (family.includes('flash'))  return 3; // Gemini Flash
    if (family.includes('mini'))   return 4; // GPT-4o-mini
    if (family.includes('opus'))   return 99; // slowest — deprioritize
    return 50; // unknown
}

/** Provider implementation that routes requests through VS Code's LM API. */
export class VSCodeLMProvider implements LLMProvider {
    readonly name = 'VS Code Language Model';
    private cachedModel: vscode.LanguageModelChat | null = null;
    private cachedAtMs = 0;
    private selectionPromise: Promise<vscode.LanguageModelChat | null> | null = null;

    constructor(
        private readonly workspace?: WorkspaceAdapter,
        private readonly now: () => number = () => Date.now(),
        private readonly cacheTtlMs: number = 30_000
    ) {}

    /**
     * Sync check — returns true optimistically. The real availability check
     * is async (selectChatModels), which can't be called from the sync interface.
     * Use checkAvailability() for accurate async detection.
     */
    isConfigured(): boolean {
        return true;
    }

    /**
     * Async availability check — returns true if at least one LM is registered.
     */
    async checkAvailability(): Promise<boolean> {
        try {
            const model = await this.getSelectedModel();
            return model !== null;
        } catch {
            return false;
        }
    }

    /**
     * Send a generation request to the first available language model.
     * Collects the streaming response into a single string.
     */
    async generate(systemPrompt: string, userPrompt: string): Promise<LLMResponse> {
        const model = await this.getSelectedModel();
        if (!model) {
            throw new Error('No language models available via VS Code. Install GitHub Copilot or another LM extension.');
        }

        const messages = [
            vscode.LanguageModelChatMessage.User(systemPrompt),
            vscode.LanguageModelChatMessage.User(userPrompt),
        ];

        let response;
        try {
            response = await model.sendRequest(
                messages,
                { justification: 'RepoNav: generate architecture tour narration for your codebase' },
                new vscode.CancellationTokenSource().token
            );
        } catch (error) {
            this.clearModelCache();
            const code = error instanceof vscode.LanguageModelError ? error.code : 'unknown';
            console.warn(`[RepoNav][vscode-lm] sendRequest failed (code=${code}):`, (error as Error).message);
            throw error;
        }

        // Collect streaming text into a single string
        const parts: string[] = [];
        for await (const chunk of response.text) {
            parts.push(chunk);
        }

        return {
            text: parts.join(''),
            finishReason: 'stop',
            modelId: model.id,
        };
    }

    /**
     * Stream raw text chunks from the VS Code LM API.
     * Yields each token fragment as it arrives — callers accumulate into NDJSON lines.
     */
    async *generateStream(systemPrompt: string, userPrompt: string): AsyncGenerator<string, void, unknown> {
        const model = await this.getSelectedModel();
        if (!model) {
            throw new Error('No language models available via VS Code. Install GitHub Copilot or another LM extension.');
        }

        const messages = [
            vscode.LanguageModelChatMessage.User(systemPrompt),
            vscode.LanguageModelChatMessage.User(userPrompt),
        ];

        let response;
        try {
            response = await model.sendRequest(
                messages,
                { justification: 'RepoNav: stream architecture tour narration for your codebase' },
                new vscode.CancellationTokenSource().token
            );
        } catch (error) {
            this.clearModelCache();
            const code = error instanceof vscode.LanguageModelError ? error.code : 'unknown';
            console.warn(`[RepoNav][vscode-lm] generateStream sendRequest failed (code=${code}):`, (error as Error).message);
            throw error;
        }

        for await (const chunk of response.text) {
            yield chunk;
        }
    }

    private async getSelectedModel(): Promise<vscode.LanguageModelChat | null> {
        if (this.cachedModel && (this.now() - this.cachedAtMs) < this.cacheTtlMs) {
            return this.cachedModel;
        }

        if (this.selectionPromise) {
            return this.selectionPromise;
        }

        this.selectionPromise = this._selectModel()
            .then((model) => {
                if (model) {
                    this.cachedModel = model;
                    this.cachedAtMs = this.now();
                } else {
                    this.clearModelCache();
                }
                return model;
            })
            .catch((error) => {
                this.clearModelCache();
                throw error;
            })
            .finally(() => {
                this.selectionPromise = null;
            });

        return this.selectionPromise;
    }

    /**
     * Select a model using the configured preference, then the fallback chain,
     * then any available model as a last resort.
     *
     * Uses a single selectChatModels() call and filters client-side to avoid
     * multiple sequential API calls (each can take ~4s) exceeding the 15s budget.
     */
    private async _selectModel(): Promise<vscode.LanguageModelChat | null> {
        const preferred = this.workspace?.getConfig<string>('reponav', 'preferredLMFamily', 'claude') ?? 'claude';
        const families = [preferred, ...FALLBACK_FAMILIES.filter((f) => f !== preferred)];

        const all = await vscode.lm.selectChatModels();
        if (all.length === 0) return null;

        console.info('[RepoNav][vscode-lm] available models:', all.map((m) => ({ id: m.id, family: m.family, name: m.name })));

        const logSelected = (model: vscode.LanguageModelChat, reason: string) => {
            console.info(`[RepoNav][vscode-lm] selected model: ${model.id} (family=${model.family}, reason=${reason})`);
            return model;
        };

        for (const family of families) {
            // Copilot registers models with specific family strings like 'claude-3.5-sonnet'
            // rather than the bare prefix 'claude'. Try exact match first so an explicit
            // preference like 'claude-opus' is honored without speed-ranking interference.
            const exactMatch = all.find((m) => m.family === family);
            if (exactMatch) return logSelected(exactMatch, `exact:${family}`);

            // Prefix match — when the user says 'claude', any 'claude-*' qualifies.
            // Among candidates, prefer faster models (sonnet/haiku before opus).
            const prefixMatches = all.filter((m) => m.family?.startsWith(family + '-'));
            if (prefixMatches.length > 0) {
                prefixMatches.sort((a, b) => modelSpeedScore(a.family) - modelSpeedScore(b.family));
                return logSelected(prefixMatches[0], `prefix:${family}`);
            }
        }

        return logSelected(all[0], 'fallback:any');
    }

    private clearModelCache(): void {
        this.cachedModel = null;
        this.cachedAtMs = 0;
    }
}
