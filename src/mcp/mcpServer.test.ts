/**
 * Tests for mcpServer — MCP adapter wrapping the headless CLI analyzer.
 *
 * Uses InMemoryTransport for in-process round-trip testing without
 * starting any network server.
 */
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest';
import { createMcpServer } from './mcpServer';

/**
 * Build a tiny git repo with multi-commit co-change history so the
 * change-coupling analyzer has signal. Returns the repo path.
 *
 * The analyzer needs:
 * - source-extension files (.ts/.py/.go/etc.)
 * - the same pair of files appearing together in >= minSupport (2) commits
 * - per-file ubiquity below the 0.8 threshold (so files can't appear in
 *   every commit)
 *
 * Recipe: 1 initial commit (every file), then 3 commits each touching
 * the SAME pair of files (a.ts + b.ts), and 2 decoy commits touching
 * unrelated files — keeps a.ts/b.ts ubiquity at ~4/6 ≈ 0.67.
 */
function buildCouplingFixtureRepo(): string {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'reponav-coupling-fixture-'));
    const git = (cmd: string) => execSync(`git -C "${repo}" ${cmd}`, { stdio: 'pipe' });
    const write = (rel: string, body: string) => {
        const full = path.join(repo, rel);
        fs.mkdirSync(path.dirname(full), { recursive: true });
        fs.writeFileSync(full, body);
    };

    git('init --quiet');
    git('config user.email coupling-fixture@reponav.local');
    git('config user.name coupling-fixture');

    // Initial commit: many files, none of which co-change yet.
    write('src/a.ts', 'export const a = 1;\n');
    write('src/b.ts', 'export const b = 1;\n');
    write('src/c.ts', 'export const c = 1;\n');
    write('src/d.ts', 'export const d = 1;\n');
    git('add -A');
    git('commit --quiet -m "initial"');

    // Three co-change commits on the SAME pair (a.ts, b.ts).
    for (let n = 1; n <= 3; n++) {
        fs.appendFileSync(path.join(repo, 'src/a.ts'), `// touch ${n}\n`);
        fs.appendFileSync(path.join(repo, 'src/b.ts'), `// touch ${n}\n`);
        git('add src/a.ts src/b.ts');
        git(`commit --quiet -m "co-change ${n}"`);
    }

    // Two decoy commits touching c.ts and d.ts independently. Keeps the
    // ubiquity of a.ts/b.ts under the 0.8 ubiquity-filter threshold.
    fs.appendFileSync(path.join(repo, 'src/c.ts'), '// solo c\n');
    git('add src/c.ts');
    git('commit --quiet -m "solo c"');
    fs.appendFileSync(path.join(repo, 'src/d.ts'), '// solo d\n');
    git('add src/d.ts');
    git('commit --quiet -m "solo d"');

    return repo;
}

// ─── Shared client factory ────────────────────────────────────────────────────

async function makeClient(): Promise<Client> {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createMcpServer();
    await server.connect(serverTransport);
    const client = new Client({ name: 'test-client', version: '0.0.1' });
    await client.connect(clientTransport);
    return client;
}

async function expectMissingRepoError(toolName: string): Promise<void> {
    const client = await makeClient();
    const result = await client.callTool({ name: toolName, arguments: {} });
    expect(result.isError).toBe(true);
    await client.close();
}

// ─── Tool Registration ────────────────────────────────────────────────────────

