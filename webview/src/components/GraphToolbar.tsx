import { useState } from 'react';
import type { CouplingEdge } from './sigmaEdgeRenderers';
import type { Filters } from './sigmaGraphHelpers';
import { THEME } from './sigmaGraphHelpers';

const DISABLED_FILTER_OPACITY = 0.4;
const GROUP_STYLE = {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
} as const;
const GROUP_LABEL_STYLE = {
    color: THEME.textSecondary,
    fontSize: '11px',
    fontWeight: 700,
    letterSpacing: '0.04em',
    textTransform: 'uppercase',
} as const;
const CONTROL_ROW_STYLE = {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '6px',
} as const;

interface ToolbarControlProps {
    testId: string;
    className: string;
    label: string;
    active: boolean;
    disabled: boolean;
    title?: string;
    onClick: () => void;
}

// Render one HUD control with shared visual treatment and accessibility attributes.
function ToolbarControl({ testId, className, label, active, disabled, title, onClick }: ToolbarControlProps) {
    return (
        <button
            type="button"
            data-testid={testId}
            className={className}
            aria-pressed={active}
            disabled={disabled}
            title={title}
            onClick={onClick}
            style={{
                border: `1px solid ${active ? THEME.accent : THEME.border}`,
                borderRadius: className.includes('segment') ? '8px' : '999px',
                background: active ? THEME.accent : THEME.bg,
                color: active ? '#ffffff' : THEME.textSecondary,
                cursor: disabled ? 'default' : 'pointer',
                opacity: disabled ? DISABLED_FILTER_OPACITY : 1,
                fontSize: '12px',
                fontWeight: 600,
                minHeight: '30px',
                padding: className.includes('segment') ? '6px 12px' : '6px 10px',
            }}
        >
            {label}
        </button>
    );
}

interface GraphToolbarProps {
    hasTestNodes: boolean;
    hasCircularEdges: boolean;
    filters: Filters;
    onFiltersChange: (f: Filters) => void;
    setExpandedClusters: (s: Set<string>) => void;
    setSelectedNodeId: (id: string | null) => void;
    deadCodeFiles: string[];
    showDeadCode: boolean;
    onShowDeadCodeChange: (v: boolean) => void;
    couplingPairs: CouplingEdge[];
    showCouplingEdges: boolean;
    onShowCouplingEdgesChange: (v: boolean) => void;
    toolingFlowCount: number;
    flows: Array<unknown>;
    showFlowEdges: boolean;
    onShowFlowEdgesChange: (v: boolean) => void;
}

/**
 * GraphToolbar renders the filter overlay checkboxes for the Sigma graph.
 * Owns the group-by-directory toggle logic (resets cluster + selection state).
 */
export function GraphToolbar({ hasTestNodes, hasCircularEdges, filters, onFiltersChange, setExpandedClusters, setSelectedNodeId, deadCodeFiles, showDeadCode, onShowDeadCodeChange, couplingPairs, showCouplingEdges, onShowCouplingEdgesChange, toolingFlowCount, flows, showFlowEdges, onShowFlowEdgesChange }: GraphToolbarProps) {
    const [isExpanded, setIsExpanded] = useState(false);

    const handleGroupDirsToggle = (checked: boolean) => {
        setExpandedClusters(new Set());
        setSelectedNodeId(null);
        onFiltersChange({ ...filters, groupDirs: checked });
    };

    const flowEdgesDisabled = filters.showCircularOnly || flows.length === 0;
    const flowEdgesTitle = filters.showCircularOnly
        ? 'Flow edges are unavailable while Circular only is active'
        : flows.length > 0
            ? undefined
            : 'No flow sequences in this graph';

    return (
        <div data-testid="graph-hud" style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '8px 12px', background: THEME.bg, border: `1px solid ${THEME.border}`, borderRadius: '10px', fontSize: '12px' }}>
            <ToolbarControl
                testId="graph-tools-trigger"
                className="graph-toolbar-control graph-toolbar-control--segment"
                label="Graph tools"
                active={isExpanded}
                disabled={false}
                onClick={() => setIsExpanded((expanded) => !expanded)}
            />

            {isExpanded && (
                <>
                    <div data-testid="graph-hud-group-visibility" style={GROUP_STYLE}>
                        <span style={GROUP_LABEL_STYLE}>Visibility</span>
                        <div style={CONTROL_ROW_STYLE}>
                            <ToolbarControl
                                testId="visibility-control-show-tests"
                                className="graph-toolbar-control graph-toolbar-control--chip"
                                label="Show tests"
                                active={filters.showTestFiles}
                                disabled={!hasTestNodes}
                                title={hasTestNodes ? undefined : 'No test files in this graph'}
                                onClick={() => onFiltersChange({ ...filters, showTestFiles: !filters.showTestFiles })}
                            />
                            <ToolbarControl
                                testId="visibility-control-circular-only"
                                className="graph-toolbar-control graph-toolbar-control--chip"
                                label="Circular only"
                                active={filters.showCircularOnly}
                                disabled={!hasCircularEdges}
                                title={hasCircularEdges ? undefined : 'No circular dependencies in this graph'}
                                onClick={() => onFiltersChange({ ...filters, showCircularOnly: !filters.showCircularOnly })}
                            />
                        </div>
                    </div>

                    <div data-testid="graph-hud-group-layout" style={GROUP_STYLE}>
                        <span style={GROUP_LABEL_STYLE}>Layout</span>
                        <div style={CONTROL_ROW_STYLE}>
                            <ToolbarControl
                                testId="layout-control-group-dirs"
                                className="graph-toolbar-control graph-toolbar-control--segment"
                                label="Group by dir"
                                active={filters.groupDirs}
                                disabled={false}
                                onClick={() => handleGroupDirsToggle(!filters.groupDirs)}
                            />
                        </div>
                    </div>

                    <div data-testid="graph-hud-group-analysis" style={GROUP_STYLE}>
                        <span style={GROUP_LABEL_STYLE}>Analysis</span>
                        <div style={CONTROL_ROW_STYLE}>
                            <ToolbarControl
                                testId="analysis-control-dead-code"
                                className="graph-toolbar-control graph-toolbar-control--chip"
                                label="Dead code"
                                active={showDeadCode}
                                disabled={deadCodeFiles.length === 0}
                                title={deadCodeFiles.length > 0 ? undefined : 'No dead code files in this graph'}
                                onClick={() => onShowDeadCodeChange(!showDeadCode)}
                            />
                            <ToolbarControl
                                testId="analysis-control-coupling-edges"
                                className="graph-toolbar-control graph-toolbar-control--chip"
                                label="Co-change"
                                active={showCouplingEdges}
                                disabled={couplingPairs.length === 0}
                                title={couplingPairs.length > 0 ? undefined : 'No coupling pairs in this graph'}
                                onClick={() => onShowCouplingEdgesChange(!showCouplingEdges)}
                            />
                            <ToolbarControl
                                testId="analysis-control-flow-edges"
                                className="graph-toolbar-control graph-toolbar-control--chip"
                                label={`Flow edges${flows.length > 0 ? ` (${flows.length})` : ''}${toolingFlowCount > 0 ? ` • ${toolingFlowCount} tooling hidden` : ''}`}
                                active={showFlowEdges && !filters.showCircularOnly}
                                disabled={flowEdgesDisabled}
                                title={flowEdgesTitle}
                                onClick={() => onShowFlowEdgesChange(!showFlowEdges)}
                            />
                        </div>
                    </div>
                </>
            )}
        </div>
    );
}
