import { execSync } from 'child_process';

/** A changed-line range within a single file from a git diff hunk. */
export interface DiffHunk {
    startLine: number;
    endLine: number;
}

/** Wraps git exec errors into a user-friendly message. */
function runGit(args: string, cwd: string): string {
    try {
        return execSync(`git ${args}`, { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(`git command failed: ${msg}`);
    }
}

/**
 * Returns the list of files changed between HEAD and the given `ref`.
 * Includes added, modified, and deleted files.
 * Throws with a clear message when `ref` is invalid or `repoRoot` is not a git repo.
 */
export async function getChangedFiles(ref: string, repoRoot: string): Promise<string[]> {
    // This will throw with a clear message via runGit if ref is invalid
    const output = runGit(`diff --name-only ${ref}`, repoRoot);
    if (!output) return [];
    return output.split('\n').filter(Boolean);
}

/**
 * Returns a Map of filePath → list of changed line ranges for the given `ref`.
 * Parses unified diff hunk headers (`@@ -a,b +c,d @@`) to extract new-file line ranges.
 * Throws with a clear message when `ref` is invalid or `repoRoot` is not a git repo.
 */
export async function getDiffHunks(ref: string, repoRoot: string): Promise<Map<string, DiffHunk[]>> {
    const output = runGit(`diff -U0 ${ref}`, repoRoot);
    const result = new Map<string, DiffHunk[]>();

    let currentFile: string | null = null;
    for (const line of output.split('\n')) {
        // Match: +++ b/path/to/file.ts
        if (line.startsWith('+++ b/')) {
            currentFile = line.slice('+++ b/'.length).trim();
            if (!result.has(currentFile)) result.set(currentFile, []);
            continue;
        }
        // Match hunk header: @@ -a,b +c,d @@
        if (line.startsWith('@@') && currentFile) {
            const match = line.match(/@@ [^+]*\+(\d+)(?:,(\d+))? @@/);
            if (match) {
                const startLine = parseInt(match[1], 10);
                const count = match[2] !== undefined ? parseInt(match[2], 10) : 1;
                if (count > 0) {
                    result.get(currentFile)!.push({ startLine, endLine: startLine + count - 1 });
                }
            }
        }
    }

    return result;
}
