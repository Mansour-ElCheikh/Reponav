import type { FileClassification } from '../types';

/** Hint emitted when a repo shows characteristics of a library/framework source rather than an application. */
export interface RepoCharacterHint {
    code: 'library-source';
    message: string;
    unknownRate: number;
}

/** Minimum non-test file count before we attempt to characterise the repo. */
const MIN_FILE_COUNT = 10;

/** Unknown rate above which we suspect library source (no app entrypoint found). */
const UNKNOWN_RATE_THRESHOLD = 0.4;

/** App entrypoints are only considered authoritative at the repo root or one directory below it. */
const MAX_APP_ENTRYPOINT_SEGMENTS = 3;

/** Hint messages present unknown-rate percentages as whole numbers. */
const PERCENTAGE_SCALE = 100;

/** Filename basenames that strongly indicate an application entrypoint. */
const APP_ENTRYPOINT_NAMES = new Set([
    'main.py', 'app.py', 'server.py', 'wsgi.py', 'asgi.py',
    'main.ts', 'main.js', 'app.ts', 'app.js', 'server.ts', 'server.js',
    'index.ts', 'index.js',
]);

/**
 * Detects whether a repo is most likely a library/framework source rather than an application.
 *
 * Heuristic: if >40% of non-test files are unclassified AND no obvious app entrypoint
 * (`main.py`, `app.py`, etc.) is present at or near the repo root, the repo is likely a
 * library source whose internal file topology doesn't match the application layer model.
 *
 * Returns a `RepoCharacterHint` when the condition fires, or `null` otherwise.
 * Test files are excluded from the unknown rate calculation (they inflate the denominator
 * without providing classification signal).
 */
export function detectRepoCharacter(
    files: Map<string, string>,
    classifications: FileClassification[],
): RepoCharacterHint | null {
    // Check for app entrypoint anywhere in root or immediate subdirectories
    for (const filePath of files.keys()) {
        const segments = filePath.replace(/\\/g, '/').split('/').filter(Boolean);
        const basename = segments[segments.length - 1] ?? '';
        // entrypoint at root or one level deep (e.g. /repo/main.py or /repo/app/main.py)
        if (segments.length <= MAX_APP_ENTRYPOINT_SEGMENTS && APP_ENTRYPOINT_NAMES.has(basename)) {
            return null;
        }
    }

    // Count only non-test classifications
    const nonTest = classifications.filter(c => c.category !== 'test');

    if (nonTest.length < MIN_FILE_COUNT) return null;

    const unknownCount = nonTest.filter(c => c.category === 'unknown').length;
    const unknownRate = unknownCount / nonTest.length;

    if (unknownRate <= UNKNOWN_RATE_THRESHOLD) return null;

    const pct = Math.round(unknownRate * PERCENTAGE_SCALE);
    return {
        code: 'library-source',
        unknownRate,
        message:
            `${pct}% of files are unclassified. This repo looks like a library or framework source ` +
            `rather than an application — RepoNav's layer model assumes an entry→controller→service→model ` +
            `topology that library internals don't follow. Classification accuracy will be low.`,
    };
}
