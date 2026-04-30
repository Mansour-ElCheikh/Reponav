import { withTimeout } from '../runtime/extensionUtils';
import { logLLMUsage } from '../telemetry/llmUsageLog';
import { WorkspaceAdapter } from '../WorkspaceAdapter';
import { AnthropicProvider } from './AnthropicProvider';
import { GroqProvider } from './GroqProvider';
import { GeminiProvider } from './llmClient';
import { LLMProvider, LLMResponse } from './LLMProvider';
import { MockProvider } from './MockProvider';
import { OpenAIProvider } from './OpenAIProvider';
import { VSCodeLMProvider } from './VSCodeLMProvider';

const AUTO_VSCODE_LM_TIMEOUT_MS = 120_000;

/**
 * A proxy provider that dynamically routes to the currently selected
 * AI provider in workspace settings. This allows provider changes mid-session
 * without requiring a VS Code window reload.
 *
 * In 'auto' mode, the cascade order is:
 *   API-key providers (Groq → Gemini → Anthropic → OpenAI) → VSCodeLMProvider → Mock
 *
 * API-key providers are checked first because:
 * 1. isConfigured() is a sync check (~0ms) — unconfigured providers are skipped instantly
 * 2. Most VS Code forks (Cursor, Antigravity, Windsurf) don't expose their
 *    built-in AI through vscode.lm, so VSCodeLMProvider fails on those forks
 * 3. Users who set an API key explicitly want to use it
 */
export class DynamicLLMProvider implements LLMProvider {
    private cachedProvider: LLMProvider | null = null;
    private cachedSetting: string | null = null;
    private readonly log: (msg: string) => void;

    constructor(private readonly workspace: WorkspaceAdapter, log?: (msg: string) => void) {
        this.log = log ?? ((msg: string) => console.info(msg));
    }

    private getActiveProvider(): LLMProvider {
        const setting = this.workspace.getConfig<string>('reponav', 'aiProvider', 'auto');
        if (this.cachedProvider && this.cachedSetting === setting) {
            return this.cachedProvider;
        }

        this.cachedSetting = setting;
        switch (setting) {
            case 'vscode-lm':
                this.cachedProvider = new VSCodeLMProvider(this.workspace);
                break;
            case 'mock':
                this.cachedProvider = new MockProvider();
                break;
            case 'anthropic':
                this.cachedProvider = new AnthropicProvider(this.workspace);
                break;
            case 'openai':
                this.cachedProvider = new OpenAIProvider(this.workspace);
                break;
            case 'groq':
                this.cachedProvider = new GroqProvider(this.workspace);
                break;
            case 'gemini':
                this.cachedProvider = new GeminiProvider(this.workspace);
                break;
            case 'auto':
                // In auto mode, resolve the best provider immediately.
                this.cachedProvider = this.resolveAutoProvider();
                break;
            default:
                this.cachedProvider = new GeminiProvider(this.workspace);
                break;
        }

        return this.cachedProvider;
    }

    /**
     * Resolve the best provider in auto mode.
     * Cascade: configured API-key providers first, then vscode.lm, then mock.
     * isConfigured() is sync (~0ms) so unconfigured providers are skipped instantly.
     */
    private resolveAutoProvider(): LLMProvider {
        const candidates: LLMProvider[] = [
            new GroqProvider(this.workspace),
            new GeminiProvider(this.workspace),
            new AnthropicProvider(this.workspace),
            new OpenAIProvider(this.workspace),
        ];

        for (const provider of candidates) {
            if (provider.isConfigured()) {
                this.log(`[LLM][auto] selected ${provider.name} (API key configured)`);
                return provider;
            }
        }

        // No API keys configured — try vscode.lm (works in VS Code + Copilot)
        this.log('[LLM][auto] no API keys configured, falling back to VS Code LM');
        return new VSCodeLMProvider(this.workspace);
    }

    /**
     * Build the fallback cascade (providers NOT yet tried).
     * Used when the primary auto-selected provider fails.
     */
    private buildFallbackCascade(excludeName: string): LLMProvider[] {
        const allCandidates: LLMProvider[] = [
            new GroqProvider(this.workspace),
            new GeminiProvider(this.workspace),
            new AnthropicProvider(this.workspace),
            new OpenAIProvider(this.workspace),
        ];
        // Include configured providers we haven't tried yet
        const remaining = allCandidates.filter((p) => p.isConfigured() && p.name !== excludeName);
        // Always include vscode.lm as a last resort if it wasn't the primary
        if (excludeName !== 'VS Code Language Model') {
            remaining.push(new VSCodeLMProvider(this.workspace));
        }
        // Final terminator: MockProvider always succeeds and returns a deterministic
        // structural response so callers never see a raw provider error in auto mode.
        remaining.push(new MockProvider());
        return remaining;
    }

    get name(): string {
        return this.getActiveProvider().name;
    }

    isConfigured(): boolean {
        // In 'auto' mode, always return true — the cascade will find a provider.
        if (this.cachedSetting === 'auto' || this.workspace.getConfig<string>('reponav', 'aiProvider', 'auto') === 'auto') {
            return true;
        }
        return this.getActiveProvider().isConfigured();
    }

