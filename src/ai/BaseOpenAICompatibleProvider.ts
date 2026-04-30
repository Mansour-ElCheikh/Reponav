import type OpenAI from 'openai';
import { BaseProvider } from './BaseProvider';
import { LLMResponse } from './LLMProvider';

export abstract class BaseOpenAICompatibleProvider extends BaseProvider {
    private client: OpenAI | null = null;
    protected abstract readonly model: string;

    protected getBaseURL(): string | undefined {
        return undefined;
    }

    protected async getClient(): Promise<OpenAI> {
        const apiKey = this.getRequiredConfigValue(this.configKey, this.missingConfigMessage);
        const baseURL = this.getBaseURL();
        // Lazy-load SDK so it is not parsed at extension activation.
        const { default: OpenAIClass } = await import('openai');
        this.client = new OpenAIClass(baseURL ? { apiKey, baseURL } : { apiKey });
        return this.client;
    }

    async generate(systemPrompt: string, userPrompt: string): Promise<LLMResponse> {
        const client = await this.getClient();

        const response = await client.chat.completions.create({
            model: this.model,
            temperature: 0.3,
            response_format: { type: 'json_object' },
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt },
            ],
        });

        const choice = response.choices[0];
        const text = choice?.message?.content || '';

        return {
            text,
            finishReason: this.mapOpenAIFinishReason(choice?.finish_reason),
            usage: response.usage ? {
                promptTokens: response.usage.prompt_tokens,
                completionTokens: response.usage.completion_tokens,
                totalTokens: response.usage.total_tokens,
            } : undefined,
        };
    }

    async *generateStream(
        systemPrompt: string,
        userPrompt: string
    ): AsyncGenerator<string, void, unknown> {
        const client = await this.getClient();

        const stream = await client.chat.completions.create({
            model: this.model,
            temperature: 0.3,
            response_format: { type: 'json_object' },
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt },
            ],
            stream: true,
        });

        for await (const chunk of stream) {
            const text = chunk.choices[0]?.delta?.content || '';
            if (text) {
                yield text;
            }
        }
    }
}
