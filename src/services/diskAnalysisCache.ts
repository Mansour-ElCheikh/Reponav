import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import type { AnalysisReport, CoChangePair } from '../types';

/** Cache key uniquely identifying a repo state. */
export interface CacheKey {
    repoPath: string;
    gitHead: string;
    fileCount: number;
}

interface AnalysisCacheFile {
    cacheKey: CacheKey;
    report: AnalysisReport;
}

interface CouplingCacheFile {
    cacheKey: CacheKey;
    minSupport: number;
    pairs: CoChangePair[];
}

/** Computes a cache key from repo path, current git HEAD, and file count. */
export async function computeCacheKey(repoPath: string, files: string[]): Promise<CacheKey> {
    let gitHead = '';
    try {
        gitHead = execSync('git rev-parse HEAD', { cwd: repoPath, stdio: ['pipe', 'pipe', 'pipe'] })
            .toString()
            .trim();
    } catch {
        // non-git directory — use empty string
    }
    return { repoPath, gitHead, fileCount: files.length };
}

function analysisCachePath(repoPath: string): string {
    return path.join(repoPath, '.reponav', 'analysis-cache.json');
}

function couplingCachePath(repoPath: string): string {
    return path.join(repoPath, '.reponav', 'coupling-cache.json');
}

function keysMatch(a: CacheKey, b: CacheKey): boolean {
    return a.repoPath === b.repoPath && a.gitHead === b.gitHead && a.fileCount === b.fileCount;
}

function atomicWrite(filePath: string, data: unknown): void {
    const dir = path.dirname(filePath);
    fs.mkdirSync(dir, { recursive: true });
    const tmp = `${filePath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tmp, filePath);
}

/**
 * Reads a cached AnalysisReport if the key matches and cached tier satisfies the requested tier.
 * Returns undefined on any miss, key mismatch, tier insufficiency, or I/O error.
 */
export function readAnalysisCache(key: CacheKey, requestedTier: number, repoPath?: string): AnalysisReport | undefined {
    const root = repoPath ?? key.repoPath;
    try {
        const raw = fs.readFileSync(analysisCachePath(root), 'utf8');
        const cached: AnalysisCacheFile = JSON.parse(raw);
        if (!keysMatch(cached.cacheKey, key)) return undefined;
        if (cached.report.indexTier < requestedTier) return undefined;
        return cached.report;
    } catch {
        return undefined;
    }
}

/**
 * Writes an AnalysisReport to disk atomically.
 * Creates .reponav/ directory if absent. Swallows all I/O errors.
 */
export function writeAnalysisCache(key: CacheKey, report: AnalysisReport, repoPath?: string): void {
    const root = repoPath ?? key.repoPath;
    try {
        atomicWrite(analysisCachePath(root), { cacheKey: key, report });
    } catch {
        // swallow — caller still gets the result
    }
}

/**
 * Reads cached coupling pairs if key and minSupport match.
 * Returns undefined on any miss or I/O error.
 */
export function readCouplingCache(key: CacheKey, minSupport: number, repoPath?: string): CoChangePair[] | undefined {
    const root = repoPath ?? key.repoPath;
    try {
        const raw = fs.readFileSync(couplingCachePath(root), 'utf8');
        const cached: CouplingCacheFile = JSON.parse(raw);
        if (!keysMatch(cached.cacheKey, key)) return undefined;
        if (cached.minSupport !== minSupport) return undefined;
        return cached.pairs;
    } catch {
        return undefined;
    }
}

/**
 * Writes coupling pairs to disk atomically.
 * Creates .reponav/ directory if absent. Swallows all I/O errors.
 */
export function writeCouplingCache(key: CacheKey, pairs: CoChangePair[], minSupport: number, repoPath?: string): void {
    const root = repoPath ?? key.repoPath;
    try {
        atomicWrite(couplingCachePath(root), { cacheKey: key, minSupport, pairs });
    } catch {
        // swallow — caller still gets the result
    }
}
