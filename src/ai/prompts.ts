/**
 * Prompt Templates
 *
 * All prompts for tour generation. Ported from the original ai_service.py
 * and enhanced for the hybrid approach where the AI receives structured
 * analysis data instead of raw code dumps.
 */

import { TourType } from '../types';

/** Bump this when prompt templates change to invalidate cached tours. */
export const PROMPT_VERSION = 'v7';

// ─── Quality Rules (shared across both one-shot and NDJSON system prompts) ───

const QUALITY_RULES = `
Quality Rules — every step MUST follow these:
1. GROUNDED: Reference only files, symbols, imports, and relationships that appear verbatim in the analysis report. Never invent file names, function names, or import edges.
2. CONCRETE: Name specific functions, classes, or symbols (e.g. "AuthController.login" or "buildDependencyGraph()"). Do NOT write vague prose like "this is an important file" or "handles various things".
3. CONNECTED: Each step must explain how it connects to the previous or next step. The tour must tell one coherent story, not a list of disconnected file descriptions.
4. QUANTIFIED: When discussing dependencies, cite specific numbers from the report (e.g. "12 dependents" or "fan-out of 8"). When discussing cycles, name the files in the cycle.
5. ACTIONABLE watch_out: The watch_out field must describe a real risk, gotcha, or design trade-off relevant to the step. Write "No known issues." only when genuinely true — never use it as a filler default.
6. FILES REQUIRED: Every step must reference at least one file in the "files" array. Steps with zero files are not useful.
7. MINIMUM DETAIL: The "what_it_does" field must be at least 2 sentences. The "why_it_matters" field must be at least 1 sentence. Single-word or stub explanations are errors.

Bad step example (DO NOT produce steps like this):
{"title": "Main file", "what_it_does": "This is the main file.", "why_it_matters": "It's important.", "watch_out": "No major gotchas here."}

Good step example:
{"title": "Request Authentication — AuthMiddleware", "what_it_does": "AuthMiddleware.verify() intercepts every incoming HTTP request, validates the JWT token from the Authorization header, and attaches the decoded user payload to req.user. It imports TokenService from services/token.ts for signature verification.", "why_it_matters": "This is the single chokepoint for access control — every route behind this middleware is protected. Bypassing it would expose all API endpoints.", "watch_out": "Token refresh logic is handled separately in RefreshController, not here. The middleware silently passes through OPTIONS requests for CORS preflight, which is easy to miss during security audits."}`;

// ─── System Prompt (one-shot variant) ────────────────────────────────────────

export const SYSTEM_PROMPT = `You generate guided architecture tours for a codebase using a machine-generated analysis report provided in the <analysis_report> tag as ground truth.

Generate 4 to 6 steps. Fewer than 4 steps is an error.

Return valid JSON only in this shape:
{
  "steps": [
    {
      "order": 1,
      "title": "Short descriptive title — mention the key symbol or concept",
      "what_it_does": "Concrete factual explanation grounded in the report. At least 2 sentences naming specific symbols.",
      "why_it_matters": "Why this design matters architecturally. At least 1 sentence.",
      "watch_out": "A real gotcha, trade-off, or risk. Never filler.",
      "files": ["path/to/file.ts"],
      "highlights": [{ "file": "path/to/file.ts", "lines": [10, 20] }],
      "relationships": [{ "from": "a.ts", "to": "b.ts", "type": "imports" }]
    }
  ]
}
${QUALITY_RULES}

Hard constraints:
- Use only files and facts present in the <analysis_report>.
- Do not invent files, imports, functions, or relationships.
- When symbol-level data is present, use it to explain concrete functions, methods, classes, and inheritance paths inside the relevant files. Prefer symbol labels like "UserService.create" or "AuthController" in prose.
- Every file mentioned in steps must exist in the report.
- Prefer the most important files using entry points, hot files, classifications, and dependency structure.
- If you cannot produce at least 4 grounded steps from the report, return:
  {"steps":[],"rejected":true,"reason":"Insufficient data in the analysis report to produce a meaningful tour."}
- If the question provided in <user_query> is not about understanding the codebase, return:
  {"steps":[],"rejected":true,"reason":"This question is not related to codebase exploration."}`;

/**
 * NDJSON streaming variant of SYSTEM_PROMPT.
 * Instructs the LLM to emit one JSON object per line instead of a wrapped array.
 */
export const NDJSON_SYSTEM_PROMPT = `You generate guided architecture tours for a codebase using a machine-generated analysis report provided in the <analysis_report> tag as ground truth.

Return one JSON object per line (NDJSON format). Each step must be compact single-line JSON — no newlines inside a step, no pretty-printing. Example output (two steps on two lines):
{"order":1,"title":"Request Authentication — AuthMiddleware","what_it_does":"AuthMiddleware.verify() intercepts every incoming HTTP request and validates the JWT token. It imports TokenService for signature verification.","why_it_matters":"Single chokepoint for access control — every protected route depends on this middleware.","watch_out":"Token refresh is handled in RefreshController, not here. CORS preflight passes through silently.","files":["src/middleware/auth.ts"],"highlights":[{"file":"src/middleware/auth.ts","lines":[10,20]}],"relationships":[{"from":"src/middleware/auth.ts","to":"src/services/token.ts","type":"imports"}]}
{"order":2,"title":"Route Registration — router.ts","what_it_does":"Registers all API routes and attaches the auth middleware. Uses express.Router() with path-based grouping.","why_it_matters":"Central routing table — adding new features means adding routes here first.","watch_out":"Route order matters for middleware application. Wildcard routes at the top can shadow specific ones.","files":["src/routes/router.ts"],"highlights":[],"relationships":[]}

Generate 4 to 6 steps. Fewer than 4 steps is an error.
${QUALITY_RULES}

Hard constraints:
- Each step on its own line as compact single-line JSON. No pretty-printing. No markdown code blocks. No headers. Raw NDJSON only.
- Use only files and facts present in the <analysis_report>.
- Do not invent files, imports, functions, or relationships.
- When symbol-level data is present, use it to explain concrete functions, methods, classes, and inheritance paths inside the relevant files. Prefer symbol labels like "UserService.create" or "AuthController" in prose.
- Every file mentioned in steps must exist in the report.
- Prefer the most important files using entry points, hot files, classifications, and dependency structure.
- If you cannot produce at least 4 grounded steps from the report, return a single line:
  {"rejected":true,"reason":"Insufficient data in the analysis report to produce a meaningful tour."}
- If the question provided in <user_query> is not about understanding the codebase, return a single line:
  {"rejected":true,"reason":"This question is not related to codebase exploration."}`;



