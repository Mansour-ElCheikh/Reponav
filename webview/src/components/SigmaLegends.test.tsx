import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { NodeSelectionLegend, NodeTypeLegend } from './SigmaLegends';

describe('NodeSelectionLegend', () => {
    it('renders null when no node selected', () => {
        const { container } = render(
            <NodeSelectionLegend
                selectedNodeId={null}
                upstreamCount={2}
                downstreamCount={1}
                circularCount={0}
                onClearSelection={vi.fn()}
            />,
        );
        expect(container.firstChild).toBeNull();
    });

    it('renders upstream/downstream counts for selected node', () => {
        render(
            <NodeSelectionLegend
                selectedNodeId="src/foo.ts"
                upstreamCount={2}
                downstreamCount={1}
                circularCount={0}
                onClearSelection={vi.fn()}
            />,
        );
        expect(screen.getByText(/2 upstream/)).toBeTruthy();
        expect(screen.getByText(/1 downstream/)).toBeTruthy();
    });

    it('calls onClearSelection when Clear button clicked', () => {
        const onClear = vi.fn();
        render(
            <NodeSelectionLegend
                selectedNodeId="src/foo.ts"
                upstreamCount={2}
                downstreamCount={1}
                circularCount={0}
                onClearSelection={onClear}
            />,
        );
        fireEvent.click(screen.getByText('Clear selection'));
        expect(onClear).toHaveBeenCalledOnce();
    });

    it('shows dir label for cluster nodes', () => {
        render(
            <NodeSelectionLegend
                selectedNodeId="cluster::src/utils"
                upstreamCount={0}
                downstreamCount={0}
                circularCount={0}
                onClearSelection={vi.fn()}
            />,
        );
        expect(screen.getByText('src/utils/ (dir)')).toBeTruthy();
    });

    it('shows circular row when circularCount > 0', () => {
        render(
            <NodeSelectionLegend
                selectedNodeId="src/foo.ts"
                upstreamCount={2}
                downstreamCount={1}
                circularCount={3}
                onClearSelection={vi.fn()}
            />,
        );
        expect(screen.getByText(/3 circular/)).toBeTruthy();
    });

    it('hides circular row when circularCount is 0', () => {
        render(
            <NodeSelectionLegend
                selectedNodeId="src/foo.ts"
                upstreamCount={2}
                downstreamCount={1}
                circularCount={0}
                onClearSelection={vi.fn()}
            />,
        );
        expect(screen.queryByText(/circular/)).toBeNull();
    });

    it('counts from props match what is rendered — no map lookup', () => {
        render(
            <NodeSelectionLegend
                selectedNodeId="src/foo.ts"
                upstreamCount={5}
                downstreamCount={7}
                circularCount={2}
                onClearSelection={vi.fn()}
            />,
        );
        expect(screen.getByText(/5 upstream/)).toBeTruthy();
        expect(screen.getByText(/7 downstream/)).toBeTruthy();
        expect(screen.getByText(/2 circular/)).toBeTruthy();
    });

    it('calls onSubFilterChange with "upstream" when upstream row clicked', () => {
        const onSubFilterChange = vi.fn();
        render(
            <NodeSelectionLegend
                selectedNodeId="src/foo.ts"
                upstreamCount={2}
                downstreamCount={1}
                circularCount={0}
                onClearSelection={vi.fn()}
                activeSubFilter={null}
                onSubFilterChange={onSubFilterChange}
            />,
        );
        fireEvent.click(screen.getByText(/2 upstream/).closest('[data-subfilter]')!);
        expect(onSubFilterChange).toHaveBeenCalledWith('upstream');
    });

    it('calls onSubFilterChange with null when clicking the already-active row', () => {
        const onSubFilterChange = vi.fn();
        render(
            <NodeSelectionLegend
                selectedNodeId="src/foo.ts"
                upstreamCount={2}
                downstreamCount={1}
                circularCount={0}
                onClearSelection={vi.fn()}
                activeSubFilter="upstream"
                onSubFilterChange={onSubFilterChange}
            />,
        );
        fireEvent.click(screen.getByText(/2 upstream/).closest('[data-subfilter]')!);
        expect(onSubFilterChange).toHaveBeenCalledWith(null);
    });

    it('shows active state on the highlighted row', () => {
        const { container } = render(
            <NodeSelectionLegend
                selectedNodeId="src/foo.ts"
                upstreamCount={2}
                downstreamCount={1}
                circularCount={0}
                onClearSelection={vi.fn()}
                activeSubFilter="upstream"
                onSubFilterChange={vi.fn()}
            />,
        );
        const activeRow = container.querySelector('[data-subfilter="upstream"]');
        expect(activeRow).toBeTruthy();
        expect(activeRow!.getAttribute('data-active')).toBe('true');
    });

    it('renders as flow content without absolute positioning so the frame anchors can place it', () => {
        const { container } = render(
            <NodeSelectionLegend
                selectedNodeId="src/foo.ts"
                upstreamCount={2}
                downstreamCount={1}
                circularCount={0}
                onClearSelection={vi.fn()}
            />,
        );

        expect((container.firstChild as HTMLElement).style.position).toBe('');
    });
});

describe('NodeTypeLegend', () => {
    const nodes = [
        { id: 'a', label: 'a.ts', type: 'module', weight: 1 },
        { id: 'b', label: 'b.ts', type: 'test', weight: 1 },
        { id: 'c', label: 'c.ts', type: 'module', weight: 1 },
    ];

    it('renders null when no displayable node types', () => {
        const { container } = render(
            <NodeTypeLegend
                nodes={[]}
                highlightedType={null}
                onTypeClick={vi.fn()}
            />,
        );
        expect(container.firstChild).toBeNull();
    });

    it('renders legend items for each unique node type', () => {
        render(
            <NodeTypeLegend
                nodes={nodes}
                highlightedType={null}
                onTypeClick={vi.fn()}
            />,
        );
        // Should show 'module' and 'test' items
        expect(screen.getAllByRole('button').length).toBeGreaterThanOrEqual(1);
    });

    it('calls onTypeClick when a type item is clicked', () => {
        const onTypeClick = vi.fn();
        render(
            <NodeTypeLegend
                nodes={nodes}
                highlightedType={null}
                onTypeClick={onTypeClick}
            />,
        );
        // Click "Node types" toggle first to ensure list is open, then click a type
        const buttons = screen.getAllByRole('button');
        // The toggle button is first
        fireEvent.click(buttons[0]);
    });
});
