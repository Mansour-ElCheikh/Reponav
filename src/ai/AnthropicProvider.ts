import type { Anthropic } from '@anthropic-ai/sdk';
import { WorkspaceAdapter } from '../WorkspaceAdapter';
import { BaseProvider } from './BaseProvider';
import { LLMResponse, FinishReason } from './LLMProvider';

/** Anthropic-backed provider implementation used for BYOK Claude requests. */
export class AnthropicProvider extends BaseProvider {
    readonly name = 'Claude 3.5 Sonnet';
    protected readonly configKey = 'anthropicApiKey';
    protected readonly missingConfigMessage = 'No Anthropic API key configured. Set it in Settings → RepoNav → Anthropic API Key';
    private client: Anthropic | null = null;

    constructor(workspace: WorkspaceAdapter) {
        super(workspace);
    }

    private async getClient(): Promise<Anthropic> {
        const apiKey = this.getRequiredConfigValue(this.configKey, this.missingConfigMessage);
        // Lazy-load SDK so it is not parsed at extension activation.
        const { Anthropic: AnthropicSDK } = await import('@anthropic-ai/sdk');
        this.client = new AnthropicSDK({ apiKey });
        return this.client;
    }

    async generate(systemPrompt: string, userPrompt: string): Promise<LLMResponse> {
        const client = await this.getClient();

        const response = await client.messages.create({
            model: 'claude-3-5-sonnet-20241022',
            max_tokens: 8192,
            temperature: 0.3,
            system: systemPrompt,
            messages: [{ role: 'user', content: userPrompt }],
        });

        // Extract text
        let text = '';
        if (response.content.length > 0 && response.content[0].type === 'text') {
            text = response.content[0].text;
        }

        // Map Anthropic finish reason
        let finishReason: FinishReason = 'unknown';
        if (response.stop_reason === 'end_turn' || response.stop_reason === 'stop_sequence') {
            finishReason = 'stop';
        } else if (response.stop_reason === 'max_tokens') {
            finishReason = 'length';
        }

        return {
            text,
            finishReason,
            usage: {
                promptTokens: response.usage.input_tokens,
                completionTokens: response.usage.output_tokens,
                totalTokens: response.usage.input_tokens + response.usage.output_tokens,
            },
        };
    }

    async *generateStream(
        systemPrompt: string,
        userPrompt: string
    ): AsyncGenerator<string, void, unknown> {
        const client = await this.getClient();

        const stream = await client.messages.create({
            model: 'claude-3-5-sonnet-20241022',
            max_tokens: 8192,
            temperature: 0.3,
            system: systemPrompt,
            messages: [{ role: 'user', content: userPrompt }],
            stream: true,
        });

        for await (const chunk of stream) {
            if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
                yield chunk.delta.text;
            }
        }
    }
}
