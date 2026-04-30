/**
 * LLMProvider Interface
 *
 * All tour generation logic depends ONLY on this interface — never on a
 * specific AI SDK.  Concrete implementations (Gemini, OpenAI, Ollama, …)
 * live alongside this file and are wired in extension.ts.
 */

// ─── Normalized Response ─────────────────────────────────────────────────────

export type FinishReason = 'stop' | 'length' | 'content_filter' | 'error' | 'unknown';

export interface LLMTokenUsage {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
}

export interface LLMResponse {
    text: string;
    finishReason: FinishReason;
    usage?: LLMTokenUsage;
    /** The specific model ID that produced the response, if available. */
    modelId?: string;
}

// ─── Provider Contract ───────────────────────────────────────────────────────

export interface LLMProvider {
    /** Human-readable name used for logging / UI (e.g. "Gemini 2.0 Flash"). */
    readonly name: string;

    /** Whether the provider is ready to accept requests. */
    isConfigured(): boolean;

    /** One-shot generation. */
    generate(systemPrompt: string, userPrompt: string): Promise<LLMResponse>;

    /** Streaming generation (optional — falls back to one-shot if not implemented). */
    generateStream?(
        systemPrompt: string,
        userPrompt: string
    ): AsyncGenerator<string, void, unknown>;
}
