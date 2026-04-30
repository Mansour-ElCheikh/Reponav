/**
 * Framework & Technology Detector
 *
 * Detects frameworks, libraries, runtimes, and build tools from manifest files
 * and file structure. Purely deterministic — no AI.
 */

import type { FrameworkInfo } from '../types';
import { detectFrameworksFromRules } from './frameworkDetectionRules';

// ─── Main Detector ───────────────────────────────────────────────────────────

/** Detects frameworks, libraries, and build tools from manifest files and file structure. */
export async function detectFrameworks(
    files: Map<string, string>
): Promise<FrameworkInfo[]> {
    return detectFrameworksFromRules(files);
}

/**
 * Detect the primary language based on file extension distribution.
 */
export function detectPrimaryLanguage(filePaths: string[]): string {
    const counts: Record<string, number> = {};
    const extToLang: Record<string, string> = {
        '.ts': 'TypeScript', '.tsx': 'TypeScript',
        '.js': 'JavaScript', '.jsx': 'JavaScript', '.mjs': 'JavaScript',
        '.py': 'Python',
        '.go': 'Go',
        '.java': 'Java', '.kt': 'Kotlin',
        '.rs': 'Rust',
        '.rb': 'Ruby',
        '.php': 'PHP',
        '.cs': 'C#',
        '.cpp': 'C++', '.cc': 'C++', '.cxx': 'C++',
        '.c': 'C',
        '.swift': 'Swift',
    };

    for (const file of filePaths) {
        const ext = file.substring(file.lastIndexOf('.'));
        const lang = extToLang[ext];
        if (lang) {
            counts[lang] = (counts[lang] || 0) + 1;
        }
    }

    const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    return sorted[0]?.[0] || 'Unknown';
}
