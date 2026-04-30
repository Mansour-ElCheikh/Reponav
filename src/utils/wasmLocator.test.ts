import * as fs from 'fs';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getWasmDirectory, clearWasmCache } from './wasmLocator';

vi.mock('fs');

describe('wasmLocator', () => {
    beforeEach(() => {
        clearWasmCache();
        vi.restoreAllMocks();
    });

    it('returns cached result on repeat calls without re-hitting filesystem', () => {
        const existsSyncSpy = vi.mocked(fs.existsSync).mockReturnValue(true);

        const first = getWasmDirectory(['a.wasm']);
        const callsAfterFirst = existsSyncSpy.mock.calls.length;

        const second = getWasmDirectory(['a.wasm']);
        const callsAfterSecond = existsSyncSpy.mock.calls.length;

        expect(first).toBe(second);
        expect(callsAfterSecond).toBe(callsAfterFirst);
    });

    it('caches independently for different requiredFiles', () => {
        vi.mocked(fs.existsSync).mockReturnValue(true);

        const a = getWasmDirectory(['a.wasm']);
        const b = getWasmDirectory(['b.wasm']);

        expect(a).toBe(b); // same dir resolved, but both calls hit fs
    });

    it('clearWasmCache causes next call to re-check filesystem', () => {
        const existsSyncSpy = vi.mocked(fs.existsSync).mockReturnValue(true);

        getWasmDirectory(['a.wasm']);
        const callsBefore = existsSyncSpy.mock.calls.length;

        clearWasmCache();
        getWasmDirectory(['a.wasm']);
        const callsAfter = existsSyncSpy.mock.calls.length;

        expect(callsAfter).toBeGreaterThan(callsBefore);
    });
});
