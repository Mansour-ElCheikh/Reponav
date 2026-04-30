import * as path from 'path';
import { appendJsonl } from './append';

const SINK = path.resolve(__dirname, '../../.reponav/llm-usage.jsonl');

export interface LLMUsageRecord {
    provider: string;
    model?: string;
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
    durationMs: number;
    callerTool?: string;
    mode?: string;
    chosen?: string;
    candidatesTried?: string[];
    cascadeFailed?: boolean;
    error?: string;
}

/**
 * Emit a single LLM-call telemetry record to `.reponav/llm-usage.jsonl`.
 * Per ADR 0028: every provider call MUST land here. Schema is append-only —
 * fields may be added but never renamed or dropped.
 */
export function logLLMUsage(record: LLMUsageRecord): void {
    appendJsonl(SINK, { ts: new Date().toISOString(), ...record });
}
