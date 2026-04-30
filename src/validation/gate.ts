/**
 * Validation gate for tour output.
 *
 * Every tour (from LLM or structural fallback) passes through this gate
 * before rendering. Checks schema conformance, token budget, step count
 * bounds, content quality, and optionally validates file references
 * against known workspace files.
 */

import { TourSchema, TOUR_SCHEMA_VERSION } from './tourSchema';

/** Minimum number of steps for a valid tour. */
const MIN_STEPS = 3;
/** Maximum number of steps for a valid tour. */
const MAX_STEPS = 8;
/** Minimum character length for what_it_does field. */
const MIN_WHAT_IT_DOES_CHARS = 30;
/** Minimum character length for why_it_matters field. */
const MIN_WHY_IT_MATTERS_CHARS = 15;

export interface ValidationOptions {
    /** Maximum estimated tokens for the serialized tour. Default: 6000. */
    maxTokens?: number;
    /** Set of known workspace file paths. If provided, validates all file references. */
    knownFiles?: Set<string>;
}

export interface ValidationResult {
    valid: boolean;
    errors: string[];
    warnings: string[];
    tokenEstimate: number;
    schemaVersion: string;
}

/**
 * Validate a tour object against the schema, token budget, and optionally file references.
 */
export function validateTourOutput(
    data: unknown,
    options: ValidationOptions = {},
): ValidationResult {
    const { maxTokens = 6000, knownFiles } = options;
    const errors: string[] = [];
    const warnings: string[] = [];

    // 1. Schema validation
    const parseResult = TourSchema.safeParse(data);
    if (!parseResult.success) {
        for (const issue of parseResult.error.issues) {
            errors.push(`${issue.path.join('.')}: ${issue.message}`);
        }
    }

    // 2. Token budget check (~4 chars per token)
    const serialized = JSON.stringify(data);
    const tokenEstimate = Math.ceil(serialized.length / 4);
    if (tokenEstimate > maxTokens) {
        errors.push(`Token budget exceeded: ~${tokenEstimate} tokens > ${maxTokens} max`);
    }

    // Schema-level checks passed — run content-quality checks.
    if (parseResult.success) {
        const tour = parseResult.data;

        // 3. Step count bounds
        if (tour.steps.length < MIN_STEPS) {
            errors.push(`Too few steps: ${tour.steps.length} < minimum ${MIN_STEPS}`);
        }
        if (tour.steps.length > MAX_STEPS) {
            errors.push(`Too many steps: ${tour.steps.length} > maximum ${MAX_STEPS}`);
        }

        // 4. Step content quality checks
        for (const step of tour.steps) {
            if (step.what_it_does.length < MIN_WHAT_IT_DOES_CHARS) {
                errors.push(`Step "${step.title}": what_it_does too short (${step.what_it_does.length} chars < ${MIN_WHAT_IT_DOES_CHARS} min)`);
            }
            if (step.why_it_matters.length < MIN_WHY_IT_MATTERS_CHARS) {
                errors.push(`Step "${step.title}": why_it_matters too short (${step.why_it_matters.length} chars < ${MIN_WHY_IT_MATTERS_CHARS} min)`);
            }
            if (step.files.length === 0) {
                warnings.push(`Step "${step.title}" references no files — may be filler`);
            }
        }

        // 5. File reference validation (optional)
        if (knownFiles) {
            for (const step of tour.steps) {
                for (const file of step.files) {
                    if (!knownFiles.has(file)) {
                        errors.push(`Step "${step.title}" references unknown file: ${file}`);
                    }
                }
            }
        }
    }

    return {
        valid: errors.length === 0,
        errors,
        warnings,
        tokenEstimate,
        schemaVersion: TOUR_SCHEMA_VERSION,
    };
}
