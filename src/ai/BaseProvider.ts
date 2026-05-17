import { WorkspaceAdapter } from '../WorkspaceAdapter';
import { LLMProvider, LLMResponse, FinishReason } from './LLMProvider';

export abstract class BaseProvider implements LLMProvider {
    abstract readonly name: string;
    protected abstract readonly configKey: string;
    protected abstract readonly missingConfigMessage: string;

    constructor(protected readonly workspace: WorkspaceAdapter) { }

    isConfigured(): boolean {
        return !!this.getConfigValue(this.configKey);
    }

    protected getConfigValue(key: string): string {
        return this.workspace.getConfig<string>('reponav', key, '').trim();
    }

    protected getRequiredConfigValue(key: string, message: string): string {
        const value = this.getConfigValue(key);
        if (!value) {
            throw new Error(message);
        }
        return value;
    }

    protected mapOpenAIFinishReason(reason: unknown): FinishReason {
        if (reason === 'stop') {
            return 'stop';
        }
        if (reason === 'length') {
            return 'length';
        }
        if (reason === 'content_filter') {
            return 'content_filter';
        }
        return 'unknown';
    }

    abstract generate(systemPrompt: string, userPrompt: string): Promise<LLMResponse>;

    generateStream?(
        systemPrompt: string,
        userPrompt: string
    ): AsyncGenerator<string, void, unknown>;
}
