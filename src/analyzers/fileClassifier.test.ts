import { describe, it, expect } from 'vitest';
import { classifyFiles, getClassificationSummary } from './fileClassifier';

// Helper: build a Map<string,string> from an array of paths
function makeFiles(paths: string[]): Map<string, string> {
    return new Map(paths.map((p) => [p, '']));
}

// Helper: classify a single file and return its category
async function cat(filePath: string): Promise<string> {
    const result = await classifyFiles(makeFiles([filePath]));
    return result[0].category;
}

describe('fileClassifier — existing rules (GREEN baseline)', () => {
    it.each<readonly [string, readonly string[], string]>([
        ['test files', ['src/__tests__/foo.ts', 'src/foo.test.ts', 'src/foo.spec.tsx'], 'test'],
        ['config files', ['vite.config.ts', 'tsconfig.json', 'package.json', '.env.production'], 'config'],
        ['component files', ['src/components/Button.tsx', 'src/Header.jsx'], 'component'],
        ['service files', ['src/services/AuthService.ts', 'src/auth.service.ts'], 'service'],
        ['model files', ['src/models/User.ts'], 'model'],
        ['utility files', ['src/utils/format.ts', 'src/helpers/date.ts', 'src/lib/http.ts'], 'utility'],
        ['type files', ['src/foo.d.ts', 'src/types/index.ts'], 'type'],
        ['entry point files', ['src/main.ts', 'src/index.ts'], 'entry'],
    ])('classifies %s', async (_label, filePaths, expectedCategory) => {
        for (const filePath of filePaths) {
            expect(await cat(filePath)).toBe(expectedCategory);
        }
    });

    it.each<readonly [string, string]>([
        ['styles/main.css', 'style'],
        ['assets/logo.png', 'asset'],
    ])('classifies %s as %s', async (filePath, expectedCategory) => {
        expect(await cat(filePath)).toBe(expectedCategory);
    });

    it('returns unknown for unmatched files', async () => {
        expect(await cat('src/random-unclassified-file.ts')).toBe('unknown');
    });
});

describe('fileClassifier — new framework/Vite rules (RED until implemented)', () => {
    // React hooks
    it.each<readonly [string, readonly string[], string]>([
        ['React hook files', ['src/hooks/useAuth.ts', 'src/useTheme.ts', 'webview/src/hooks/useGraph.tsx'], 'utility'],
        ['store/state files', ['src/store/authSlice.ts', 'src/store/index.ts', 'src/auth.store.ts', 'src/auth.slice.ts', 'src/auth.reducer.ts'], 'service'],
        ['React context files', ['src/context/AuthContext.tsx', 'src/AuthContext.tsx', 'src/auth.context.ts'], 'component'],
        ['adapter and provider files', ['src/adapters/HttpAdapter.ts', 'src/http.adapter.ts', 'src/auth.provider.ts'], 'service'],
        ['repository files', ['src/repositories/UserRepo.ts', 'src/user.repository.ts'], 'model'],
        ['constants files', ['src/constants/routes.ts', 'src/app.constants.ts'], 'type'],
        ['validator and schema files', ['src/validators/UserValidator.ts', 'src/user.validator.ts', 'src/user.schema.ts'], 'utility'],
        ['mock and fixture files', ['src/__mocks__/MockProvider.ts', 'src/fixtures/userData.ts', 'src/auth.mock.ts'], 'test'],
        ['plugin files', ['plugins/myPlugin.ts', 'src/plugins/vitePlugin.ts'], 'config'],
    ])('classifies %s as %s', async (_label, filePaths, expectedCategory) => {
        for (const filePath of filePaths) {
            expect(await cat(filePath)).toBe(expectedCategory);
        }
    });

    // Workers
    it('classifies the web worker suffix as utility', async () => {
        expect(await cat('src/analysis.worker.ts')).toBe('utility');
    });

    // Guards / interceptors / pipes (NestJS/middleware-like)
    it('classifies guard, interceptor, pipe files as middleware', async () => {
        expect(await cat('src/guards/AuthGuard.ts')).toBe('middleware');
        expect(await cat('src/auth.guard.ts')).toBe('middleware');
        expect(await cat('src/interceptors/LogInterceptor.ts')).toBe('middleware');
        expect(await cat('src/auth.interceptor.ts')).toBe('middleware');
        expect(await cat('src/pipes/ValidationPipe.ts')).toBe('middleware');
    });

    // Dot-config directories
    it('classifies .github, .reponav, .claude dirs as config', async () => {
        expect(await cat('.github/workflows/ci.yml')).toBe('config');
        expect(await cat('.reponav/governance.yaml')).toBe('config');
        expect(await cat('.claude/settings.json')).toBe('config');
    });

    // bin/ scripts
    it('classifies bin/ scripts as entry', async () => {
        expect(await cat('bin/reponav.ts')).toBe('entry');
    });

    it('does not classify nested index barrels and smoke scripts as entry points', async () => {
        expect(await cat('src/analyzers/index.ts')).not.toBe('entry');
        expect(await cat('presentation/src/index.ts')).not.toBe('entry');
        expect(await cat('scripts/smoke/index.js')).not.toBe('entry');
    });
});

