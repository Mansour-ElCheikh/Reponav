/** Implemented by Antigravity (2026-04-26) */
import { promises as fs } from 'fs';
import * as path from 'path';
import { WorkspaceAdapter } from '../WorkspaceAdapter';
import { DEFAULT_INTERACTIVE_MAX_FILES, IGNORE_PATTERNS } from '../analyzers/fileSelection';

/**
 * File-system backed WorkspaceAdapter for headless CLI use.
 * No VS Code dependency.
 */
export class LocalWorkspaceAdapter implements WorkspaceAdapter {
    private readonly root: string;
    private indexedPathsPromise: Promise<string[]> | null = null;
    private readonly skipDirNames: Set<string>;

    constructor(root: string) {
        this.root = root;
        this.skipDirNames = new Set(IGNORE_PATTERNS.filter(p => !p.includes('*') && !p.startsWith('.')));
    }

    /** Return the workspace root directory. */
    getWorkspaceRoot(): string | null {
        return this.root;
    }

    /** Return config values; honours maxFilesToAnalyze only. */
    getConfig<T>(_section: string, key: string, defaultValue: T): T {
        if (key === 'maxFilesToAnalyze') return DEFAULT_INTERACTIVE_MAX_FILES as T;
        return defaultValue;
    }

    /** Read a file by absolute path. Returns null on error. */
    async readFile(absolutePath: string): Promise<string | null> {
        try {
            return await fs.readFile(absolutePath, 'utf8');
        } catch {
            return null;
        }
    }

    /** Find files matching a glob-like include pattern up to maxResults. */
    async findFiles(
        includePattern: string,
        _excludePattern: string,
        maxResults: number
    ): Promise<string[]> {
        const allFiles = await this.getIndexedPaths();
        const matches = allFiles.filter((fp) => this.matchesInclude(fp, includePattern));
        return matches.slice(0, maxResults);
    }

    /** No-op: CLI has no UI. */
    showInfo(_message: string): void {}

    /** No-op: CLI has no UI. */
    showError(_message: string): void {}

    private async getIndexedPaths(): Promise<string[]> {
        if (!this.indexedPathsPromise) {
            this.indexedPathsPromise = this.walkDir(this.root)
                .then((paths) => paths.map((fp) => path.relative(this.root, fp)));
        }
        return this.indexedPathsPromise;
    }

    private async walkDir(dir: string): Promise<string[]> {
        let entries: import('fs').Dirent[];
        try {
            entries = await fs.readdir(dir, { withFileTypes: true });
        } catch {
            return [];
        }
        const files: string[] = [];
        for (const entry of entries) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory() && !entry.name.startsWith('.') && !this.skipDirNames.has(entry.name)) {
                files.push(...await this.walkDir(full));
            } else if (entry.isFile()) {
                files.push(full);
            }
        }
        return files;
    }

    private matchesInclude(filePath: string, includePattern: string): boolean {
        if (includePattern === '**/*') return true;
        // Simple glob to regex conversion for basic patterns
        const regex = new RegExp('^' + includePattern.replace(/\./g, '\\.').replace(/\*/g, '.*') + '$');
        return regex.test(filePath);
    }
}
