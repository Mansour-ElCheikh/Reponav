import * as fs from 'fs';
import * as path from 'path';

/**
 * Append one JSON object as a single line to a `.jsonl` sink. Never throws —
 * telemetry must not break a hot path. Creates parent dir on demand.
 */
export function appendJsonl(file: string, obj: Record<string, unknown>): void {
    try {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.appendFileSync(file, JSON.stringify(obj) + '\n');
    } catch {
        /* swallow — sink unavailable */
    }
}

/**
 * Append one plaintext line to a log sink. Adds trailing newline if missing.
 * Never throws.
 */
export function appendLogLine(file: string, line: string): void {
    try {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        const out = line.endsWith('\n') ? line : line + '\n';
        fs.appendFileSync(file, out);
    } catch {
        /* swallow */
    }
}
