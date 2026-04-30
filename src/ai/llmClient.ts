/**
 * LLM Client — Gemini API Implementation
 *
 * Concrete implementation of LLMProvider using Google Gemini.
 * All vscode-specific configuration reading is delegated to a
 * WorkspaceAdapter so this class remains testable.
 */

import type { GenerativeModel } from '@google/generative-ai';
import { WorkspaceAdapter } from '../WorkspaceAdapter';
import { LLMProvider, LLMResponse, FinishReason } from './LLMProvider';

/** Gemini-backed provider implementation for direct BYOK generation requests. */
export class GeminiProvider implements LLMProvider {
    readonly name = 'Gemini 2.0 Flash';
    private model: GenerativeModel | null = null;

    constructor(private readonly workspace: WorkspaceAdapter) { }

    /**
     * Initialize or re-initialize the Gemini model with the current API key.
     * Lazy-loads the SDK so it is not parsed at extension activation.
     */
    private async getModel(): Promise<GenerativeModel> {
        const apiKey = this.workspace.getConfig<string>('reponav', 'geminiApiKey', '');

        if (!apiKey) {
            throw new Error(
                'No Gemini API key configured. Set it in Settings → RepoNav → Gemini API Key'
            );
        }

        const { GoogleGenerativeAI } = await import('@google/generative-ai');
        const genAI = new GoogleGenerativeAI(apiKey);
        this.model = genAI.getGenerativeModel({
            model: 'gemini-2.0-flash',
            generationConfig: {
                temperature: 0.3,
                topP: 0.8,
                maxOutputTokens: 8192,
                responseMimeType: 'application/json',
            },
        });

        return this.model;
    }

    isConfigured(): boolean {
        const apiKey = this.workspace.getConfig<string>('reponav', 'geminiApiKey', '');
        return !!apiKey;
    }

    async generate(systemPrompt: string, userPrompt: string): Promise<LLMResponse> {
        const model = await this.getModel();

        const result = await model.generateContent({
            contents: [
                {
                    role: 'user',
                    parts: [
                        { text: `${systemPrompt}\n\n---\n\n${userPrompt}` },
                    ],
                },
            ],
        });

        const response = result.response;
        const text = response.text();
        const usage = response.usageMetadata;

        // Map Gemini finish reason to our normalized type
        let finishReason: FinishReason = 'unknown';
        const candidates = response.candidates;
        if (candidates && candidates.length > 0) {
            const raw = candidates[0].finishReason;
            if (raw === 'STOP') finishReason = 'stop';
            else if (raw === 'MAX_TOKENS') finishReason = 'length';
            else if (raw === 'SAFETY') finishReason = 'content_filter';
        }

        return {
            text,
            finishReason,
            usage: usage
                ? {
                    promptTokens: usage.promptTokenCount,
                    completionTokens: usage.candidatesTokenCount,
                    totalTokens: usage.totalTokenCount,
                }
                : undefined,
        };
    }

    async *generateStream(
        systemPrompt: string,
        userPrompt: string
    ): AsyncGenerator<string, void, unknown> {
        const model = await this.getModel();

        const result = await model.generateContentStream({
            contents: [
                {
                    role: 'user',
                    parts: [
                        { text: `${systemPrompt}\n\n---\n\n${userPrompt}` },
                    ],
                },
            ],
        });

        for await (const chunk of result.stream) {
            const text = chunk.text();
            if (text) {
                yield text;
            }
        }
    }
}
