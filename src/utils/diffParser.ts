/**
 * Simple Git Diff Parser
 *
 * Extracts modified file paths and line ranges (hunks) from a unified diff.
 * Optimized for mapping changes to AST symbols.
 */

export interface DiffHunk {
    file: string;
    startLine: number;
    endLine: number;
}

/**
 * Parses a unified diff string and returns an array of hunks.
 * Each hunk contains the file path and the range of lines added/modified.
 */
export function parseDiff(diffText: string): DiffHunk[] {
    const hunks: DiffHunk[] = [];
    const lines = diffText.split('\n');
    let currentFile = '';

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        // Match "diff --git a/src/file.ts b/src/file.ts"
        if (line.startsWith('diff --git')) {
            const match = line.match(/b\/(.+)$/);
            if (match) {
                currentFile = match[1].trim();
            }
            continue;
        }

        // Match "--- a/src/file.ts" or "+++ b/src/file.ts" (alternative file capture)
        if (line.startsWith('+++ b/')) {
            currentFile = line.substring(6).trim();
            continue;
        }

        // Match "@@ -10,5 +12,8 @@"
        // We care about the '+' part (new/modified lines)
        if (line.startsWith('@@')) {
            const match = line.match(/\+(\d+)(?:,(\d+))?/);
            if (match && currentFile) {
                const start = parseInt(match[1], 10);
                const len = match[2] ? parseInt(match[2], 10) : 1;

                // Adjust for the fact that a 0-length hunk (only deletions)
                // shouldn't typically trigger a symbol-level impact check
                // unless we want to track deleted symbol impact.
                if (len > 0) {
                    hunks.push({
                        file: currentFile,
                        startLine: start,
                        endLine: start + len - 1
                    });
                }
            }
        }
    }

    return hunks;
}
