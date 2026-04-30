/**
 * File Reading
 *
 * Workspace file reading, file tree construction, and key file extraction.
 * Extracted from analyzers/index.ts.
 *
 * NO vscode imports — depends only on WorkspaceAdapter.
 */

import * as path from 'path';
import type { WorkspaceAdapter } from '../WorkspaceAdapter';
import type { AnalysisOptions } from './fileSelection';
import { BINARY_EXTENSIONS, collectCandidatePaths } from './fileSelection';

// ─── Constants ───────────────────────────────────────────────────────────────

const PERF_LOG_PREFIX = '[RepoNav][perf][fileReading]';
const MAX_CONCURRENT_FILE_READS = 16;
const MAX_TEXT_FILE_BYTES = 100_000;
const BINARY_SNIFF_BYTES = 1_024;
const MAX_KEY_FILE_CONTENT_CHARS = 5_000;

/** Config/manifest files to read during preview (cheap metadata scan). */
export const PREVIEW_CONTENT_PATHS = new Set([
    'README.md',
    'package.json',
    'pyproject.toml',
    'requirements.txt',
    'requirements/base.txt',
    'manage.py',
    'vite.config.ts',
    'vite.config.js',
    'webpack.config.ts',
    'webpack.config.js',
    'next.config.ts',
    'next.config.js',
    'next.config.mjs',
    'docker-compose.yml',
    'docker-compose.yaml',
    'Dockerfile',
]);

// ─── Functions ───────────────────────────────────────────────────────────────

/**
 * Read all workspace files into memory, respecting ignore patterns.
 * Returns a Map of relative path -> content.
 */
export async function readWorkspaceFiles(
    adapter: WorkspaceAdapter,
    options: Required<AnalysisOptions>
): Promise<Map<string, string>> {
    const readStart = performance.now();
    const files = new Map<string, string>();
    const workspaceRoot = adapter.getWorkspaceRoot();
    if (!workspaceRoot) return files;

    const relativePaths = await collectCandidatePaths(adapter, options);

    for (let i = 0; i < relativePaths.length; i += MAX_CONCURRENT_FILE_READS) {
        const batch = relativePaths.slice(i, i + MAX_CONCURRENT_FILE_READS);
        const results = await Promise.all(
            batch.map(async (relativePath) => {
                const ext = path.extname(relativePath).toLowerCase();
                if (BINARY_EXTENSIONS.has(ext)) return null;

                const absolutePath = path.join(workspaceRoot, relativePath);
                const text = await adapter.readFile(absolutePath);
                if (!text) return null;

                // Skip very large files (>100KB) — they're likely generated
                if (text.length > MAX_TEXT_FILE_BYTES) return null;

                // Quick binary check (null bytes in first 1KB)
                if (text.substring(0, BINARY_SNIFF_BYTES).includes('\0')) return null;

                return { relativePath, text };
            })
        );

        for (const result of results) {
            if (!result) continue;
            files.set(result.relativePath, result.text);
        }
    }

    console.error(`${PERF_LOG_PREFIX} readWorkspaceFiles: ${(performance.now() - readStart).toFixed(1)}ms`, {
        scope: options.scope,
        selected: relativePaths.length,
        loaded: files.size,
    });
    return files;
}

/** Build a hierarchical file tree from flat file paths. */
export function buildFileTree(filePaths: string[]): Record<string, unknown> {
    const tree: Record<string, unknown> = {};

    for (const filePath of filePaths) {
        const parts = filePath.split('/');
        let current: Record<string, unknown> = tree;

        for (let i = 0; i < parts.length; i++) {
            const part = parts[i];
            if (i === parts.length - 1) {
                current[part] = null; // leaf = file
            } else {
                if (!current[part] || typeof current[part] !== 'object') {
                    current[part] = {};
                }
                current = current[part] as Record<string, unknown>;
            }
        }
    }

    return tree;
}

/** Extract key file contents (README, main configs) for the AI. */
export function extractKeyFileContents(files: Map<string, string>): Record<string, string> {
    const keyFiles: Record<string, string> = {};
    const keyPatterns = [
        /^README\.md$/i,
        /^package\.json$/,
        /^pyproject\.toml$/,
        /^Cargo\.toml$/,
        /^go\.mod$/,
        /^docker-compose\.ya?ml$/,
        /^Dockerfile$/,
    ];

    for (const [filePath, content] of files) {
        for (const pattern of keyPatterns) {
            if (pattern.test(filePath)) {
                // Truncate to 5KB for AI context
                keyFiles[filePath] = content.substring(0, MAX_KEY_FILE_CONTENT_CHARS);
                break;
            }
        }
    }

    return keyFiles;
}

/**
 * Read only preview/manifest files for cheap metadata-first analysis.
 * Returns a Map where non-preview files have empty string content.
 */
export async function readPreviewFiles(
    adapter: WorkspaceAdapter,
    workspaceRoot: string,
    relativePaths: string[]
): Promise<Map<string, string>> {
    const files = new Map<string, string>(relativePaths.map((filePath) => [filePath, '']));
    const previewPaths = relativePaths.filter((filePath) => PREVIEW_CONTENT_PATHS.has(filePath));

    const results = await Promise.all(
        previewPaths.map(async (relativePath) => {
            const absolutePath = path.join(workspaceRoot, relativePath);
            const text = await adapter.readFile(absolutePath);
            return text ? { relativePath, text } : null;
        })
    );

    for (const result of results) {
        if (!result) continue;
        files.set(result.relativePath, result.text);
    }

    return files;
}