describe('fileClassifier — tool/library domain patterns (RepoNav self-classification)', () => {
    // These rules are needed to classify domain-specific source directories in
    // tool/library repos that don't use conventional web-app naming (services/, controllers/).

    it.each<readonly [string, readonly string[]]>([
        ['analyzers', ['src/analyzers/fileClassifier.ts', 'src/analyzers/graphStructuralClassifier.ts', 'analyzers/codeParser.py']],
        ['commands', ['src/commands/commandHandlers.ts', 'src/commands/tourCommands.ts']],
        ['ai', ['src/ai/tourGenerator.ts', 'src/ai/DynamicLLMProvider.ts', 'src/ai/prompts.ts']],
        ['db', ['src/db/RepoDatabase.ts', 'src/db/schema.ts']],
        ['mcp', ['src/mcp/McpServer.ts', 'src/mcp/transport.ts']],
        ['tours', ['src/tours/tourSerializer.ts', 'src/tours/TourPlayer.ts']],
        ['governance', ['src/governance/coreRules.ts', 'src/governance/engine.ts']],
        ['git', ['src/git/GitProvider.ts', 'src/git/diff.ts']],
        ['runtime', ['src/runtime/Loader.ts', 'src/runtime/wasm.ts']],
    ])('%s/ directory → service', async (_directory, filePaths) => {
        for (const filePath of filePaths) {
            expect(await cat(filePath)).toBe('service');
        }
    });

    it('scripts/ directory → utility', async () => {
        expect(await cat('scripts/governance-audit.js')).toBe('utility');
        expect(await cat('scripts/postbuild-extension.js')).toBe('utility');
    });
});

describe('fileClassifier — Tier 0 library source pre-empt', () => {
    // These rows are the labeled fixture for the Tier 0 pre-empt contract:
    // ANY file whose first path segment is a known library package name must
    // return 'libSource' regardless of what Pass 1 rules or Pass 2 content
    // signals would otherwise produce.

    it.each([
        'fastapi/__init__.py',
        'fastapi/routing.py',
        'fastapi/v2.py',
        'starlette/middleware/base.py',
        'pydantic/main.py',
    ])('%s → libSource', async (filePath) => {
        expect(await cat(filePath)).toBe('libSource');
    });

    it('app/routes/users.py → NOT libSource (app-level file)', async () => {
        expect(await cat('app/routes/users.py')).not.toBe('libSource');
    });

    it('src/fastapi_app/users.py → NOT libSource (app-level; fastapi_app is not a known library package)', async () => {
        expect(await cat('src/fastapi_app/users.py')).not.toBe('libSource');
    });
});

describe('getClassificationSummary', () => {
    it('groups classifications by category', async () => {
        const files = makeFiles(['a.test.ts', 'b.test.ts', 'src/main.ts']);
        const classifications = await classifyFiles(files);
        const summary = getClassificationSummary(classifications);
        expect(summary['test']).toHaveLength(2);
        expect(summary['entry']).toHaveLength(1);
    });
});
