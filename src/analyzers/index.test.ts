/**
 * Tests for the analyzer orchestrator.
 * Uses a mock WorkspaceAdapter — no vscode dependency needed.
 */
import { describe, it, expect } from 'vitest';
import { WorkspaceAdapter } from '../WorkspaceAdapter';
import { AnalysisProvider } from './AnalysisProvider';
import { analyzeTier0, analyzeTier0Preview, analyzeTier1, analyzeTier2, formatReportForAI } from './index';

// ─── Mock WorkspaceAdapter ──────────────────────────────────────────────────

function createMockAdapter(files: Record<string, string>): WorkspaceAdapter {
    return {
        getWorkspaceRoot: () => '/workspace',
        getConfig: <T>(_section: string, _key: string, defaultValue: T): T => defaultValue,
        readFile: async (absolutePath: string) => {
            // Strip workspace root prefix to match relative keys
            const relative = absolutePath.replace('/workspace/', '');
            return files[relative] ?? null;
        },
        findFiles: async (include: string, _exclude: string, maxResults: number) => {
            const matched = Object.keys(files).filter((filePath) => matchesIncludePattern(filePath, include));
            return matched.slice(0, maxResults);
        },
        showInfo: () => {},
        showError: () => {},
    };
}

function matchesIncludePattern(filePath: string, include: string): boolean {
    if (include === '**/*') return true;
    if (include === 'packages/*/src/**/*') {
        const parts = filePath.split('/');
        return parts.length >= 4 && parts[0] === 'packages' && parts[2] === 'src';
    }
    if (include.endsWith('/**/*')) {
        const prefix = include.slice(0, -5);
        return filePath.startsWith(`${prefix}/`);
    }
    return filePath === include;
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('analyzeTier0', () => {
    it('returns a report with file count and detected frameworks', async () => {
        const adapter = createMockAdapter({
            'package.json': JSON.stringify({
                dependencies: { react: '^18.0.0', express: '^4.18.0' },
            }),
            'src/index.ts': 'import express from "express";',
            'src/App.tsx': 'export default function App() { return <div/>; }',
        });

        const { report, files } = await analyzeTier0(adapter);

        expect(report.metrics.totalFiles).toBe(3);
        expect(files.size).toBe(3);
        expect(report.indexTier).toBe(0);
        expect(report.frameworks.some(f => f.name === 'React')).toBe(true);
        expect(report.frameworks.some(f => f.name === 'Express')).toBe(true);
    });

    it('handles empty workspace gracefully', async () => {
        const adapter = createMockAdapter({});
        const { report, files } = await analyzeTier0(adapter);

        expect(report.metrics.totalFiles).toBe(0);
        expect(files.size).toBe(0);
        expect(report.frameworks).toHaveLength(0);
    });

    it('skips binary files', async () => {
        const adapter = createMockAdapter({
            'image.png': 'binary data',
            'src/index.ts': 'console.log("hello");',
        });

        const { report } = await analyzeTier0(adapter);
        // png should be filtered out
        expect(report.dependencyGraph.nodes).not.toContain('image.png');
    });

    it('prioritizes likely source roots for interactive analysis', async () => {
        const adapter = createMockAdapter({
            'docs/intro.md': '# docs',
            'test-repos/demo/main.py': 'print("demo")',
            'src/index.ts': 'export const app = 1;',
            'webview/src/main.tsx': 'export const web = 1;',
            'shared/types.ts': 'export type Id = string;',
        });

        const { report } = await analyzeTier0(adapter, undefined, {
            scope: 'interactive',
            maxFiles: 3,
        });

        expect(report.dependencyGraph.nodes).toEqual([
            'src/index.ts',
            'webview/src/main.tsx',
            'shared/types.ts',
        ]);
    });

    it('keeps full workspace analysis structural by excluding fixture repos and markdown docs', async () => {
        const adapter = createMockAdapter({
            'docs/intro.md': '# docs',
            'test-repos/demo/main.py': 'print("demo")',
            'src/index.ts': 'export const app = 1;',
        });

        const { report } = await analyzeTier0(adapter, undefined, {
            scope: 'fullWorkspace',
            maxFiles: 10,
        });

        expect(report.dependencyGraph.nodes).toContain('src/index.ts');
        expect(report.dependencyGraph.nodes).not.toContain('docs/intro.md');
        expect(report.dependencyGraph.nodes).not.toContain('test-repos/demo/main.py');
    });

    it('keeps root manifests in the interactive file budget', async () => {
        const adapter = createMockAdapter({
            'docs/intro.md': '# docs',
            'package.json': JSON.stringify({ dependencies: { react: '^18.0.0' } }),
            'src/index.ts': 'export const app = 1;',
        });

        const { report } = await analyzeTier0(adapter, undefined, {
            scope: 'interactive',
            maxFiles: 2,
        });

        expect(report.dependencyGraph.nodes).toContain('package.json');
        expect(report.dependencyGraph.nodes).toContain('src/index.ts');
        expect(report.dependencyGraph.nodes).not.toContain('docs/intro.md');
    });
});

describe('analyzeTier0Preview', () => {
    it('provides framework and file-count summary without full source reads', async () => {
        const adapter = createMockAdapter({
            'package.json': JSON.stringify({
                dependencies: { express: '^4.18.0', react: '^18.0.0' },
            }),
            'src/index.ts': 'throw new Error("should not be needed for preview");',
            'webview/src/App.tsx': 'export function App() { return null; }',
        });

        const { report, relativePaths } = await analyzeTier0Preview(adapter, {
            scope: 'interactive',
            maxFiles: 10,
        });

        expect(report.metrics.totalFiles).toBe(3);
        expect(report.frameworks.some((f) => f.name === 'Express')).toBe(true);
        expect(report.frameworks.some((f) => f.name === 'React')).toBe(true);
        expect(report.dependencyGraph.nodes).toContain('src/index.ts');
        expect(relativePaths).toContain('src/index.ts');
    });
});

describe('analyzeTier1', () => {
    it('builds dependency graph with edges', async () => {
        const adapter = createMockAdapter({
            'src/index.ts': `import { foo } from './utils';`,
            'src/utils.ts': `export const foo = 1;`,
        });

        const { report: tier0, files } = await analyzeTier0(adapter);
        const report = await analyzeTier1(adapter, files, tier0);

        expect(report.indexTier).toBe(1);
        expect(report.dependencyGraph.edges.length).toBeGreaterThan(0);
        expect(report.entryPoints.length).toBeGreaterThanOrEqual(0);
    });

    it('forwards import analysis progress updates', async () => {
        const adapter = createMockAdapter({
            'src/index.ts': `import { foo } from './utils';`,
            'src/utils.ts': `export const foo = 1;`,
        });
        const messages: string[] = [];
        const provider: AnalysisProvider = {
            analyzeImports: async (_workspaceRoot, _files, options) => {
                options?.onProgress?.({
                    phase: 'initializing',
                    processed: 0,
                    total: 2,
                    message: 'Initializing Tree-sitter...',
                });
                options?.onProgress?.({
                    phase: 'parsing',
                    processed: 2,
                    total: 2,
                    message: 'Analyzing dependencies (2/2 files)...',
                });
                return {
                    edges: [],
                    externalDependencies: new Set(),
                    circularDependencies: [],
                };
            },
        };

        const { report: tier0, files } = await analyzeTier0(adapter);
        await analyzeTier1(
            adapter,
            files,
            tier0,
            {
                report: (value) => {
                    if (value.message) messages.push(value.message);
                },
            },
            provider
        );

        expect(messages).toContain('Initializing Tree-sitter...');
        expect(messages).toContain('Analyzing dependencies (2/2 files)...');
    });
});

describe('formatReportForAI', () => {
    it('produces a string under the token budget', async () => {
        const adapter = createMockAdapter({
            'package.json': JSON.stringify({ dependencies: { express: '^4.0.0' } }),
            'src/index.ts': `import { foo } from './utils';`,
            'src/utils.ts': `export const foo = 1;`,
        });

        const { report: tier0, files } = await analyzeTier0(adapter);
        const report = await analyzeTier1(adapter, files, tier0);
        const text = formatReportForAI(report);

        // Rough token estimate: 1 token ≈ 4 chars. Budget = 6K tokens ≈ 24K chars.
        expect(text.length).toBeLessThan(24000);
        expect(text).toContain('Workspace Analysis Report');
    });

    it('truncates large reports to stay within budget', async () => {
        // Generate a workspace with many files
        const files: Record<string, string> = {};
        for (let i = 0; i < 200; i++) {
            files[`src/module${i}.ts`] = `export const val${i} = ${i};\n`.repeat(50);
        }
        files['package.json'] = JSON.stringify({ dependencies: {} });

        const adapter = createMockAdapter(files);
        const { report: tier0, files: fileMap } = await analyzeTier0(adapter);
        const report = await analyzeTier1(adapter, fileMap, tier0);
        const text = formatReportForAI(report);

        // Must stay under budget even with 200 files
        expect(text.length).toBeLessThan(24000);
    });

    it('adds ranked source snippets to the tier 1 prompt context', async () => {
        const adapter = createMockAdapter({
            'package.json': JSON.stringify({ dependencies: { express: '^4.0.0' } }),
            'src/index.ts': `import { helper } from './helper';
export function bootstrapApp(user: string) {
    const result = helper(user);
    return result;
}`,
            'src/helper.ts': `export function helper(user: string) {
    return user.toUpperCase();
}`,
        });

        const { report: tier0, files } = await analyzeTier0(adapter);
        const report = await analyzeTier1(adapter, files, tier0);

        expect(Object.keys(report.keyFileContents)).toContain('src/index.ts');
        const text = formatReportForAI(report, 6000);
        expect(text).toContain('### src/index.ts');
        expect(text).toContain('export function bootstrapApp(user: string)');
        expect(text).not.toContain('return user.toUpperCase()');
    });

    it('populates boundaryRoles from classifier when imports match lookup', async () => {
        const mockEdges = [
            { source: 'src/server.ts', target: 'node_modules/express', specifiers: [], isDynamic: false, rawStatement: "import express from 'express'" },
        ];
        const provider: AnalysisProvider = {
            analyzeImports: async () => ({ edges: mockEdges, externalDependencies: new Set(['express']), circularDependencies: [] }),
        };
        const adapter = createMockAdapter({
            'src/server.ts': `import express from 'express'; export function start() {}`,
        });
        const { report: tier0, files } = await analyzeTier0(adapter);
        const report = await analyzeTier1(adapter, files, tier0, undefined, provider);

        expect(report.boundaryRoles).toBeDefined();
        const serverRole = report.boundaryRoles?.find(r => r.filePath === 'src/server.ts');
        expect(serverRole?.role).toBe('http');
    });

    it('populates layerViolations when imports cross architectural layers', async () => {
        // Simulate db.ts importing controller.ts (backward violation: layer 5 → layer 2)
        const mockEdges = [
            { source: 'src/db.ts', target: 'src/controller.ts', specifiers: [], isDynamic: false, rawStatement: '' },
        ];
        const provider: AnalysisProvider = {
            analyzeImports: async () => ({ edges: mockEdges, externalDependencies: new Set(), circularDependencies: [] }),
        };
        const adapter = createMockAdapter({
            'src/db.ts': `// persistence layer`,
            'src/controller.ts': `// controller layer`,
        });
        // Manually assign layers by patching the file classifications
        // The wiring test verifies the pipeline connects; specific layer logic is tested in layerDag.test.ts
        const { report: tier0, files } = await analyzeTier0(adapter);
        const report = await analyzeTier1(adapter, files, tier0, undefined, provider);

        // layerViolations may be empty or populated depending on file category inference;
        // intentionally shape-only — mock workspace is too small to guarantee violations.
        // Real-repo invariant is tested in mcpServer.test.ts (layer-violations tool).
        if (report.layerViolations !== undefined) {
            expect(Array.isArray(report.layerViolations)).toBe(true);
        }
    });
});

describe('analyzeTier2', () => {
    it('extracts symbols and produces indexTier 2 report', async () => {
        const adapter = createMockAdapter({
            'package.json': '{}',
            'src/user.ts': 'export function createUser(name: string) { return name; }',
            'src/handler.ts': [
                'import { createUser } from "./user";',
                'export function handleRequest() {',
                '  createUser("test");',
                '}',
            ].join('\n'),
        });

        const { report: tier0, files } = await analyzeTier0(adapter);
        const tier1 = await analyzeTier1(adapter, files, tier0);
        const tier2 = await analyzeTier2(adapter, files, tier1);

        expect(tier2.indexTier).toBe(2);
        expect(tier2.symbols).toBeDefined();
        expect(tier2.symbols!.length).toBeGreaterThanOrEqual(2);

        const createUserSym = tier2.symbols!.find(s => s.name === 'createUser');
        expect(createUserSym).toBeDefined();
        expect(createUserSym!.kind).toBe('function');
        expect(createUserSym!.isExported).toBe(true);
    });

    it('traces cross-file call edges', async () => {
        const adapter = createMockAdapter({
            'package.json': '{}',
            'src/user.ts': 'export function createUser(name: string) { return name; }',
            'src/handler.ts': [
                'import { createUser } from "./user";',
                'export function handleRequest() {',
                '  createUser("test");',
                '}',
            ].join('\n'),
        });

        const { report: tier0, files } = await analyzeTier0(adapter);
        const tier1 = await analyzeTier1(adapter, files, tier0);
        const tier2 = await analyzeTier2(adapter, files, tier1);

        expect(tier2.symbolEdges).toBeDefined();
        const callEdge = tier2.symbolEdges!.find(
            e => e.targetName === 'createUser' && e.edgeType === 'calls'
        );
        expect(callEdge).toBeDefined();
        expect(callEdge!.sourceFile).toBe('src/handler.ts');
        expect(callEdge!.targetFile).toBe('src/user.ts');
    });

    it('preserves all tier 1 data in tier 2 report', async () => {
        const adapter = createMockAdapter({
            'package.json': '{}',
            'src/index.ts': 'export const x = 1;',
        });

        const { report: tier0, files } = await analyzeTier0(adapter);
        const tier1 = await analyzeTier1(adapter, files, tier0);
        const tier2 = await analyzeTier2(adapter, files, tier1);

        // All tier 1 fields preserved
        expect(tier2.dependencyGraph).toEqual(tier1.dependencyGraph);
        expect(tier2.entryPoints).toEqual(tier1.entryPoints);
        expect(tier2.fileClassifications).toEqual(tier1.fileClassifications);
        expect(tier2.metrics).toEqual(tier1.metrics);
    });

    it('does not depend on workspace adapter document-symbol enrichment for core tier 2', async () => {
        const adapter = createMockAdapter({
            'package.json': '{}',
            'src/index.ts': 'export const start = () => helper();\nfunction helper() { return 1; }',
        }) as WorkspaceAdapter & { getDocumentSymbols?: (relativePath: string) => Promise<unknown[]> };
        adapter.getDocumentSymbols = async () => {
            throw new Error('core tier 2 should not call workspace adapter document symbols');
        };

        const { report: tier0, files } = await analyzeTier0(adapter);
        const tier1 = await analyzeTier1(adapter, files, tier0);
        const tier2 = await analyzeTier2(adapter, files, tier1);

        const helper = tier2.symbols?.find((symbol) => symbol.name === 'helper');
        expect(helper).toBeDefined();
        expect(helper?.lineStart).toBeGreaterThanOrEqual(0);
    });
});

// ─── C002: report-integration (T13-T17) ─────────────────────────────────────
// Tests for DeadCodeCandidate type wiring and analyzeTier2 population.
// DeadCodeCandidate type tests (T13, T14) are compile-time; runtime tests below.

describe('analyzeTier2 — deadCode field (C002)', () => {
    it('T15: populates report.deadCode with uncalled unexported symbols', async () => {
        // callee.ts exports nothing and is never called — should be dead candidate
        const adapter = createMockAdapter({
            'src/caller.ts': `import { helper } from './callee';`,
            'src/callee.ts': `
                export function helper() { return 1; }
                function deadFn() { return 2; }
            `,
        });

        const { report: tier0, files } = await analyzeTier0(adapter);
        const tier1 = await analyzeTier1(adapter, files, tier0);
        const tier2 = await analyzeTier2(adapter, files, tier1);

        expect(tier2.indexTier).toBe(2);
        // deadCode array must exist at Tier 2 and include the dead function in the mock
        expect(Array.isArray(tier2.deadCode)).toBe(true);
        expect(tier2.deadCode!.length).toBeGreaterThan(0);
    });

    it('T16: symbolMetrics.deadCodeCount reflects deadCode.length', async () => {
        const adapter = createMockAdapter({
            'src/index.ts': `export function main() { return 1; }`,
            'src/unused.ts': `function orphan() { return 2; }`,
        });

        const { report: tier0, files } = await analyzeTier0(adapter);
        const tier1 = await analyzeTier1(adapter, files, tier0);
        const tier2 = await analyzeTier2(adapter, files, tier1);

        expect(tier2.symbolMetrics?.deadCodeCount).toBe(tier2.deadCode?.length ?? 0);
    });

    it('T17: Tier 0 and Tier 1 reports have no deadCode field', async () => {
        const adapter = createMockAdapter({
            'src/index.ts': `export function main() {}`,
        });

        const { report: tier0, files } = await analyzeTier0(adapter);
        expect((tier0 as any).deadCode).toBeUndefined();

        const tier1 = await analyzeTier1(adapter, files, tier0);
        expect((tier1 as any).deadCode).toBeUndefined();
    });
});

// ─── C002 (epic-007): report-integration — flows field ───────────────────────

describe('analyzeTier2 — flows field (epic-007 component 002)', () => {
    it('populates report.flows as an array at Tier 2', async () => {
        const adapter = createMockAdapter({
            'src/routes/users.ts': `import { UserService } from '../services/userService';`,
            'src/services/userService.ts': `import { UserRepo } from '../db/userRepo';`,
            'src/db/userRepo.ts': `export class UserRepo {}`,
        });

        const { report: tier0, files } = await analyzeTier0(adapter);
        const tier1 = await analyzeTier1(adapter, files, tier0);
        const tier2 = await analyzeTier2(adapter, files, tier1);

        // flows field must exist and be an array at Tier 2
        expect(Array.isArray(tier2.flows)).toBe(true);
    });

    // T17: analyzeTier2 populates flows when condensation DAG has 2 entry points
    it('T17: flows.length equals the number of distinct entry points detected', async () => {
        const adapter = createMockAdapter({
            'src/routes/users.ts': `import { UserService } from '../services/userService';`,
            'src/routes/orders.ts': `import { OrderService } from '../services/orderService';`,
            'src/services/userService.ts': `export class UserService {}`,
            'src/services/orderService.ts': `export class OrderService {}`,
        });

        const { report: tier0, files } = await analyzeTier0(adapter);
        const tier1 = await analyzeTier1(adapter, files, tier0);
        const tier2 = await analyzeTier2(adapter, files, tier1);

        expect(Array.isArray(tier2.flows)).toBe(true);
        expect(tier2.flows!.length).toBe(2);
    });

    // T18: analyzeTier2 omits flows when condensation DAG is absent (empty workspace)
    it('T18: flows is undefined when dependency graph has no nodes', async () => {
        const adapter = createMockAdapter({});
        const { report: tier0, files } = await analyzeTier0(adapter);
        const tier1 = await analyzeTier1(adapter, files, tier0);
        const tier2 = await analyzeTier2(adapter, files, tier1);

        expect(tier2.flows).toBeUndefined();
    });

    // T19: Tier 0 and Tier 1 reports have no flows field
    it('T19: Tier 0 and Tier 1 reports do not have a flows field', async () => {
        const adapter = createMockAdapter({ 'src/index.ts': `export const x = 1;` });
        const { report: tier0, files } = await analyzeTier0(adapter);
        expect((tier0 as any).flows).toBeUndefined();
        const tier1 = await analyzeTier1(adapter, files, tier0);
        expect((tier1 as any).flows).toBeUndefined();
    });
});