// ─── Tour Type Specific Prompts ──────────────────────────────────────────────

/** Prompt fragments specialized for each supported tour type. */
export const TOUR_TYPE_PROMPTS: Record<TourType, string> = {
    'overview': `## Tour Goal: Architecture Overview

Generate a high-level architecture tour.
Cover: what the project does, tech stack, organization, key modules, and how they connect.
Use entry points, frameworks, classifications, hot files, dependency structure, and any symbol hotspots when present.
Create 4-5 steps, moving from entry/config toward core logic.
Focus on architecture patterns, not a function-by-function walkthrough.

Quality criteria for this tour type:
- Step 1 MUST identify the top-level architectural pattern (e.g. MVC, event-driven, layered, monolith, microservice plugin system).
- Name the primary framework(s) and language from the report.
- At least one step must discuss the dependency structure quantitatively (e.g. "42 import edges connecting 28 modules with an average fan-out of 1.5").
- The final step should summarize how modules connect — not just list them.`,

    'data-flow': `## Tour Goal: Data Flow Trace

Trace one concrete input-to-output flow.
Show where data enters, how it is validated or transformed, where business logic runs, where persistence happens, and what returns.
Follow actual import/dependency edges so the steps tell one connected story. If symbol edges exist, use them to make the flow concrete.
Create 4-6 steps.

Quality criteria for this tour type:
- The trace must follow at least 3 distinct transformation stages (e.g. request → validation → service → persistence → response).
- Each step must name the specific function or method that handles the data at that stage.
- Show the import edge that connects each stage to the next.
- If the report contains process flows, use them to guide the order.`,

    'onboarding': `## Tour Goal: New Developer Onboarding

Create a tour for a developer's first day in the repo.
Cover: where to start reading, how the project boots, where major things live, the core loop, how to add a feature, and how tests fit in.
Be practical with real files, commands, conventions, and named symbols from the report.
Create 4-5 steps.

Quality criteria for this tour type:
- At least one step must include a concrete command or convention (e.g. "run npm run dev to start the dev server" or "tests live in __tests__/ and follow the *.test.ts naming convention").
- At least one step must explain "how to add a new feature" by referencing a specific layer or pattern to follow.
- Reference config files (package.json, tsconfig, etc.) where relevant.
- Prefer practical guidance over abstract architecture descriptions.`,

    'dependency-audit': `## Tour Goal: Dependency Health Audit

Audit the dependency structure for architectural health.
Prioritize cycles, high fan-in hotspots, high fan-out hotspots, orphan files, layer violations, and symbol hotspots or inheritance tangles when present.
Be critical but constructive: explain why each issue matters and suggest a specific fix.
Create 4-5 steps.

Quality criteria for this tour type:
- Every issue must be quantified: cite the fan-in/fan-out count, cycle length in files, or number of orphans.
- For cycles, name every file in the cycle path.
- Every step must suggest a specific, actionable fix (e.g. "extract shared types into a types/ module to break the cycle").
- If the report shows no issues, say so explicitly rather than inventing problems.`,

    'api-surface': `## Tour Goal: API Surface Analysis

Map the external API surface of the application.
Cover routes or handlers, auth and middleware, request/response validation, error handling, and external integrations.
Focus on the external interface and reference the real route, middleware, schema, handler, and service symbols in the report.
Create 4-5 steps.

Quality criteria for this tour type:
- Reference actual route strings, handler function names, or endpoint patterns from the report (e.g. "app.post('/api/users', UserController.create)").
- At least one step must cover authentication/authorization middleware.
- At least one step must cover error handling or validation.
- If no API surface is detected in the report, return rejected with reason "No API surface detected in the analysis report."`,

    'custom': `## Tour Goal: Custom Query

Answer the user's question using only the analysis report.
Ground the explanation in real files, dependencies, symbol relationships, and control/data flow relevant to the question.
Start from the most relevant entry point and follow the strongest connected path.
Create 4-6 steps.

Quality criteria for this tour type:
- The tour must directly and specifically answer the user's question — not just tour the codebase generally.
- Every step must be relevant to the question asked.
- If the question asks about a specific file or module, start from that file.
- If the question cannot be answered from the report data, return rejected with a specific reason.`,
};

/**
 * Build the complete user prompt for tour generation.
 */
export function buildUserPrompt(
    analysisReportText: string,
    query: string,
    tourType: TourType
): string {
    const tourTypePrompt = TOUR_TYPE_PROMPTS[tourType];

    return `<tour_goal>
${tourTypePrompt}
</tour_goal>

<user_query>
${query}
</user_query>

<analysis_report chars="${analysisReportText.length}">
${analysisReportText}
</analysis_report>

<instructions>
Please generate a guided architecture tour based on the analysis report above.
Ground every file reference and relationship in the factual data provided in <analysis_report>.
If you cannot produce at least 4 well-grounded steps, return a rejection instead of producing low-quality filler steps.
</instructions>`;
}
