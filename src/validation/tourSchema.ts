/**
 * Zod schemas for Tour and TourStep validation.
 *
 * Single source of truth for tour data shape. Used by:
 * - Validation gate (validates LLM responses before rendering)
 * - Future MCP tool output schemas (v2)
 */

import { z } from 'zod';

/** Schema version for contract compatibility. Consumers can check this to detect breaking changes. */
export const TOUR_SCHEMA_VERSION = '1.2.0';

// ─── Primitives ──────────────────────────────────────────────────────────────

const FileCategorySchema = z.enum([
    'entry', 'route', 'controller', 'service', 'model',
    'component', 'utility', 'config', 'middleware', 'test',
    'style', 'asset', 'migration', 'type', 'unknown',
]);

const TourTypeSchema = z.enum([
    'overview', 'data-flow', 'onboarding',
    'dependency-audit', 'api-surface', 'custom',
]);

const RelationshipTypeSchema = z.enum([
    'imports', 'calls', 'extends', 'implements', 'uses',
    'configures', 'validates', 'transforms', 'persists',
]);

// ─── Composites ──────────────────────────────────────────────────────────────

/** Schema for code-highlight references attached to a tour step. */
export const CodeHighlightSchema = z.object({
    file: z.string().min(1),
    lines: z.array(z.number().int()),
});

/** Schema for explicit relationships called out within a tour step. */
export const FileRelationshipSchema = z.object({
    from: z.string().min(1),
    to: z.string().min(1),
    type: RelationshipTypeSchema,
});

/** Schema for one narrated step in a generated tour. */
export const TourStepSchema = z.object({
    order: z.number().int().nonnegative(),
    title: z.string().min(1),
    what_it_does: z.string().min(30, 'what_it_does must be at least 30 characters'),
    why_it_matters: z.string().min(15, 'why_it_matters must be at least 15 characters'),
    watch_out: z.string().min(1, 'watch_out must not be empty'),
    files: z.array(z.string()),
    highlights: z.array(CodeHighlightSchema),
    relationships: z.array(FileRelationshipSchema),
});

/** Schema for one graph node rendered in the webview graph. */
export const GraphNodeSchema = z.object({
    id: z.string().min(1),
    label: z.string(),
    type: FileCategorySchema,
    weight: z.number().optional(),
});

/** Schema for one dependency edge rendered in the webview graph. */
export const GraphEdgeSchema = z.object({
    source: z.string().min(1),
    target: z.string().min(1),
    label: z.string(),
    isCircular: z.boolean().optional(),
});

/** Schema for the graph payload bundled with a generated tour. */
export const TourGraphSchema = z.object({
    nodes: z.array(GraphNodeSchema),
    edges: z.array(GraphEdgeSchema),
});

/** Root schema for a persisted RepoNav tour document. */
export const TourSchema = z.object({
    id: z.string().min(1),
    query: z.string(),
    tourType: TourTypeSchema,
    steps: z.array(TourStepSchema),
    graph: TourGraphSchema,
    analysisSnapshot: z.object({
        frameworks: z.array(z.string()),
        entryPoints: z.array(z.string()),
        totalFiles: z.number().int().nonnegative(),
        totalEdges: z.number().int().nonnegative(),
    }),
    createdAt: z.string(),
});

// ─── Type exports (inferred from schemas) ────────────────────────────────────

export type ValidatedTour = z.infer<typeof TourSchema>;
export type ValidatedTourStep = z.infer<typeof TourStepSchema>;
