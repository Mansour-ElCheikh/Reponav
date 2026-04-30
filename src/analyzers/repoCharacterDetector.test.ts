import { describe, it, expect } from 'vitest';
import type { FileClassification } from '../types';
import { detectRepoCharacter } from './repoCharacterDetector';

function cls(path: string, category: FileClassification['category']): FileClassification {
    return { path, category, confidence: 'high', reason: 'test' };
}

describe('detectRepoCharacter — library source detection', () => {
    it('returns library-source hint when unknown rate > 40% and no app entrypoint', () => {
        const files = new Map<string, string>();
        // 6 unknown, 4 other = 60% unknown
        for (let i = 0; i < 6; i++) files.set(`/repo/fastapi/module${i}.py`, '');
        for (let i = 0; i < 4; i++) files.set(`/repo/fastapi/known${i}.py`, '');
        const classifications: FileClassification[] = [
            ...Array.from({ length: 6 }, (_, i) => cls(`/repo/fastapi/module${i}.py`, 'unknown')),
            ...Array.from({ length: 4 }, (_, i) => cls(`/repo/fastapi/known${i}.py`, 'service')),
        ];
        const result = detectRepoCharacter(files, classifications);
        expect(result).not.toBeNull();
        expect(result!.code).toBe('library-source');
    });

    it('returns null when an app entrypoint exists three segments deep', () => {
        const files = new Map<string, string>([
            ['packages/api/main.ts', ''],
            ...Array.from({ length: 11 }, (_, i): [string, string] => [`src/module${i}.ts`, '']),
        ]);
        const classifications: FileClassification[] = [
            cls('packages/api/main.ts', 'entry'),
            ...Array.from({ length: 11 }, (_, i) => cls(`src/module${i}.ts`, 'unknown')),
        ];

        const result = detectRepoCharacter(files, classifications);

        expect(result).toBeNull();
    });

    it('returns null when app entrypoints exist (main.py present)', () => {
        const files = new Map<string, string>([
            ['/repo/app/main.py', 'from fastapi import FastAPI\napp = FastAPI()'],
            ...Array.from({ length: 9 }, (_, i): [string, string] => [`/repo/app/module${i}.py`, '']),
        ]);
        const classifications: FileClassification[] = [
            cls('/repo/app/main.py', 'entry'),
            ...Array.from({ length: 9 }, (_, i) => cls(`/repo/app/module${i}.py`, 'unknown')),
        ];
        // 9 unknown out of 10 = 90% but main.py is an entry point → not a library
        const result = detectRepoCharacter(files, classifications);
        expect(result).toBeNull();
    });

    it('returns null when unknown rate is ≤ 40%', () => {
        const files = new Map<string, string>();
        for (let i = 0; i < 4; i++) files.set(`/repo/app/module${i}.py`, '');
        for (let i = 0; i < 6; i++) files.set(`/repo/app/service${i}.py`, '');
        const classifications: FileClassification[] = [
            ...Array.from({ length: 4 }, (_, i) => cls(`/repo/app/module${i}.py`, 'unknown')),
            ...Array.from({ length: 6 }, (_, i) => cls(`/repo/app/service${i}.py`, 'service')),
        ];
        const result = detectRepoCharacter(files, classifications);
        expect(result).toBeNull();
    });

    it('returns null when repo has fewer than 10 files (too small to judge)', () => {
        const files = new Map<string, string>();
        for (let i = 0; i < 5; i++) files.set(`/repo/fastapi/module${i}.py`, '');
        const classifications: FileClassification[] = [
            ...Array.from({ length: 5 }, (_, i) => cls(`/repo/fastapi/module${i}.py`, 'unknown')),
        ];
        const result = detectRepoCharacter(files, classifications);
        expect(result).toBeNull();
    });

    it('includes a human-readable message in the hint', () => {
        const files = new Map<string, string>();
        for (let i = 0; i < 7; i++) files.set(`/repo/fastapi/module${i}.py`, '');
        for (let i = 0; i < 3; i++) files.set(`/repo/fastapi/known${i}.py`, '');
        const classifications: FileClassification[] = [
            ...Array.from({ length: 7 }, (_, i) => cls(`/repo/fastapi/module${i}.py`, 'unknown')),
            ...Array.from({ length: 3 }, (_, i) => cls(`/repo/fastapi/known${i}.py`, 'service')),
        ];
        const result = detectRepoCharacter(files, classifications);
        expect(result!.message).toMatch(/library|framework/i);
    });

    it('formats the current rounded unknown-rate percentage in the hint message', () => {
        const files = new Map<string, string>();
        for (let i = 0; i < 6; i++) files.set(`/repo/lib/f${i}.py`, '');
        for (let i = 0; i < 4; i++) files.set(`/repo/lib/k${i}.py`, '');
        const classifications: FileClassification[] = [
            ...Array.from({ length: 6 }, (_, i) => cls(`/repo/lib/f${i}.py`, 'unknown')),
            ...Array.from({ length: 4 }, (_, i) => cls(`/repo/lib/k${i}.py`, 'service')),
        ];

        const result = detectRepoCharacter(files, classifications);

        expect(result!.message).toContain('60% of files are unclassified.');
    });

    it('includes the unknown rate in the hint', () => {
        const files = new Map<string, string>();
        for (let i = 0; i < 6; i++) files.set(`/repo/lib/f${i}.py`, '');
        for (let i = 0; i < 4; i++) files.set(`/repo/lib/k${i}.py`, '');
        const classifications: FileClassification[] = [
            ...Array.from({ length: 6 }, (_, i) => cls(`/repo/lib/f${i}.py`, 'unknown')),
            ...Array.from({ length: 4 }, (_, i) => cls(`/repo/lib/k${i}.py`, 'service')),
        ];
        const result = detectRepoCharacter(files, classifications);
        expect(result!.unknownRate).toBeCloseTo(0.6, 2);
    });

    it('detects app.py as an entrypoint and suppresses the hint', () => {
        const files = new Map<string, string>([
            ['/repo/app.py', ''],
            ...Array.from({ length: 9 }, (_, i): [string, string] => [`/repo/module${i}.py`, '']),
        ]);
        const classifications: FileClassification[] = [
            cls('/repo/app.py', 'entry'),
            ...Array.from({ length: 9 }, (_, i) => cls(`/repo/module${i}.py`, 'unknown')),
        ];
        const result = detectRepoCharacter(files, classifications);
        expect(result).toBeNull();
    });

    // ─── Task 6: Guard B deleted — entry-classified non-app file no longer blocks hint ───

    it('emits library-source hint when only entry-classified file is src/extension.ts (non-app name, depth 2)', () => {
        // src/extension.ts has category 'entry' but is NOT an app entrypoint name
        // Guard B (any-entry bail) must be gone; Guard A (app name at depth ≤3) must NOT fire
        const files = new Map<string, string>();
        files.set('src/extension.ts', '');
        // 11 unknown, 2 known = >40% unknown of non-test files
        for (let i = 0; i < 11; i++) files.set(`src/analyzers/module${i}.ts`, '');
        for (let i = 0; i < 2; i++) files.set(`src/services/service${i}.ts`, '');
        const classifications: FileClassification[] = [
            cls('src/extension.ts', 'entry'),
            ...Array.from({ length: 11 }, (_, i) => cls(`src/analyzers/module${i}.ts`, 'unknown')),
            ...Array.from({ length: 2 }, (_, i) => cls(`src/services/service${i}.ts`, 'service')),
        ];
        const result = detectRepoCharacter(files, classifications);
        expect(result).not.toBeNull();
        expect(result!.code).toBe('library-source');
    });

    // ─── Task 7: Guard A still blocks hint for root app entrypoint ───────────────

    it('returns null when main.ts exists at path depth 1', () => {
        const files = new Map<string, string>();
        files.set('main.ts', '');
        for (let i = 0; i < 11; i++) files.set(`src/module${i}.ts`, '');
        const classifications: FileClassification[] = [
            cls('main.ts', 'entry'),
            ...Array.from({ length: 11 }, (_, i) => cls(`src/module${i}.ts`, 'unknown')),
        ];
        // 11/12 = 92% unknown, but main.ts at depth 1 → Guard A fires → null
        const result = detectRepoCharacter(files, classifications);
        expect(result).toBeNull();
    });
});
