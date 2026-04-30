import { execSync } from 'child_process';
import type { CoChangePair } from '../types';

/** Options for change coupling mining. */
export interface MiningOptions {
    /** Minimum number of times two files must co-change to be included. Default: 2. */
    minSupport?: number;
    /**
     * Maximum number of commits to process (most-recent first).
     * Capped at 2000 to keep performance bounded on large repos.
     * Default: 2000.
     */
    commitWindowSize?: number;
    /** Fraction of commits a file may appear in before it is considered ubiquitous. Default: 0.8. */
    ubiquityThreshold?: number;
}

/** File extensions treated as source files for coupling analysis. */
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.rs', '.java', '.cs']);

const DEFAULT_COMMIT_WINDOW_SIZE = 2000;
const DEFAULT_UBIQUITY_THRESHOLD = 0.8;
const CONFIDENCE_PRECISION_SCALE = 1000;
const GIT_LOG_MAX_BUFFER_MEBIBYTES = 50;
const BYTES_PER_MEBIBYTE = 1048576;
const GIT_LOG_MAX_BUFFER_BYTES = GIT_LOG_MAX_BUFFER_MEBIBYTES * BYTES_PER_MEBIBYTE;

/** Path prefixes / segments that are always excluded. */
const EXCLUDED_SEGMENTS = ['node_modules/', '.git/', 'dist/', '__pycache__/'];

/** Returns true if the file path should be included in coupling analysis. */
function isSourceFile(filePath: string): boolean {
    if (EXCLUDED_SEGMENTS.some(seg => filePath.includes(seg))) return false;
    const dot = filePath.lastIndexOf('.');
    if (dot === -1) return false;
    return SOURCE_EXTENSIONS.has(filePath.slice(dot));
}

/**
 * Parses raw `git log --name-only --pretty=format:"%H"` output into an array
 * of per-commit file sets, applying source-extension and path exclusion filters.
 * Any non-source, non-path line (no '/', no '.') is treated as a commit marker.
 */
export function parseGitLog(raw: string): Set<string>[] {
    if (!raw.trim()) return [];

    const commits: Set<string>[] = [];
    let current: Set<string> | null = null;

    for (const line of raw.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) {
            if (current && current.size > 0) commits.push(current);
            current = null;
            continue;
        }
        // A file path always contains '/' or '.' (has an extension).
        // A commit marker (hash or stub) has neither.
        const looksLikePath = trimmed.includes('/') || trimmed.includes('.');
        if (!looksLikePath) {
            // This is a commit-marker line — start a new commit set
            if (current && current.size > 0) commits.push(current);
            current = new Set();
            continue;
        }
        if (current !== null && isSourceFile(trimmed)) {
            current.add(trimmed);
        }
    }
    if (current && current.size > 0) commits.push(current);
    return commits;
}


/**
 * Computes pairwise support counts (co-occurrence frequencies) from commit file sets.
 * Returns a Map from canonical pair key → support count.
 */
export function computeSupport(commitSets: Set<string>[]): Map<string, number> {
    const support = new Map<string, number>();
    for (const files of commitSets) {
        const arr = Array.from(files);
        for (let i = 0; i < arr.length; i++) {
            for (let j = i + 1; j < arr.length; j++) {
                const a = arr[i];
                const b = arr[j];
                const key = a < b ? `${a}|${b}` : `${b}|${a}`;
                support.set(key, (support.get(key) ?? 0) + 1);
            }
        }
    }
    return support;
}

/**
 * Computes confidence for a directed pair (fileA → fileB):
 * how often fileB changes when fileA changes.
 * confidence = support(A,B) / frequency(A)
 */
export function computeConfidence(
    fileA: string,
    fileB: string,
    supportCount: number,
    fileFrequency: Map<string, number>
): number {
    const freqA = fileFrequency.get(fileA) ?? 1;
    return freqA > 0 ? supportCount / freqA : 0;
}

/**
 * Filters a list of CoChangePairs to those with support >= minSupport,
 * sorted by support descending.
 */
export function filterBySupport(pairs: CoChangePair[], minSupport: number): CoChangePair[] {
    return pairs
        .filter(p => p.support >= minSupport)
        .sort((a, b) => b.support - a.support);
}

/**
 * Mines change coupling from raw git log output.
 * Accepts the output of `git log --name-only --pretty=format:"%H"` as a string.
 * Returns a ranked list of CoChangePairs sorted by support descending.
 */
export function mineChangeCoupling(raw: string, options: MiningOptions = {}): CoChangePair[] {
    const {
        minSupport = 2,
        commitWindowSize = DEFAULT_COMMIT_WINDOW_SIZE,
        ubiquityThreshold = DEFAULT_UBIQUITY_THRESHOLD,
    } = options;

    if (!raw.trim()) return [];

    // Parse all commit sets
    let commitSets = parseGitLog(raw);

    // Apply commit window cap (most-recent = first in output from git log)
    if (commitSets.length > commitWindowSize) {
        if (typeof process !== 'undefined' && process.env['NODE_ENV'] !== 'test') {
            console.warn(
                `[changeCoupling] Repo has ${commitSets.length} commits — capping at ${commitWindowSize} most-recent.`
            );
        }
        commitSets = commitSets.slice(0, commitWindowSize);
    }

    if (commitSets.length === 0) return [];

    // Compute per-file frequency for ubiquity filtering
    const fileFrequency = new Map<string, number>();
    for (const files of commitSets) {
        for (const f of files) {
            fileFrequency.set(f, (fileFrequency.get(f) ?? 0) + 1);
        }
    }

    // Exclude ubiquitous files (present in > ubiquityThreshold% of commits)
    const ubiquityLimit = commitSets.length * ubiquityThreshold;
    const ubiquitous = new Set<string>();
    for (const [file, freq] of fileFrequency) {
        if (freq > ubiquityLimit) ubiquitous.add(file);
    }

    // Re-filter commit sets to remove ubiquitous files
    const filteredSets = ubiquitous.size > 0
        ? commitSets.map(s => new Set([...s].filter(f => !ubiquitous.has(f))))
        : commitSets;

    // Compute support
    const support = computeSupport(filteredSets);

    // Build CoChangePair list
    const pairs: CoChangePair[] = [];
    for (const [key, count] of support) {
        if (count < minSupport) continue;
        const [fileA, fileB] = key.split('|');
        const confidence = computeConfidence(fileA, fileB, count, fileFrequency);
        pairs.push({
            fileA,
            fileB,
            support: count,
            confidence: Math.round(confidence * CONFIDENCE_PRECISION_SCALE) / CONFIDENCE_PRECISION_SCALE,
        });
    }

    return pairs.sort((a, b) => b.support - a.support);
}

/**
 * Executes `git log --name-only` for the given repo directory and returns the raw output.
 * Throws if `cwd` is not a git repository or git is unavailable.
 */
export function getGitLog(cwd: string): string {
    return execSync(
        'git log --name-only --pretty=format:"%H" --diff-filter=AM',
        { cwd, encoding: 'utf8', maxBuffer: GIT_LOG_MAX_BUFFER_BYTES }
    );
}
