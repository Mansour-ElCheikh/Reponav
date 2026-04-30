/** Implemented by Antigravity (2026-04-26) */
import { execSync } from 'child_process';
import type { TemporalIntelligence, FileChurn, KnowledgeMap, FileMetrics } from '../types';

const BOT_EMAIL_PATTERNS = ['[bot]', 'noreply@github.com', 'github-actions@', 'dependabot'];

function isBotEmail(email: string): boolean {
    const lower = email.toLowerCase();
    return BOT_EMAIL_PATTERNS.some(p => lower.includes(p));
}

/** Weight recent churn more heavily than stale churn. */
function recencyMultiplier(lastChangedUnix: number): number {
    const ageDays = (Date.now() / 1000 - lastChangedUnix) / 86400;
    if (ageDays < 30) return 1.5;
    if (ageDays < 90) return 1.2;
    if (ageDays < 180) return 1.0;
    return 0.8;
}

/**
 * Tier 6 Temporal Intelligence Analyzer.
 * 
 * Mines git history to identify code hotspots, ownership distribution,
 * and stability trends.
 */
export class TemporalAnalyzer {
    private readonly GIT_LOG_CMD = 'git log --pretty=format:"COMMIT|%ae|%an|%at" --name-only --diff-filter=AM';
    private readonly MAX_COMMIT_WINDOW = 5000;

    constructor(private readonly workspaceRoot: string) {}

    /**
     * Mines git history to identify code hotspots, ownership distribution,
     * and stability trends.
     * 
     * @param fileMetrics - Base file metrics used for complexity scoring.
     * @returns A promise resolving to temporal intelligence data.
     */
    public async analyze(fileMetrics: FileMetrics[]): Promise<TemporalIntelligence> {
        try {
            const rawLog = execSync(this.GIT_LOG_CMD, {
                cwd: this.workspaceRoot,
                encoding: 'utf8',
                maxBuffer: 100 * 1024 * 1024 // 100MB
            });

            const churnMap = new Map<string, { count: number; lastChanged: number }>();
            const authorshipMap = new Map<string, Map<string, { name: string; count: number }>>();

            const lines = rawLog.split('\n');
            let currentAuthorEmail = '';
            let currentAuthorName = '';
            let currentTimestamp = 0;
            let commitCount = 0;

            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed) continue;

                if (trimmed.startsWith('COMMIT|')) {
                    const parts = trimmed.split('|');
                    currentAuthorEmail = parts[1];
                    currentAuthorName = parts[2];
                    currentTimestamp = parseInt(parts[3], 10);
                    if (isBotEmail(currentAuthorEmail)) {
                        currentAuthorEmail = '';
                        continue;
                    }
                    commitCount++;
                    if (commitCount > this.MAX_COMMIT_WINDOW) break;
                    continue;
                }

                // Skip file entries attributed to filtered bot commits
                if (!currentAuthorEmail) continue;

                // It's a file path
                const filePath = trimmed;
                
                // Update churn
                const churn = churnMap.get(filePath) || { count: 0, lastChanged: 0 };
                churn.count++;
                if (currentTimestamp > churn.lastChanged) {
                    churn.lastChanged = currentTimestamp;
                }
                churnMap.set(filePath, churn);

                // Update authorship
                if (!authorshipMap.has(filePath)) {
                    authorshipMap.set(filePath, new Map());
                }
                const fileAuthors = authorshipMap.get(filePath)!;
                const authorData = fileAuthors.get(currentAuthorEmail) || { name: currentAuthorName, count: 0 };
                authorData.count++;
                fileAuthors.set(currentAuthorEmail, authorData);
            }

            const hotspots: FileChurn[] = [];
            const knowledge: KnowledgeMap[] = [];
            const metricsMap = new Map(fileMetrics.map(m => [m.path, m]));

            for (const [path, churn] of churnMap.entries()) {
                const metrics = metricsMap.get(path);
                if (!metrics) continue;

                // complexity = (lines / 100) * churn (raw correlation)
                const complexityScore = Math.round((metrics.lines / 100) * churn.count);
                // riskScore weights complexity by recency: hot recently-changed files rank higher
                const riskScore = Math.round(complexityScore * recencyMultiplier(churn.lastChanged));

                hotspots.push({
                    filePath: path,
                    commitCount: churn.count,
                    lastChangedAt: new Date(churn.lastChanged * 1000).toISOString(),
                    complexityScore,
                    riskScore,
                });

                // Ownership
                const fileAuthors = authorshipMap.get(path)!;
                const ownersList = Array.from(fileAuthors.entries()).map(([email, data]) => ({
                    name: data.name,
                    email,
                    commitCount: data.count,
                    percentage: Math.round((data.count / churn.count) * 100)
                })).sort((a, b) => b.commitCount - a.commitCount);

                knowledge.push({
                    filePath: path,
                    owners: ownersList
                });
            }

            // Global metrics
            const sortedHotspots = hotspots.sort((a, b) => b.riskScore - a.riskScore);
            const averageChurn = hotspots.length > 0 
                ? hotspots.reduce((acc, h) => acc + h.commitCount, 0) / hotspots.length 
                : 0;

            return {
                hotspots: sortedHotspots.slice(0, 50), // Top 50 hotspots
                knowledge: knowledge.slice(0, 50),
                averageChurn: Math.round(averageChurn * 10) / 10,
                mostUnstableFiles: sortedHotspots.slice(0, 10).map(h => h.filePath)
            };

        } catch (error) {
            console.error('[TemporalAnalyzer] Failed to run git log:', error);
            return {
                hotspots: [],
                knowledge: [],
                averageChurn: 0,
                mostUnstableFiles: []
            };
        }
    }
}