    async generate(systemPrompt: string, userPrompt: string): Promise<LLMResponse> {
        const provider = this.getActiveProvider();
        const mode = this.cachedSetting ?? 'unknown';
        const candidatesTried: string[] = [provider.name];
        const t0 = Date.now();
        try {
            this.log(`[LLM] generate: trying ${provider.name}`);
            const response = mode === 'auto' && provider instanceof VSCodeLMProvider
                ? await withTimeout(
                    provider.generate(systemPrompt, userPrompt),
                    AUTO_VSCODE_LM_TIMEOUT_MS,
                    'VS Code LM auto mode',
                  )
                : await provider.generate(systemPrompt, userPrompt);
            logLLMUsage({
                provider: provider.name,
                model: response.modelId,
                promptTokens: response.usage?.promptTokens,
                completionTokens: response.usage?.completionTokens,
                totalTokens: response.usage?.totalTokens,
                durationMs: Date.now() - t0,
                callerTool: 'generate',
                mode,
                chosen: provider.name,
                candidatesTried,
            });
            return response;
        } catch (error) {
            if (this.cachedSetting === 'auto') {
                const cascade = this.buildFallbackCascade(provider.name);
                this.log(`[LLM] ${provider.name} failed (${(error as Error)?.message ?? error}), trying ${cascade.length} fallback provider(s)`);

                for (const fallback of cascade) {
                    try {
                        candidatesTried.push(fallback.name);
                        this.log(`[LLM] trying fallback: ${fallback.name}`);
                        const result = await fallback.generate(systemPrompt, userPrompt);
                        // Cache the working provider so subsequent calls skip the cascade.
                        this.cachedProvider = fallback;
                        logLLMUsage({
                            provider: fallback.name,
                            model: result.modelId,
                            promptTokens: result.usage?.promptTokens,
                            completionTokens: result.usage?.completionTokens,
                            totalTokens: result.usage?.totalTokens,
                            durationMs: Date.now() - t0,
                            callerTool: 'generate',
                            mode,
                            chosen: fallback.name,
                            candidatesTried,
                        });
                        return result;
                    } catch (fallbackError) {
                        this.log(`[LLM] fallback ${fallback.name} also failed: ${(fallbackError as Error)?.message}`);
                    }
                }

                this.log('[LLM] all fallback providers exhausted');
            }
            logLLMUsage({
                provider: provider.name,
                durationMs: Date.now() - t0,
                callerTool: 'generate',
                mode,
                candidatesTried,
                cascadeFailed: true,
                error: (error as Error)?.message ?? String(error),
            });
            throw error;
        }
    }

    async *generateStream(systemPrompt: string, userPrompt: string) {
        const provider = this.getActiveProvider();
        const mode = this.cachedSetting ?? 'unknown';

        if (this.cachedSetting === 'auto') {
            // Try the primary provider first.
            // Use generate() (one-shot) for the primary attempt to avoid
            // yield* async generator edge cases in try/catch.
            // Then yield the full text as a single chunk — the stream parser
            // handles one-shot JSON correctly.
            const candidatesTried: string[] = [provider.name];
            const t0 = Date.now();
            try {
                this.log(`[LLM] stream: trying ${provider.name}`);
                const response = await provider.generate(systemPrompt, userPrompt);
                this.log(`[LLM] stream: ${provider.name} succeeded (${response.text.length} chars)`);
                logLLMUsage({
                    provider: provider.name,
                    model: response.modelId,
                    promptTokens: response.usage?.promptTokens,
                    completionTokens: response.usage?.completionTokens,
                    totalTokens: response.usage?.totalTokens,
                    durationMs: Date.now() - t0,
                    callerTool: 'stream',
                    mode,
                    chosen: provider.name,
                    candidatesTried,
                });
                yield response.text;
                return;
            } catch (error) {
                this.log(`[LLM] stream: ${provider.name} failed (${(error as Error)?.message}), cascading`);
                const cascade = this.buildFallbackCascade(provider.name);

                for (const fallback of cascade) {
                    try {
                        candidatesTried.push(fallback.name);
                        this.log(`[LLM] stream: trying fallback ${fallback.name}`);
                        const response = await fallback.generate(systemPrompt, userPrompt);
                        this.log(`[LLM] stream: fallback ${fallback.name} succeeded (${response.text.length} chars)`);
                        this.cachedProvider = fallback;
                        logLLMUsage({
                            provider: fallback.name,
                            model: response.modelId,
                            promptTokens: response.usage?.promptTokens,
                            completionTokens: response.usage?.completionTokens,
                            totalTokens: response.usage?.totalTokens,
                            durationMs: Date.now() - t0,
                            callerTool: 'stream',
                            mode,
                            chosen: fallback.name,
                            candidatesTried,
                        });
                        yield response.text;
                        return;
                    } catch (fallbackError) {
                        this.log(`[LLM] stream: fallback ${fallback.name} failed: ${(fallbackError as Error)?.message}`);
                    }
                }

                logLLMUsage({
                    provider: provider.name,
                    durationMs: Date.now() - t0,
                    callerTool: 'stream',
                    mode,
                    candidatesTried,
                    cascadeFailed: true,
                    error: (error as Error)?.message ?? String(error),
                });
                // All providers exhausted — re-throw original error
                throw error;
            }
        }

        // Non-auto mode: use the selected provider directly
        const t0 = Date.now();
        if (provider.generateStream) {
            yield* provider.generateStream(systemPrompt, userPrompt);
            logLLMUsage({
                provider: provider.name,
                durationMs: Date.now() - t0,
                callerTool: 'stream',
                mode,
                chosen: provider.name,
                candidatesTried: [provider.name],
            });
            return;
        }

        const response = await provider.generate(systemPrompt, userPrompt);
        logLLMUsage({
            provider: provider.name,
            model: response.modelId,
            promptTokens: response.usage?.promptTokens,
            completionTokens: response.usage?.completionTokens,
            totalTokens: response.usage?.totalTokens,
            durationMs: Date.now() - t0,
            callerTool: 'stream',
            mode,
            chosen: provider.name,
            candidatesTried: [provider.name],
        });
        yield response.text;
    }
}