describe('createMcpServer — tool registration', () => {
    it('lists all 10 expected tools', async () => {
        const client = await makeClient();
        const { tools } = await client.listTools();
        const names = tools.map(t => t.name).sort();
        expect(names).toEqual([
            'analyze', 'blast-radius', 'check', 'coupling',
            'dead-code', 'flows', 'impact', 'layer-violations',
            'risk', 'seams',
        ]);
        await client.close();
    });

    it('analyze tool has repo and format properties with summary/compact/json enum', async () => {
        const client = await makeClient();
        const { tools } = await client.listTools();
        const tool = tools.find(t => t.name === 'analyze')!;
        expect(tool.inputSchema.properties).toHaveProperty('repo');
        expect(tool.inputSchema.properties).toHaveProperty('format');
        const format = (tool.inputSchema.properties as Record<string, { enum?: string[] }>).format;
        expect(format.enum).toContain('summary');
        expect(format.enum).toContain('compact');
        expect(format.enum).toContain('json');
        await client.close();
    });

    it('layer-violations tool exposes repo and top properties', async () => {
        const client = await makeClient();
        const { tools } = await client.listTools();
        const tool = tools.find(t => t.name === 'layer-violations')!;
        expect(tool.inputSchema.properties).toHaveProperty('repo');
        expect(tool.inputSchema.properties).toHaveProperty('top');
        await client.close();
    });

    it('dead-code tool exposes repo and top properties', async () => {
        const client = await makeClient();
        const { tools } = await client.listTools();
        const tool = tools.find(t => t.name === 'dead-code')!;
        expect(tool.inputSchema.properties).toHaveProperty('repo');
        expect(tool.inputSchema.properties).toHaveProperty('top');
        await client.close();
    });

    it('impact tool exposes repo, symbol, and file properties', async () => {
        const client = await makeClient();
        const { tools } = await client.listTools();
        const tool = tools.find(t => t.name === 'impact')!;
        expect(tool.inputSchema.properties).toHaveProperty('repo');
        expect(tool.inputSchema.properties).toHaveProperty('symbol');
        expect(tool.inputSchema.properties).toHaveProperty('file');
        await client.close();
    });
});

describe('createMcpServer — repo-required tools', () => {
    it.each([
        'analyze',
        'layer-violations',
        'dead-code',
        'coupling',
        'flows',
        'check',
    ])('returns an error for %s when repo is missing', async (toolName) => {
        await expectMissingRepoError(toolName);
    });
});

// ─── analyze tool ─────────────────────────────────────────────────────────────

describe('createMcpServer — analyze tool', () => {
    it('returns workspaceRoot and hotFiles for a valid repo (default summary format)', async () => {
        const client = await makeClient();
        const result = await client.callTool({
            name: 'analyze',
            arguments: { repo: process.cwd() },
        });
        expect(result.isError).toBeFalsy();
        const parsed = JSON.parse((result.content as Array<{ type: string; text: string }>)[0].text);
        expect(parsed).toHaveProperty('workspaceRoot');
        expect(parsed).toHaveProperty('hotFiles');
        expect(parsed).toHaveProperty('orphanCount');
        expect(parsed).toHaveProperty('completeness');
        expect((parsed.hotFiles as unknown[]).length).toBeGreaterThan(0);
        expect(parsed).not.toHaveProperty('metrics'); // fileMetrics must be absent
        expect(parsed.completeness).toEqual(expect.objectContaining({
            analysisScope: 'fullWorkspace',
            analysisCoverage: 'complete',
            graphCoverage: 'complete',
        }));
        await client.close();
    }, 30_000);

    it('returns an error when repo path does not exist', async () => {
        const client = await makeClient();
        const result = await client.callTool({
            name: 'analyze',
            arguments: { repo: '/nonexistent/path/12345', format: 'json' },
        });
        expect(result.isError).toBe(true);
        await client.close();
    });
});

// ─── layer-violations tool ────────────────────────────────────────────────────

describe('createMcpServer — layer-violations tool', () => {
    it('returns a non-empty layerViolations array for this repo', async () => {
        const client = await makeClient();
        const result = await client.callTool({
            name: 'layer-violations',
            arguments: { repo: process.cwd() },
        });
        expect(result.isError).toBeFalsy();
        const parsed = JSON.parse((result.content as Array<{ type: string; text: string }>)[0].text);
        expect(parsed).toHaveProperty('layerViolations');
        expect(Array.isArray(parsed.layerViolations)).toBe(true);
        // This repo has known violations — empty array means the stub adapter bug is back
        expect(parsed.layerViolations.length).toBeGreaterThan(0);
        await client.close();
    }, 30_000);

    it('respects the top param and returns at most n violations', async () => {
        const client = await makeClient();
        const result = await client.callTool({
            name: 'layer-violations',
            arguments: { repo: process.cwd(), top: 3 },
        });
        expect(result.isError).toBeFalsy();
        const parsed = JSON.parse((result.content as Array<{ type: string; text: string }>)[0].text);
        expect(parsed.layerViolations.length).toBeLessThanOrEqual(3);
        await client.close();
    }, 30_000);

});

