import * as path from 'path';
import { appendJsonl } from './append';

const SINK = path.resolve(__dirname, '../../.reponav/llm-usage.jsonl');

// One sessionId per Node process. Lets the dashboard group records into the
// same agent run when summing tokens. Cheap; collisions across machines are
// fine because telemetry is per-repo.
const SESSION_ID = `${process.pid}-${Date.now().toString(36)}`;

/** Telemetry record schema for one LLM-provider call (per ADR-0028). */
export interface LLMUsageRecord {
    provider: string;
    model?: string;
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
    /**
     * inputTokens / outputTokens are append-only aliases for promptTokens /
     * completionTokens. They normalize to the proctor + agent-reliability
     * schema (input/output naming). If only one pair is supplied, the other
     * is mirrored at log time. Both schemas remain readable.
     */
    inputTokens?: number;
    outputTokens?: number;
    durationMs: number;
    callerTool?: string;
    mode?: string;
    chosen?: string;
    candidatesTried?: string[];
    cascadeFailed?: boolean;
    error?: string;
    sessionId?: string;
}

/**
 * Emit a single LLM-call telemetry record to `.reponav/llm-usage.jsonl`.
 * Per ADR 0028: every provider call MUST land here. Schema is append-only —
 * fields may be added but never renamed or dropped.
 *
 * Normalizes input/output ↔ prompt/completion token aliases so consumers
 * reading either schema find non-zero values when the provider supplied them.
 */
export function logLLMUsage(record: LLMUsageRecord): void {
    const inputTokens = record.inputTokens ?? record.promptTokens;
    const outputTokens = record.outputTokens ?? record.completionTokens;
    const promptTokens = record.promptTokens ?? record.inputTokens;
    const completionTokens = record.completionTokens ?? record.outputTokens;
    const totalTokens = record.totalTokens
        ?? (typeof promptTokens === 'number' && typeof completionTokens === 'number'
            ? promptTokens + completionTokens
            : undefined);
    appendJsonl(SINK, {
        ts: new Date().toISOString(),
        sessionId: SESSION_ID,
        ...record,
        ...(inputTokens !== undefined ? { inputTokens } : {}),
        ...(outputTokens !== undefined ? { outputTokens } : {}),
        ...(promptTokens !== undefined ? { promptTokens } : {}),
        ...(completionTokens !== undefined ? { completionTokens } : {}),
        ...(totalTokens !== undefined ? { totalTokens } : {}),
    });
}
