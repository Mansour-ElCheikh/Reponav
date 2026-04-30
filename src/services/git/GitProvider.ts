/**
 * GitProvider — Git state interface
 *
 * Pure interface for git integration. No vscode imports.
 * The concrete implementation (VSCodeGitProvider) lives in the extension layer.
 */

export type GitFileStatus = 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked' | 'clean';

export interface GitFileChange {
    path: string;       // workspace-relative path
    status: GitFileStatus;
}

export interface GitState {
    branch: string | undefined;
    changes: GitFileChange[];
    isGitRepo: boolean;
}

/** Contract for git state providers. */
export interface GitProvider {
    getState(workspaceRoot: string): Promise<GitState>;
}

/** No-op provider for environments without git. */
export const nullGitProvider: GitProvider = {
    async getState(): Promise<GitState> {
        return { branch: undefined, changes: [], isGitRepo: false };
    },
};

/**
 * Map VS Code git status enum to our simplified status.
 * Exported for use by the VSCode implementation.
 */
export function mapGitStatus(status: number): GitFileStatus {
    switch (status) {
        case 0: case 5: return 'modified';
        case 1: return 'added';
        case 2: case 6: return 'deleted';
        case 3: return 'renamed';
        case 7: return 'untracked';
        default: return 'modified';
    }
}
