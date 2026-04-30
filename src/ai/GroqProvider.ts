/**
 * GroqProvider — fast inference with OpenAI-compatible API.
 */

import { WorkspaceAdapter } from '../WorkspaceAdapter';
import { BaseOpenAICompatibleProvider } from './BaseOpenAICompatibleProvider';

export class GroqProvider extends BaseOpenAICompatibleProvider {
    readonly name = 'Groq (Llama 3.3 70B)';
    protected readonly configKey = 'groqApiKey';
    protected readonly missingConfigMessage = 'No Groq API key configured. Set it in Settings → RepoNav → Groq API Key';
    protected readonly model = 'llama-3.3-70b-versatile';

    constructor(workspace: WorkspaceAdapter) {
        super(workspace);
    }

    protected getBaseURL(): string | undefined {
        return 'https://api.groq.com/openai/v1';
    }
}
