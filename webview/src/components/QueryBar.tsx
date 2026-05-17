/**
 * QueryBar — Tour request input
 */

import { GitBranch, Map, Network, Rocket, Shuffle, type LucideIcon } from 'lucide-react';
import { useState } from 'react';
import type { TourType } from '../types';

const MIN_QUERY_LENGTH = 10;

interface QueryBarProps {
    onSubmit: (query: string, tourType: TourType) => void;
}

const TOUR_PRESETS: Array<{ label: string; icon: LucideIcon; type: TourType; query: string }> = [
    { label: 'Overview', icon: Map, type: 'overview', query: 'Give me an architecture overview' },
    { label: 'Data Flow', icon: Shuffle, type: 'data-flow', query: 'Trace the data flow' },
    { label: 'Onboarding', icon: Rocket, type: 'onboarding', query: 'Onboard me to this codebase' },
    { label: 'Dependencies', icon: GitBranch, type: 'dependency-audit', query: 'Audit dependency health' },
    { label: 'API Surface', icon: Network, type: 'api-surface', query: 'Map the API surface' },
];

/**
 * Basic client-side check: rejects gibberish (no vowels, excessive repeats, too short).
 * Returns an error message or null if valid.
 */
function validateQuery(input: string): string | null {
    const trimmed = input.trim();
    if (trimmed.length < MIN_QUERY_LENGTH) {
        return 'Query too short — try asking a specific question about the codebase.';
    }
    // Must contain at least one vowel (filters keyboard mashing like "asdfghjkl" won't hit this, but "xzqkwp" will)
    if (!/[aeiou]/i.test(trimmed)) {
        return 'That doesn\'t look like a real question. Try something like "How is authentication handled?"';
    }
    // Reject if any single character repeats 4+ times in a row
    if (/(.)\1{3,}/.test(trimmed)) {
        return 'That doesn\'t look like a real question. Try asking about code structure or data flow.';
    }
    // Must contain at least 2 word-like tokens
    const words = trimmed.split(/\s+/).filter(w => w.length > 1);
    if (words.length < 2) {
        return 'Please ask a more complete question about the codebase.';
    }
    return null;
}

/** Query input surface for requesting a new tour or using preset tour types. */
export function QueryBar({ onSubmit }: QueryBarProps) {
    const [query, setQuery] = useState('');
    const [validationError, setValidationError] = useState<string | null>(null);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        const error = validateQuery(query);
        if (error) {
            setValidationError(error);
            return;
        }
        setValidationError(null);
        onSubmit(query.trim(), 'custom');
        setQuery('');
    };

    return (
        <div className="query-bar">
            {/* Preset buttons */}
            <div className="preset-grid">
                {TOUR_PRESETS.map((preset) => (
                    <button
                        key={preset.type}
                        className="preset-btn"
                        onClick={() => onSubmit(preset.query, preset.type)}
                    >
                        <preset.icon className="preset-icon" aria-hidden="true" />
                        <span className="preset-label">{preset.label}</span>
                    </button>
                ))}
            </div>

            {/* Custom query input */}
            <form className="query-form" onSubmit={handleSubmit}>
                <input
                    type="text"
                    value={query}
                    onChange={(e) => { setQuery(e.target.value); setValidationError(null); }}
                    placeholder="Ask about code structure, data flow, dependencies..."
                    className="query-input"
                />
                <button
                    type="submit"
                    className="query-submit"
                    disabled={!query.trim()}
                >
                    Generate Tour →
                </button>
                {validationError && (
                    <p className="query-validation-error">{validationError}</p>
                )}
            </form>
        </div>
    );
}
