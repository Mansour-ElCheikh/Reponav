import { describe, expect, it, vi } from 'vitest';
import { average, errorMessage, getErrorCategory, withTimeout } from './extensionUtils';

describe('extensionUtils', () => {
    it('computes average values', () => {
        expect(average([])).toBe(0);
        expect(average([10, 20, 30])).toBe(20);
    });

    it('extracts an error category from named errors', () => {
        expect(getErrorCategory(new TypeError('bad input'))).toBe('TypeError');
        expect(getErrorCategory('oops')).toBe('UnknownError');
    });

    it('formats unknown error values as strings', () => {
        expect(errorMessage(new Error('boom'))).toBe('boom');
        expect(errorMessage(42)).toBe('42');
    });

    it('rejects when a promise exceeds the timeout', async () => {
        vi.useFakeTimers();
        const promise = withTimeout(
            new Promise<string>(() => {}),
            100,
            'slow task'
        );

        vi.advanceTimersByTime(100);

        await expect(promise).rejects.toThrow('slow task timed out after 100ms');
        vi.useRealTimers();
    });
});
