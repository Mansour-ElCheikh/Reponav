import { useState, useMemo } from 'react';
import { MapPin, Layers } from 'lucide-react';
import { NODE_TYPE_LABELS, THEME } from './sigmaGraphHelpers';
import { CIRCULAR_COLOR, DOWNSTREAM_COLOR, NODE_COLORS, UPSTREAM_COLOR } from './sigmaRenderPolicy';
import type { GraphNode } from '../types';

/** Props for NodeSelectionLegend */
export interface NodeSelectionLegendProps {
    selectedNodeId: string | null;
    upstreamCount: number;
    downstreamCount: number;
    circularCount: number;
    onClearSelection: () => void;
    /** Which category is currently sub-filtered. Optional — when absent, no sub-filter rows are rendered. */
    activeSubFilter?: 'upstream' | 'downstream' | 'circular' | null;
    /** Called when a row is clicked. Passes null to clear the sub-filter. */
    onSubFilterChange?: (filter: 'upstream' | 'downstream' | 'circular' | null) => void;
}

/** Renders the node selection info panel (upstream/downstream counts + clear button). */
export function NodeSelectionLegend({ selectedNodeId, upstreamCount, downstreamCount, circularCount, onClearSelection, activeSubFilter, onSubFilterChange }: NodeSelectionLegendProps) {
    return useMemo(() => {
        if (!selectedNodeId) return null;
        const fileName = selectedNodeId.startsWith('cluster::')
            ? `${selectedNodeId.replace('cluster::', '')}/ (dir)`
            : selectedNodeId.split('/').pop();

        const interactive = onSubFilterChange !== undefined;
        const rowStyle = (key: 'upstream' | 'downstream' | 'circular'): React.CSSProperties => ({
            display: 'flex', alignItems: 'center', gap: '8px', padding: '4px 0',
            color: THEME.textSecondary,
            cursor: interactive ? 'pointer' : 'default',
            borderRadius: '4px',
            background: interactive && activeSubFilter === key ? `${THEME.accent}22` : 'transparent',
            outline: interactive && activeSubFilter === key ? `1px solid ${THEME.accent}66` : 'none',
        });

        const handleRowClick = (key: 'upstream' | 'downstream' | 'circular') => {
            if (!onSubFilterChange) return;
            onSubFilterChange(activeSubFilter === key ? null : key);
        };

        return (
            <div style={{ padding: '12px 16px', background: THEME.bg, border: `1px solid ${THEME.border}`, borderRadius: '8px', fontSize: '12px', minWidth: '200px', boxShadow: '0 4px 16px rgba(0,0,0,0.4)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 600, fontSize: '13px', marginBottom: '8px', color: THEME.textPrimary }}>
                    <MapPin size={14} aria-hidden="true" />
                    {fileName}
                </div>
                <div
                    data-subfilter="upstream"
                    data-active={interactive && activeSubFilter === 'upstream' ? 'true' : 'false'}
                    style={rowStyle('upstream')}
                    onClick={() => handleRowClick('upstream')}
                    role={interactive ? 'button' : undefined}
                    tabIndex={interactive ? 0 : undefined}
                    onKeyDown={interactive ? (e) => { if (e.key === 'Enter' || e.key === ' ') handleRowClick('upstream'); } : undefined}
                >
                    <span style={{ width: 10, height: 10, borderRadius: '50%', background: UPSTREAM_COLOR, flexShrink: 0, display: 'inline-block' }} />
                    <span>{upstreamCount} upstream (depends on me)</span>
                </div>
                <div
                    data-subfilter="downstream"
                    data-active={interactive && activeSubFilter === 'downstream' ? 'true' : 'false'}
                    style={rowStyle('downstream')}
                    onClick={() => handleRowClick('downstream')}
                    role={interactive ? 'button' : undefined}
                    tabIndex={interactive ? 0 : undefined}
                    onKeyDown={interactive ? (e) => { if (e.key === 'Enter' || e.key === ' ') handleRowClick('downstream'); } : undefined}
                >
                    <span style={{ width: 10, height: 10, borderRadius: '50%', background: DOWNSTREAM_COLOR, flexShrink: 0, display: 'inline-block' }} />
                    <span>{downstreamCount} downstream (I depend on)</span>
                </div>
                {circularCount > 0 && (
                    <div
                        data-subfilter="circular"
                        data-active={interactive && activeSubFilter === 'circular' ? 'true' : 'false'}
                        style={rowStyle('circular')}
                        onClick={() => handleRowClick('circular')}
                        role={interactive ? 'button' : undefined}
                        tabIndex={interactive ? 0 : undefined}
                        onKeyDown={interactive ? (e) => { if (e.key === 'Enter' || e.key === ' ') handleRowClick('circular'); } : undefined}
                    >
                        <span style={{ width: 10, height: 10, borderRadius: '50%', background: CIRCULAR_COLOR, flexShrink: 0, display: 'inline-block' }} />
                        <span>{circularCount} circular</span>
                    </div>
                )}
                <button
                    onClick={onClearSelection}
                    style={{ display: 'block', marginTop: '8px', padding: '4px 10px', border: `1px solid ${THEME.border}`, borderRadius: '4px', background: 'transparent', color: THEME.textSecondary, cursor: 'pointer', fontSize: '11px', width: '100%' }}
                    onMouseEnter={(e) => { (e.target as HTMLButtonElement).style.color = THEME.accent; (e.target as HTMLButtonElement).style.borderColor = THEME.accent; }}
                    onMouseLeave={(e) => { (e.target as HTMLButtonElement).style.color = THEME.textSecondary; (e.target as HTMLButtonElement).style.borderColor = THEME.border; }}
                >
                    Clear selection
                </button>
            </div>
        );
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedNodeId, upstreamCount, downstreamCount, circularCount, activeSubFilter, onClearSelection, onSubFilterChange]);
}

/** Props for NodeTypeLegend */
export interface NodeTypeLegendProps {
    nodes: Pick<GraphNode, 'type'>[];
    highlightedType: string | null;
    onTypeClick: (type: string) => void;
}

/** Renders the collapsible node-type color legend panel. */
export function NodeTypeLegend({ nodes, highlightedType, onTypeClick }: NodeTypeLegendProps) {
    const [typeLegendOpen, setTypeLegendOpen] = useState(true);

    const presentTypes = useMemo(() => [...new Set(
        nodes.map((n) => n.type).filter((t) => t in NODE_COLORS),
    )].sort(), [nodes]);

    if (presentTypes.length === 0) return null;

    return (
        <div className="node-type-legend">
            <button
                className="node-type-legend-toggle"
                onClick={() => setTypeLegendOpen((o) => !o)}
                aria-expanded={typeLegendOpen}
            >
                <Layers size={13} aria-hidden="true" />
                <span>Node types</span>
                <span className="node-type-legend-chevron">{typeLegendOpen ? '▲' : '▼'}</span>
            </button>
            {typeLegendOpen && (
                <ul className="node-type-legend-list">
                    {presentTypes.map((type) => (
                        <li
                            key={type}
                            className={`node-type-legend-item${highlightedType === type ? ' node-type-legend-item--active' : ''}`}
                            style={{ '--dot-color': NODE_COLORS[type] } as React.CSSProperties}
                            onClick={() => onTypeClick(type)}
                            role="button"
                            aria-pressed={highlightedType === type}
                            tabIndex={0}
                            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onTypeClick(type); }}
                        >
                            <span className="node-type-legend-dot" style={{ background: NODE_COLORS[type] }} />
                            <span className="node-type-legend-label">{NODE_TYPE_LABELS[type] ?? type}</span>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}
