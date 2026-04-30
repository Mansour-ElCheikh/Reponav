/**
 * Prompt Sanitizer
 *
 * Strips workspace-local absolute paths from text before sending to third-party
 * LLM providers. VS Code Language Model calls pass through unchanged — they
 * route through the Copilot proxy which handles data residency.
 *
 * NOTE: No vscode imports — pure TypeScript, fully testable outside the extension host.
 */

// Third-party providers that require sanitization.
const THIRD_PARTY_PROVIDERS = new Set([
    'Anthropic',
    'Groq',
    'Gemini',
    'OpenAI',
    'OpenAI-compatible',
]);

/**
 * Strips absolute workspace root prefixes from LLM prompt text for third-party providers.
 * Returns the original text unchanged for VS Code Language Model or unknown providers.
 *
 * @param text - The prompt text to sanitize.
 * @param providerName - The name of the LLM provider (used to determine if sanitization applies).
 * @param workspaceRoot - The absolute workspace root path to strip.
 */
export function sanitizeForProvider(
    text: string,
    providerName: string,
    workspaceRoot: string
): string {
    // Only sanitize for known third-party providers.
    if (!THIRD_PARTY_PROVIDERS.has(providerName)) {
        return text;
    }

    // Normalise: strip any trailing slash from the workspace root.
    const normalizedRoot = workspaceRoot.endsWith('/')
        ? workspaceRoot.slice(0, -1)
        : workspaceRoot;

    if (!normalizedRoot) {
        return text;
    }

    // Escape special regex characters in the root path, then replace all occurrences
    // followed by an optional separator slash.
    const escaped = normalizedRoot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`${escaped}/?`, 'g');
    return text.replace(pattern, '');
}
