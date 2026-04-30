/** Implemented by Antigravity (2026-04-26) */
/** Implemented by Antigravity (2026-04-26) */
import * as fs from 'fs';
import * as path from 'path';
import type { FederatedRepo, CrossRepoEdge, AnalysisReport } from '../types';

/**
 * FederationAnalyzer (Tier 5)
 * 
 * Detects sister repositories and builds cross-repo dependency edges.
 */
export class FederationAnalyzer {
    /**
     * Scan parent directory for potential sister repos.
     * 
     * @param workspaceRoot - The absolute path to the current workspace root.
     * @returns A list of detected federated repositories in the same parent directory.
     */
    async detectSisterRepos(workspaceRoot: string): Promise<FederatedRepo[]> {
        const parentDir = path.dirname(workspaceRoot);
        const sisterRepos: FederatedRepo[] = [];
        
        try {
            const entries = fs.readdirSync(parentDir, { withFileTypes: true });
            for (const entry of entries) {
                if (entry.isDirectory() && entry.name !== path.basename(workspaceRoot)) {
                    const fullPath = path.join(parentDir, entry.name);
                    
                    // Check for markers
                    let type: FederatedRepo['type'] = 'unknown';
                    if (fs.existsSync(path.join(fullPath, 'package.json'))) type = 'npm';
                    else if (fs.existsSync(path.join(fullPath, 'go.mod'))) type = 'go';
                    else if (fs.existsSync(path.join(fullPath, 'pyproject.toml')) || fs.existsSync(path.join(fullPath, 'requirements.txt'))) type = 'python';
                    
                    if (type !== 'unknown') {
                        sisterRepos.push({
                            name: entry.name,
                            path: fullPath,
                            type
                        });
                    }
                }
            }
        } catch {
            // silent
        }
        
        return sisterRepos;
    }

    /**
     * Build cross-repo edges by analyzing imports that leave the current repo.
     * Detects: relative paths crossing repo boundary, package-name imports matching
     * a sister repo's package.json name, and tsconfig path aliases resolving outside.
     *
     * @param report - The current analysis report containing the dependency graph.
     * @param sisters - List of previously detected sister repositories.
     * @returns A list of cross-repository dependency edges.
     */
    async buildCrossRepoEdges(report: AnalysisReport, sisters: FederatedRepo[]): Promise<CrossRepoEdge[]> {
        const edges: CrossRepoEdge[] = [];
        const currentRepoName = path.basename(report.workspaceRoot);

        // Map package-name → sister repo (from each sister's package.json)
        const packageNameMap = new Map<string, FederatedRepo>();
        for (const sister of sisters) {
            try {
                const pkgPath = path.join(sister.path, 'package.json');
                if (fs.existsSync(pkgPath)) {
                    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8') as string);
                    if (pkg.name) packageNameMap.set(pkg.name as string, sister);
                }
            } catch { /* silent */ }
        }

        // Map tsconfig path alias prefix → resolved base path
        const tsconfigAliases = new Map<string, string>();
        try {
            const tsconfigPath = path.join(report.workspaceRoot, 'tsconfig.json');
            if (fs.existsSync(tsconfigPath)) {
                const tsconfig = JSON.parse(fs.readFileSync(tsconfigPath, 'utf8') as string);
                const paths: Record<string, string[]> = tsconfig?.compilerOptions?.paths ?? {};
                for (const [alias, targets] of Object.entries(paths)) {
                    const prefix = alias.replace(/\/\*$/, '');
                    const first = (targets[0] ?? '').replace(/\/\*$/, '');
                    if (first) tsconfigAliases.set(prefix, path.resolve(report.workspaceRoot, first));
                }
            }
        } catch { /* silent */ }

        for (const edge of report.dependencyGraph.edges) {
            // 1. Relative path crossing repo boundary
            if (edge.target.startsWith('../')) {
                const absoluteSourceDir = path.join(report.workspaceRoot, path.dirname(edge.source));
                const targetPath = path.resolve(absoluteSourceDir, edge.target);
                const sister = sisters.find(s => targetPath.startsWith(s.path));
                if (sister) {
                    edges.push({
                        sourceRepo: currentRepoName,
                        sourceFile: edge.source,
                        targetRepo: sister.name,
                        targetFile: path.relative(sister.path, targetPath),
                        type: 'import',
                    });
                    continue;
                }
            }

            // 2. Package-name import matching a sister repo's published name
            const pkgName = edge.target.startsWith('@')
                ? edge.target.split('/').slice(0, 2).join('/')
                : edge.target.split('/')[0];
            const sisterByPkg = packageNameMap.get(pkgName);
            if (sisterByPkg) {
                edges.push({
                    sourceRepo: currentRepoName,
                    sourceFile: edge.source,
                    targetRepo: sisterByPkg.name,
                    targetFile: edge.target.slice(pkgName.length).replace(/^\//, ''),
                    type: 'import',
                });
                continue;
            }

            // 3. tsconfig path alias resolving outside the current repo
            for (const [prefix, resolvedBase] of tsconfigAliases) {
                if (edge.target === prefix || edge.target.startsWith(prefix + '/')) {
                    const sister = sisters.find(s => resolvedBase.startsWith(s.path));
                    if (sister) {
                        edges.push({
                            sourceRepo: currentRepoName,
                            sourceFile: edge.source,
                            targetRepo: sister.name,
                            targetFile: edge.target.slice(prefix.length).replace(/^\//, ''),
                            type: 'import',
                        });
                        break;
                    }
                }
            }
        }

        return edges;
    }
}