// ─── blast-radius tool ────────────────────────────────────────────────────────

describe('createMcpServer — blast-radius tool', () => {
    it('returns non-empty dependents for src/analyzers/index.ts (central file)', async () => {
        const client = await makeClient();
        const result = await client.callTool({
            name: 'blast-radius',
            arguments: { repo: process.cwd(), file: 'src/analyzers/index.ts' },
        });
        expect(result.isError).toBeFalsy();
        const parsed = JSON.parse((result.content as Array<{ type: string; text: string }>)[0].text);
        expect(parsed).toHaveProperty('directDependents');
        expect(parsed).toHaveProperty('transitiveDependents');
        // src/analyzers/index.ts is imported by many files — empty means path bug is back
        expect(parsed.directDependents.length).toBeGreaterThan(0);
        await client.close();
    }, 30_000);

    it('returns empty transitive dependents for src/extension.ts (only its test file imports it)', async () => {
        const client = await makeClient();
        const result = await client.callTool({
            name: 'blast-radius',
            arguments: { repo: process.cwd(), file: 'src/extension.ts' },
        });
        expect(result.isError).toBeFalsy();
        const parsed = JSON.parse((result.content as Array<{ type: string; text: string }>)[0].text);
        // Only extension.test.ts imports extension.ts; nothing imports the test — transitive must be empty
        expect(parsed.transitiveDependents).toEqual([]);
        await client.close();
    }, 30_000);

    it('returns an error when file argument is missing', async () => {
        const client = await makeClient();
        const result = await client.callTool({ name: 'blast-radius', arguments: { repo: process.cwd() } });
        expect(result.isError).toBe(true);
        await client.close();
    });
});

// ─── dead-code tool ───────────────────────────────────────────────────────────

describe('createMcpServer — dead-code tool', () => {
    it('returns a deadCode array for a valid repo', async () => {
        const client = await makeClient();
        const result = await client.callTool({
            name: 'dead-code',
            arguments: { repo: process.cwd() },
        });
        expect(result.isError).toBeFalsy();
        const parsed = JSON.parse((result.content as Array<{ type: string; text: string }>)[0].text);
        expect(parsed).toHaveProperty('deadCode');
        expect(Array.isArray(parsed.deadCode)).toBe(true);
        // This repo has dead code candidates — empty array means the adapter is broken
        expect(parsed.deadCode.length).toBeGreaterThan(0);
        await client.close();
    }, 60_000);

    it('respects the top param', async () => {
        const client = await makeClient();
        const result = await client.callTool({
            name: 'dead-code',
            arguments: { repo: process.cwd(), top: 5 },
        });
        expect(result.isError).toBeFalsy();
        const parsed = JSON.parse((result.content as Array<{ type: string; text: string }>)[0].text);
        expect(parsed.deadCode.length).toBeLessThanOrEqual(5);
        await client.close();
    }, 60_000);

});

// ─── coupling tool ────────────────────────────────────────────────────────────

