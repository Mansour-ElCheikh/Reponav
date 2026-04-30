/**
 * File Classifier
 *
 * Categorizes files into architectural roles (component, service, model, etc.)
 * using directory conventions and naming patterns. Deterministic, no AI.
 */

import * as path from 'path';
import { FileClassification, FileCategory } from '../types';
import { enrichWithContentSignals } from './contentClassifier';

// ─── Classification Rules ────────────────────────────────────────────────────

interface ClassificationRule {
    category: FileCategory;
    confidence: 'high' | 'medium' | 'low';
    /** Match against the full relative path */
    pathPattern?: RegExp;
    /** Match against just the file name */
    namePattern?: RegExp;
    /** Match against file content */
    contentPattern?: RegExp;
    /** Human-readable reason */
    reason: string;
}

const RULES: ClassificationRule[] = [
    // ─── Tests ────────────────────────────────────────────────────────────────
    { category: 'test', confidence: 'high', pathPattern: /(?:^|[\\/])__tests__[\\/]/, reason: 'In __tests__ directory' },
    { category: 'test', confidence: 'high', pathPattern: /(?:^|[\\/])tests?[\\/]/, reason: 'In test(s) directory' },
    { category: 'test', confidence: 'high', namePattern: /\.(test|spec)\.(ts|tsx|js|jsx|py)$/, reason: 'Test/spec file naming' },
    { category: 'test', confidence: 'medium', namePattern: /^test_.*\.py$/, reason: 'Python test file convention' },

    // ─── Config ───────────────────────────────────────────────────────────────
    { category: 'config', confidence: 'high', namePattern: /^(tsconfig|jest\.config|vitest\.config|webpack\.config|vite\.config|next\.config|babel\.config|eslint\.config|prettier\.config)\.(ts|js|mjs|json)$/, reason: 'Build/tool config file' },
    { category: 'config', confidence: 'high', namePattern: /^\.env(\.\w+)?$/, reason: 'Environment config' },
    { category: 'config', confidence: 'high', namePattern: /^(package|composer|Cargo|go)\.(json|toml|mod)$/, reason: 'Package manifest' },
    { category: 'config', confidence: 'high', namePattern: /^(Dockerfile|docker-compose\.ya?ml|Makefile|Procfile)$/, reason: 'Infrastructure config' },
    { category: 'config', confidence: 'medium', pathPattern: /[\\/]config[\\/]/, reason: 'In config directory' },
    { category: 'config', confidence: 'medium', namePattern: /^settings\.(py|ts|js)$/, reason: 'Settings file' },

    // ─── Styles / Assets ──────────────────────────────────────────────────────
    { category: 'style', confidence: 'high', namePattern: /\.(css|scss|sass|less|styl)$/, reason: 'Stylesheet file' },
    { category: 'asset', confidence: 'high', namePattern: /\.(png|jpg|jpeg|gif|svg|ico|webp|mp4|webm|woff2?|ttf|eot)$/, reason: 'Static asset' },

    // ─── Migrations ───────────────────────────────────────────────────────────
    { category: 'migration', confidence: 'high', pathPattern: /[\\/]migrations?[\\/]/, reason: 'In migrations directory' },
    { category: 'migration', confidence: 'high', pathPattern: /[\\/]prisma[\\/]migrations[\\/]/, reason: 'Prisma migration' },

    // ─── Types ────────────────────────────────────────────────────────────────
    { category: 'type', confidence: 'high', namePattern: /\.d\.ts$/, reason: 'TypeScript declaration file' },
    { category: 'type', confidence: 'medium', pathPattern: /[\\/]types?[\\/]/, reason: 'In types directory' },
    { category: 'type', confidence: 'medium', namePattern: /types?\.(ts|py)$/, reason: 'Types file naming' },
    // ─── Constants (before routes — constants/routes.ts is a constants file) ──
    { category: 'type', confidence: 'high', pathPattern: /(?:^|[\/])constants?[\/]/, reason: 'In constants directory' },
    // ─── Routes ───────────────────────────────────────────────────────────────
    { category: 'route', confidence: 'high', pathPattern: /[\\/]app[\\/]api[\\/]/, reason: 'Next.js API route' },
    { category: 'route', confidence: 'high', pathPattern: /[\\/]pages[\\/]api[\\/]/, reason: 'Next.js Pages API route' },
    { category: 'route', confidence: 'medium', pathPattern: /[\\/]routes?[\\/]/, reason: 'In routes directory' },
    { category: 'route', confidence: 'medium', namePattern: /routes?\.(ts|js|py)$/, reason: 'Routes file naming' },

    // ─── Middleware ────────────────────────────────────────────────────────────
    { category: 'middleware', confidence: 'high', pathPattern: /[\\/]middleware[\\/]/, reason: 'In middleware directory' },
    { category: 'middleware', confidence: 'high', namePattern: /^middleware\.(ts|js)$/, reason: 'Middleware file' },

    // ─── Models ───────────────────────────────────────────────────────────────
    { category: 'model', confidence: 'high', pathPattern: /[\\/]models?[\\/]/, reason: 'In models directory' },
    { category: 'model', confidence: 'high', namePattern: /^schema\.(prisma|graphql|gql)$/, reason: 'Schema definition' },
    { category: 'model', confidence: 'medium', namePattern: /models?\.(ts|js|py)$/, reason: 'Models file naming' },

    // ─── Services ─────────────────────────────────────────────────────────────
    { category: 'service', confidence: 'high', pathPattern: /[\\/]services?[\\/]/, reason: 'In services directory' },
    { category: 'service', confidence: 'medium', namePattern: /service\.(ts|js|py)$/, reason: 'Service file naming' },

    // ─── Controllers ──────────────────────────────────────────────────────────
    { category: 'controller', confidence: 'high', pathPattern: /[\\/]controllers?[\\/]/, reason: 'In controllers directory' },
    { category: 'controller', confidence: 'medium', namePattern: /controller\.(ts|js|py)$/, reason: 'Controller file naming' },
    // ─── React Hooks (before tsx/jsx catch-all) ──────────────────────────────
    { category: 'utility', confidence: 'high', pathPattern: /(?:^|[\/])hooks[\/]/, reason: 'In hooks directory' },
    { category: 'utility', confidence: 'high', namePattern: /^use[A-Z][a-zA-Z0-9]*\.(ts|tsx)$/, reason: 'React hook naming convention' },

    // ─── Context (before tsx/jsx catch-all) ───────────────────────────────────
    { category: 'component', confidence: 'high', pathPattern: /(?:^|[\/])context[\/]/, reason: 'In context directory' },
    { category: 'component', confidence: 'high', namePattern: /\.context\.(ts|tsx)$/, reason: 'Context file naming' },
    // ─── Components ───────────────────────────────────────────────────────────
    { category: 'component', confidence: 'high', pathPattern: /[\\/]components?[\\/]/, reason: 'In components directory' },
    { category: 'component', confidence: 'medium', namePattern: /\.(tsx|jsx)$/, reason: 'TSX/JSX file (likely component)' },

    // ─── Utilities ────────────────────────────────────────────────────────────
    { category: 'utility', confidence: 'high', pathPattern: /[\\/](utils?|helpers?|lib)[\\/]/, reason: 'In utility directory' },
    { category: 'utility', confidence: 'medium', namePattern: /(utils?|helpers?)\.(ts|js|py)$/, reason: 'Utility file naming' },
    // ─── State Management (before entry — store/index.ts is a store file) ─────
    { category: 'service', confidence: 'high', pathPattern: /(?:^|[\/])store[\/]/, reason: 'In store directory' },
    // ─── Entry Points ─────────────────────────────────────────────────────────
    { category: 'entry', confidence: 'high', pathPattern: /(?:^|[\\/])bin[\\/]/, reason: 'In bin directory' },
    { category: 'entry', confidence: 'medium', pathPattern: /^(?:src[\\/])?(main|index|app|server)\.(ts|tsx|js|jsx|py|go)$/, reason: 'Repo-root or src-root conventional entry point' },

    // ─── React Hooks ──────────────────────────────────────────────────────────
    { category: 'utility', confidence: 'high', pathPattern: /(?:^|[\\/])hooks[\\/]/, reason: 'In hooks directory' },
    { category: 'utility', confidence: 'high', namePattern: /^use[A-Z][a-zA-Z0-9]*\.(ts|tsx)$/, reason: 'React hook naming convention' },

    // ─── State Management ─────────────────────────────────────────────────────
    { category: 'service', confidence: 'high', pathPattern: /(?:^|[\\/])store[\\/]/, reason: 'In store directory' },
    { category: 'service', confidence: 'high', namePattern: /\.(store|slice|reducer|actions?)\.(ts|js)$/, reason: 'State management file' },

    // ─── Context ──────────────────────────────────────────────────────────────
    { category: 'component', confidence: 'high', pathPattern: /(?:^|[\\/])context[\\/]/, reason: 'In context directory' },
    { category: 'component', confidence: 'high', namePattern: /\.context\.(ts|tsx)$/, reason: 'Context file naming' },

    // ─── Adapters / Providers ─────────────────────────────────────────────────
    { category: 'service', confidence: 'high', pathPattern: /(?:^|[\\/])adapters?[\\/]/, reason: 'In adapters directory' },
    { category: 'service', confidence: 'high', namePattern: /\.(adapter|provider)\.(ts|js)$/, reason: 'Adapter/provider file naming' },

    // ─── Repositories ─────────────────────────────────────────────────────────
    { category: 'model', confidence: 'high', pathPattern: /(?:^|[\\/])repositor(?:y|ies)[\\/]/, reason: 'In repositories directory' },
    { category: 'model', confidence: 'high', namePattern: /\.repository\.(ts|js)$/, reason: 'Repository file naming' },

    // ─── Constants ────────────────────────────────────────────────────────────
    { category: 'type', confidence: 'high', pathPattern: /(?:^|[\\/])constants?[\\/]/, reason: 'In constants directory' },
    { category: 'type', confidence: 'high', namePattern: /\.constants?\.(ts|js)$/, reason: 'Constants file naming' },

    // ─── Validators / Schemas ─────────────────────────────────────────────────
    { category: 'utility', confidence: 'high', pathPattern: /(?:^|[\\/])validators?[\\/]/, reason: 'In validators directory' },
    { category: 'utility', confidence: 'high', namePattern: /\.(validator|schema)\.(ts|js)$/, reason: 'Validator/schema file naming' },

    // ─── Workers ──────────────────────────────────────────────────────────────
    { category: 'utility', confidence: 'high', namePattern: /\.worker\.(ts|js)$/, reason: 'Web worker file' },

    // ─── Mocks / Fixtures ─────────────────────────────────────────────────────
    { category: 'test', confidence: 'high', pathPattern: /(?:^|[\\/])__mocks__[\\/]/, reason: 'In __mocks__ directory' },
    { category: 'test', confidence: 'high', pathPattern: /(?:^|[\\/])fixtures?[\\/]/, reason: 'In fixtures directory' },
    { category: 'test', confidence: 'high', namePattern: /\.mock\.(ts|js)$/, reason: 'Mock file naming' },

    // ─── Plugins ──────────────────────────────────────────────────────────────
    { category: 'config', confidence: 'high', pathPattern: /(?:^|[\\/])plugins?[\\/]/, reason: 'In plugins directory' },

    // ─── Guards / Interceptors / Pipes ────────────────────────────────────────
    { category: 'middleware', confidence: 'high', pathPattern: /(?:^|[\\/])guards?[\\/]/, reason: 'In guards directory' },
    { category: 'middleware', confidence: 'high', namePattern: /\.(guard|interceptor|pipe)\.(ts|js)$/, reason: 'Guard/interceptor/pipe file naming' },
    { category: 'middleware', confidence: 'high', pathPattern: /(?:^|[\\/])interceptors?[\\/]/, reason: 'In interceptors directory' },
    { category: 'middleware', confidence: 'high', pathPattern: /(?:^|[\\/])pipes?[\\/]/, reason: 'In pipes directory' },

    // ─── Dot-config Directories ───────────────────────────────────────────────
    { category: 'config', confidence: 'high', pathPattern: /^\.(?:github|reponav|claude|husky|vscode)[\/]/, reason: 'Dot-config directory' },

    // ─── Tool / Library Domain Modules ────────────────────────────────────────
    // These directories appear in tool/library/extension repos and don't match
    // conventional web-app naming (services/, controllers/). Listed before the
    // catch-all entry-point rule so directory beats file name.
    { category: 'service', confidence: 'high', pathPattern: /(?:^|[\\/])analyzers?[\\/]/, reason: 'Analyzer module (tool/library pattern)' },
    { category: 'service', confidence: 'high', pathPattern: /(?:^|[\\/])commands?[\\/]/, reason: 'Command handler module (tool/library pattern)' },
    { category: 'service', confidence: 'high', pathPattern: /(?:^|[\\/])ai[\\/]/, reason: 'AI integration module (tool/library pattern)' },
    { category: 'service', confidence: 'high', pathPattern: /(?:^|[\\/])db[\\/]/, reason: 'Database/persistence module (tool/library pattern)' },
    { category: 'service', confidence: 'high', pathPattern: /(?:^|[\\/])mcp[\\/]/, reason: 'MCP transport module (tool/library pattern)' },
    { category: 'service', confidence: 'high', pathPattern: /(?:^|[\\/])tours?[\\/]/, reason: 'Tour management module (tool/library pattern)' },
    { category: 'service', confidence: 'high', pathPattern: /(?:^|[\\/])governance[\\/]/, reason: 'Governance rule module (tool/library pattern)' },
    { category: 'service', confidence: 'high', pathPattern: /(?:^|[\\/])git[\\/]/, reason: 'Git integration module (tool/library pattern)' },
    { category: 'service', confidence: 'high', pathPattern: /(?:^|[\\/])runtime[\\/]/, reason: 'Runtime/loader module (tool/library pattern)' },
    { category: 'utility', confidence: 'high', pathPattern: /(?:^|[\\/])scripts?[\\/]/, reason: 'Build/CI script' },
];

