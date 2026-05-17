import { describe, it, expect } from 'vitest';
import { MockProvider } from './MockProvider';

describe('MockProvider', () => {
    it('is always configured', () => {
        const provider = new MockProvider();
        expect(provider.isConfigured()).toBe(true);
    });

    it('returns a deterministic mock tour payload', async () => {
        const provider = new MockProvider();
        const response = await provider.generate('sys', 'user');
        const parsed = JSON.parse(response.text) as { isMock: boolean; steps: unknown[] };

        expect(response.finishReason).toBe('stop');
        expect(parsed.isMock).toBe(true);
        expect(parsed.steps.length).toBeGreaterThan(0);
    });
});