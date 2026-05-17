import { WorkspaceAdapter } from '../WorkspaceAdapter';
import { BaseOpenAICompatibleProvider } from './BaseOpenAICompatibleProvider';

/** OpenAI-backed provider implementation for GPT-4o BYOK requests. */
export class OpenAIProvider extends BaseOpenAICompatibleProvider {
    readonly name = 'GPT-4o';
    protected readonly configKey = 'openAIApiKey';
    protected readonly missingConfigMessage = 'No OpenAI API key configured. Set it in Settings → RepoNav → OpenAI API Key';
    protected readonly model = 'gpt-4o';

    constructor(workspace: WorkspaceAdapter) {
        super(workspace);
    }
}