// ─── Tier 0: Library Source Pre-empt ────────────────────────────────────────

/**
 * Known framework/library package names. Files whose first path segment
 * matches one of these are from a library source repo, not application code.
 * Tier 0 fires before Pass 1 rules and Pass 2 content signals — context
 * always overrides content for library-internal files.
 */
const LIBRARY_PACKAGE_NAMES = new Set([
    // Python frameworks
    'fastapi', 'starlette', 'pydantic', 'django', 'flask', 'sqlalchemy',
    'alembic', 'uvicorn', 'httpx', 'aiohttp', 'tornado', 'celery',
    // JS/TS frameworks (less common to analyze source directly)
    'express', 'koa', 'hapi',
]);

// private helper — not exported; classification logic only
function isLibrarySource(filePath: string): boolean {
    const normalized = filePath.replace(/\\/g, '/');
    const firstSegment = normalized.split('/')[0];
    return LIBRARY_PACKAGE_NAMES.has(firstSegment);
}

// ─── Main Classifier ─────────────────────────────────────────────────────────

/**
 * Classifies a set of files into architectural categories based on
 * directory conventions, file naming patterns, and extension signals.
 * Deterministic — no AI. First matching rule wins (rules are ordered by priority).
 */
export async function classifyFiles(
    files: Map<string, string>
): Promise<FileClassification[]> {
    const classifications: FileClassification[] = [];

    for (const [filePath] of files) {
        const fileName = path.basename(filePath);

        // Tier 0: library source pre-empt — fires before all Pass 1 rules and Pass 2
        // content signals. Context (where the file lives) overrides content (what it contains).
        if (isLibrarySource(filePath)) {
            classifications.push({
                path: filePath,
                category: 'libSource',
                confidence: 'high',
                reason: 'Library/framework source package directory',
            });
            continue;
        }

        let matched = false;

        for (const rule of RULES) {
            let isMatch = false;

            if (rule.pathPattern && rule.pathPattern.test(filePath)) {
                isMatch = true;
            } else if (rule.namePattern && rule.namePattern.test(fileName)) {
                isMatch = true;
            }

            if (isMatch) {
                classifications.push({
                    path: filePath,
                    category: rule.category,
                    confidence: rule.confidence,
                    reason: rule.reason,
                });
                matched = true;
                break; // First matching rule wins (rules are ordered by priority)
            }
        }

        if (!matched) {
            classifications.push({
                path: filePath,
                category: 'unknown',
                confidence: 'low',
                reason: 'No matching classification rule',
            });
        }
    }

    // Pass 2: upgrade remaining unknowns using file content signals
    return enrichWithContentSignals(classifications, files);
}

/**
 * Get a summary of classifications by category.
 */
export function getClassificationSummary(
    classifications: FileClassification[]
): Record<FileCategory, string[]> {
    const summary: Record<string, string[]> = {};

    for (const c of classifications) {
        if (!summary[c.category]) summary[c.category] = [];
        summary[c.category].push(c.path);
    }

    return summary as Record<FileCategory, string[]>;
}
