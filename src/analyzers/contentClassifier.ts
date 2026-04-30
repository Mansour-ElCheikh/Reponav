/**
 * Content Classifier (Pass 2)
 *
 * Upgrades file classifications by inspecting raw file content for
 * framework-specific signals: decorators, import patterns, class inheritance,
 * and function signatures. Language-agnostic by design — rules are expressed
 * as regex on source text, not file names or extensions.
 *
 * Only runs on files that Pass 1 (path/name heuristics) left as `unknown`.
 * Never downgrades or changes high/medium confidence Pass 1 results.
 */

import type { FileCategory } from '../../shared/types';
import type { FileClassification } from '../types';

// ─── Content Signal Rules ─────────────────────────────────────────────────────

interface ContentRule {
    category: FileCategory;
    /** Every pattern in this array must be present in the content */
    allOf?: RegExp[];
    /** At least one pattern in this array must be present */
    anyOf: RegExp[];
    reason: string;
}

/**
 * Ordered content rules. First match wins, same as Pass 1.
 * More specific rules (require allOf) should come before broad anyOf rules.
 */
const CONTENT_RULES: ContentRule[] = [
    // ─── Entry Points ────────────────────────────────────────────────────────
    // FastAPI / Flask app construction — checked before route decorator
    {
        category: 'entry',
        anyOf: [/app\s*=\s*FastAPI\s*\(/, /app\s*=\s*Flask\s*\(/, /app\s*=\s*Starlette\s*\(/],
        reason: 'WSGI/ASGI app entry point',
    },
    // Go main()
    {
        category: 'entry',
        anyOf: [/^func\s+main\s*\(\s*\)\s*\{/m],
        reason: 'Go main() function',
    },

    // ─── Routes ──────────────────────────────────────────────────────────────
    // Python: FastAPI/Flask route decorators
    {
        category: 'route',
        anyOf: [/@(app|router)\.(get|post|put|delete|patch|head|options)\s*\(/i],
        reason: 'FastAPI/Flask route decorator',
    },
    // Go: Gin/Echo/stdlib HTTP handler registration
    {
        category: 'route',
        anyOf: [
            /\.(GET|POST|PUT|DELETE|PATCH)\s*\(/,
            /mux\.HandleFunc?\s*\(/,
            /http\.HandleFunc\s*\(/,
            /e\.GET\s*\(|e\.POST\s*\(/, // Echo
        ],
        reason: 'Go HTTP handler registration',
    },
    // C#: ASP.NET HTTP method attributes
    {
        category: 'route',
        anyOf: [/\[Http(Get|Post|Put|Delete|Patch)\]/],
        reason: 'ASP.NET HTTP method attribute',
    },
    // NestJS HTTP method decorators (route handlers inside controllers)
    {
        category: 'route',
        anyOf: [/^\s*@(Get|Post|Put|Delete|Patch|Head|Options)\s*\(/m],
        reason: 'NestJS HTTP method decorator',
    },

    // ─── Controllers ─────────────────────────────────────────────────────────
    // NestJS @Controller
    {
        category: 'controller',
        anyOf: [/@Controller\s*\(/],
        reason: 'NestJS @Controller decorator',
    },
    // C#: [ApiController] or [Route(...)]
    {
        category: 'controller',
        anyOf: [/\[ApiController\]/, /\[Route\s*\(/],
        reason: 'ASP.NET Controller attribute',
    },
    // Django views
    {
        category: 'controller',
        anyOf: [/from\s+django\.(views|http)\s+import/, /class\s+\w+View\s*\(\s*\w*View\w*\s*\)/],
        reason: 'Django view/controller',
    },

    // ─── Services ────────────────────────────────────────────────────────────
    // NestJS/Angular @Injectable
    {
        category: 'service',
        anyOf: [/@Injectable\s*\(/],
        reason: 'NestJS/Angular @Injectable decorator',
    },
    // Redux state management
    {
        category: 'service',
        anyOf: [/createSlice\s*\(/, /configureStore\s*\(/, /createStore\s*\(/],
        reason: 'Redux state management',
    },

    // ─── Models ──────────────────────────────────────────────────────────────
    // TypeORM @Entity / extends BaseEntity
    {
        category: 'model',
        anyOf: [/@Entity\s*\(/, /extends\s+BaseEntity\b/],
        reason: 'TypeORM entity',
    },
    // SQLAlchemy / Python ORM
    {
        category: 'model',
        anyOf: [
            /from\s+sqlalchemy\s+import/,
            /from\s+sqlalchemy\./,
            /from\s+databases\s+import/,
            /from\s+tortoise\s+import/,
            /from\s+django\.db\s+import.*models/,
        ],
        reason: 'Python ORM model',
    },
    // Go GORM / database types
    {
        category: 'model',
        anyOf: [/\*gorm\.DB\b/, /\*sql\.DB\b/, /\*bun\.DB\b/, /\*sqlx\.DB\b/, /gorm\.Model\b/, /"gorm\.io\/gorm"/],
        reason: 'Go database model struct',
    },
    // C# Entity Framework DbContext
    {
        category: 'model',
        anyOf: [/:\s*DbContext\b/, /class\s+\w+Context\s*:\s*\w*DbContext\b/],
        reason: 'Entity Framework DbContext',
    },

    // ─── Types / Schemas ─────────────────────────────────────────────────────
    // Pydantic BaseModel (Python)
    {
        category: 'type',
        allOf: [/from\s+pydantic\s+import/],
        anyOf: [/class\s+\w+\s*\(\s*\w*BaseModel\w*\s*\)/],
        reason: 'Pydantic schema model',
    },

    // ─── Config ──────────────────────────────────────────────────────────────
    // NestJS @Module
    {
        category: 'config',
        anyOf: [/@Module\s*\(/],
        reason: 'NestJS @Module decorator',
    },
];

// ─── Matching Logic ───────────────────────────────────────────────────────────


// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Enrich a set of file classifications using raw file content signals.
 * Only upgrades entries that Pass 1 left as `unknown` (category === 'unknown').
 * Never modifies high or medium confidence Pass 1 results.
 *
 * @param classifications  Output from Pass 1 (classifyFiles)
 * @param files            The same Map<path, content> used for Pass 1
 * @returns New array with unknown entries potentially upgraded
 */
export function enrichWithContentSignals(
    classifications: FileClassification[],
    files: Map<string, string>
): FileClassification[] {
    return classifications.map((c) => {
        // Only upgrade files that Pass 1 couldn't classify
        if (c.category !== 'unknown') return c;

        const content = files.get(c.path) ?? '';
        if (!content) return c;

        for (const rule of CONTENT_RULES) {
            const allOfMatch = !rule.allOf || rule.allOf.every((p) => p.test(content));
            if (allOfMatch && rule.anyOf.some((p) => p.test(content))) {
                return {
                    ...c,
                    category: rule.category,
                    confidence: 'high' as const,
                    reason: rule.reason,
                };
            }
        }

        return c;
    });
}