describe('createMcpServer — coupling tool', () => {
    let fixtureRepo: string;

    beforeAll(() => {
        // Build a self-contained git repo with deterministic co-change history
        // so the test does not depend on the ambient cwd having usable history
        // (CI clones a single squashed commit — no co-change signal there).
        fixtureRepo = buildCouplingFixtureRepo();
    });

    afterAll(() => {
        if (fixtureRepo) fs.rmSync(fixtureRepo, { recursive: true, force: true });
    });

    it('returns a coupling array for a valid git repo', async () => {
        const client = await makeClient();
        const result = await client.callTool({
            name: 'coupling',
            arguments: { repo: fixtureRepo },
        });
        expect(result.isError).toBeFalsy();
        const parsed = JSON.parse((result.content as Array<{ type: string; text: string }>)[0].text);
        expect(parsed).toHaveProperty('coupling');
        expect(Array.isArray(parsed.coupling)).toBe(true);
        // Fixture has 3 commits touching (a.ts, b.ts) → analyzer must surface it.
        expect(parsed.coupling.length).toBeGreaterThan(0);
        await client.close();
    }, 30_000);

    it('respects the top param', async () => {
        const client = await makeClient();
        const result = await client.callTool({
            name: 'coupling',
            arguments: { repo: fixtureRepo, top: 4 },
        });
        expect(result.isError).toBeFalsy();
        const parsed = JSON.parse((result.content as Array<{ type: string; text: string }>)[0].text);
        expect(parsed.coupling.length).toBeLessThanOrEqual(4);
        await client.close();
    }, 30_000);

});

// ─── flows tool ───────────────────────────────────────────────────────────────

describe('createMcpServer — flows tool', () => {
    it('returns a flows array for a valid repo', async () => {
        const client = await makeClient();
        const result = await client.callTool({
            name: 'flows',
            arguments: { repo: process.cwd() },
        });
        expect(result.isError).toBeFalsy();
        const parsed = JSON.parse((result.content as Array<{ type: string; text: string }>)[0].text);
        expect(parsed).toHaveProperty('flows');
        expect(Array.isArray(parsed.flows)).toBe(true);
        // This repo has entry points — empty flows means the detector is broken
        expect(parsed.flows.length).toBeGreaterThan(0);
        await client.close();
    }, 60_000);

});

// ─── impact tool ─────────────────────────────────────────────────────────────

describe('createMcpServer — impact tool', () => {
    it('returns blast radius for a known symbol', async () => {
        const client = await makeClient();
        const result = await client.callTool({
            name: 'impact',
            arguments: { repo: process.cwd(), symbol: 'analyzeTier1' },
        });
        expect(result.isError).toBeFalsy();
        const parsed = JSON.parse((result.content as Array<{ type: string; text: string }>)[0].text);
        expect(parsed).toHaveProperty('origin');
        expect(parsed).toHaveProperty('directCallers');
        expect(parsed).toHaveProperty('transitiveCallers');
        expect(parsed).toHaveProperty('score');
        expect(parsed.origin).toBe('analyzeTier1');
        expect(parsed.score).toBeGreaterThan(0);
        await client.close();
    }, 60_000);

    it('returns an error when symbol is missing', async () => {
        const client = await makeClient();
        const result = await client.callTool({ name: 'impact', arguments: { repo: process.cwd() } });
        expect(result.isError).toBe(true);
        await client.close();
    });
});

// ─── check tool ───────────────────────────────────────────────────────────────

describe('createMcpServer — check tool', () => {
    it('returns a summary with violations, deadCode, blastRadius, and breaches', async () => {
        const client = await makeClient();
        const result = await client.callTool({
            name: 'check',
            arguments: { repo: process.cwd() },
        });
        expect(result.isError).toBeFalsy();
        const parsed = JSON.parse((result.content as Array<{ type: string; text: string }>)[0].text);
        expect(parsed).toHaveProperty('violations');
        expect(parsed).toHaveProperty('deadCode');
        expect(parsed).toHaveProperty('blastRadius');
        expect(parsed).toHaveProperty('breaches');
        expect(Array.isArray(parsed.breaches)).toBe(true);
        await client.close();
    }, 60_000);

    it('reports a breach when max-violations threshold is set below actual count', async () => {
        const client = await makeClient();
        const result = await client.callTool({
            name: 'check',
            arguments: { repo: process.cwd(), maxViolations: 0 },
        });
        expect(result.isError).toBeFalsy();
        const parsed = JSON.parse((result.content as Array<{ type: string; text: string }>)[0].text);
        // This repo has known violations, so maxViolations:0 must trigger a breach
        expect(parsed.breaches.length).toBeGreaterThan(0);
        await client.close();
    }, 60_000);

});
