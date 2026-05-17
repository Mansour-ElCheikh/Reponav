/**
 * VS Code Git Provider
 *
 * Concrete implementation of GitProvider backed by the vscode.git extension API.
 * This is the ONLY place that accesses the vscode git extension.
 */

import * as vscode from 'vscode';
import { GitProvider, GitState, GitFileChange, mapGitStatus } from './services/git/GitProvider';

function getGitApi(): any | null {
    try {
        const gitExtension = vscode.extensions.getExtension('vscode.git');
        if (!gitExtension) return null;

        const git = gitExtension.isActive
            ? gitExtension.exports
            : null;

        if (!git) return null;
        return git.getAPI(1);
    } catch {
        return null;
    }
}

export class VSCodeGitProvider implements GitProvider {
    async getState(workspaceRoot: string): Promise<GitState> {
        const api = getGitApi();
        if (!api) {
            return { branch: undefined, changes: [], isGitRepo: false };
        }

        const repos = api.repositories;
        if (!repos || repos.length === 0) {
            return { branch: undefined, changes: [], isGitRepo: false };
        }

        const repo = repos.find((r: any) => {
            const repoRoot = r.rootUri?.fsPath;
            return repoRoot && workspaceRoot.startsWith(repoRoot);
        }) || repos[0];

        const branch = repo.state?.HEAD?.name;
        const changes: GitFileChange[] = [];
        const seenPaths = new Set<string>();

        const collectChanges = (changeList: any[], status?: 'untracked') => {
            for (const change of (changeList || [])) {
                const relativePath = vscode.workspace.asRelativePath(change.uri, false);
                if (!seenPaths.has(relativePath)) {
                    seenPaths.add(relativePath);
                    changes.push({
                        path: relativePath,
                        status: status ?? mapGitStatus(change.status),
                    });
                }
            }
        };

        collectChanges(repo.state?.workingTreeChanges);
        collectChanges(repo.state?.indexChanges);
        collectChanges(repo.state?.untrackedChanges, 'untracked');

        return { branch, changes, isGitRepo: true };
    }
}
