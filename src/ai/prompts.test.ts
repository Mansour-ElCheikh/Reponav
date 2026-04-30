import { describe, it, expect } from 'vitest';
import type { TourType } from '../types';
import { buildUserPrompt, TOUR_TYPE_PROMPTS, SYSTEM_PROMPT, NDJSON_SYSTEM_PROMPT, PROMPT_VERSION } from './prompts';

describe('PROMPT_VERSION', () => {
    it('is a non-empty string', () => {
        expect(typeof PROMPT_VERSION).toBe('string');
        expect(PROMPT_VERSION.length).toBeGreaterThan(0);
    });

    it('is v7 after quality hardening', () => {
        expect(PROMPT_VERSION).toBe('v7');
    });
});

describe('SYSTEM_PROMPT', () => {
    it('instructs the LLM to return valid JSON only', () => {
        expect(SYSTEM_PROMPT).toContain('Return valid JSON only');
    });

    it('defines steps-only output schema (graph is sourced deterministically)', () => {
        expect(SYSTEM_PROMPT).toContain('"steps"');
        expect(SYSTEM_PROMPT).not.toContain('"graph"');
    });

    it('enforces a minimum step count of 4 to 6', () => {
        expect(SYSTEM_PROMPT).toContain('4 to 6');
    });

    it('includes anti-hallucination rule: GROUNDED', () => {
        expect(SYSTEM_PROMPT).toContain('GROUNDED');
        expect(SYSTEM_PROMPT).toContain('Never invent file names');
    });

    it('includes concrete prose rule: CONCRETE', () => {
        expect(SYSTEM_PROMPT).toContain('CONCRETE');
        expect(SYSTEM_PROMPT).toContain('Do NOT write vague prose');
    });

    it('includes connectivity rule: CONNECTED', () => {
        expect(SYSTEM_PROMPT).toContain('CONNECTED');
    });

    it('includes quantification rule: QUANTIFIED', () => {
        expect(SYSTEM_PROMPT).toContain('QUANTIFIED');
    });

    it('includes actionable watch_out rule', () => {
        expect(SYSTEM_PROMPT).toContain('ACTIONABLE watch_out');
    });

    it('includes a negative example (bad step)', () => {
        expect(SYSTEM_PROMPT).toContain('Bad step example');
        expect(SYSTEM_PROMPT).toContain('DO NOT produce steps like this');
    });

    it('includes a positive example (good step)', () => {
        expect(SYSTEM_PROMPT).toContain('Good step example');
    });

    it('includes insufficient data rejection instruction', () => {
        expect(SYSTEM_PROMPT).toContain('Insufficient data');
    });
});

describe('NDJSON_SYSTEM_PROMPT', () => {
    it('contains the string "one JSON object per line"', () => {
        expect(NDJSON_SYSTEM_PROMPT).toContain('one JSON object per line');
    });

    it('does not contain the "steps": array wrapper instruction', () => {
        expect(NDJSON_SYSTEM_PROMPT).not.toContain('"steps":');
    });

    it('enforces a minimum step count of 4 to 6', () => {
        expect(NDJSON_SYSTEM_PROMPT).toContain('4 to 6 steps');
    });

    it('instructs compact single-line JSON with no pretty-printing', () => {
        expect(NDJSON_SYSTEM_PROMPT).toContain('compact single-line JSON');
    });

    it('shares the same quality rules as SYSTEM_PROMPT', () => {
        expect(NDJSON_SYSTEM_PROMPT).toContain('GROUNDED');
        expect(NDJSON_SYSTEM_PROMPT).toContain('CONCRETE');
        expect(NDJSON_SYSTEM_PROMPT).toContain('CONNECTED');
        expect(NDJSON_SYSTEM_PROMPT).toContain('QUANTIFIED');
    });
});

describe('TOUR_TYPE_PROMPTS', () => {
    const expectedTypes: TourType[] = ['overview', 'data-flow', 'onboarding', 'dependency-audit', 'api-surface', 'custom'];

    for (const type of expectedTypes) {
        it(`has a non-empty prompt for tour type "${type}"`, () => {
            expect(typeof TOUR_TYPE_PROMPTS[type]).toBe('string');
            expect(TOUR_TYPE_PROMPTS[type].length).toBeGreaterThan(0);
        });
    }

    it('overview prompt requires naming the architectural pattern', () => {
        expect(TOUR_TYPE_PROMPTS['overview']).toContain('architectural pattern');
    });

    it('data-flow prompt requires tracing transformation stages', () => {
        expect(TOUR_TYPE_PROMPTS['data-flow']).toContain('transformation stages');
    });

    it('onboarding prompt requires concrete commands or conventions', () => {
        expect(TOUR_TYPE_PROMPTS['onboarding']).toContain('concrete command');
    });

    it('dependency-audit prompt requires quantified issues', () => {
        expect(TOUR_TYPE_PROMPTS['dependency-audit']).toContain('quantified');
    });

    it('api-surface prompt requires actual route strings or handler names', () => {
        expect(TOUR_TYPE_PROMPTS['api-surface']).toContain('route strings');
    });

    it('custom prompt requires directly answering the user question', () => {
        expect(TOUR_TYPE_PROMPTS['custom']).toContain('directly and specifically answer');
    });
});

describe('buildUserPrompt', () => {
    it('includes the user query in the <user_query> tag', () => {
        const prompt = buildUserPrompt('## Analysis\nsome data', 'How does auth work?', 'custom');
        expect(prompt).toContain('<user_query>\nHow does auth work?\n</user_query>');
    });

    it('includes the analysis report text', () => {
        const analysisText = '## Analysis\nsome data about auth';
        const prompt = buildUserPrompt(analysisText, 'any query', 'overview');
        expect(prompt).toContain(analysisText);
    });

    it('includes the tour-type-specific goal in the <tour_goal> tag', () => {
        const prompt = buildUserPrompt('analysis', 'query', 'dependency-audit');
        expect(prompt).toContain('<tour_goal>');
        expect(prompt).toContain('Dependency Health Audit');
        expect(prompt).toContain('</tour_goal>');
    });

    it('includes an analysis_report tag showing char count', () => {
        const analysisText = 'x'.repeat(1500);
        const prompt = buildUserPrompt(analysisText, 'query', 'overview');
        expect(prompt).toContain('<analysis_report chars="1500">');
    });

    it('includes the grounding instruction', () => {
        const prompt = buildUserPrompt('analysis', 'query', 'overview');
        expect(prompt).toContain('Ground every file reference');
    });

    it('includes the rejection instruction for low-quality fallback', () => {
        const prompt = buildUserPrompt('analysis', 'query', 'overview');
        expect(prompt).toContain('return a rejection');
    });
});
