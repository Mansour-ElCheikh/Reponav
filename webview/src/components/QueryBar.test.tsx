/** @vitest-environment jsdom */

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryBar } from './QueryBar';

const MIN_LENGTH_VALID_QUERY = 'alpha beta';

afterEach(() => {
    cleanup();
});

describe('QueryBar smoke', () => {
    it('renders preset buttons and custom input form', () => {
        render(<QueryBar onSubmit={vi.fn()} />);

        expect(screen.getByRole('button', { name: /overview/i })).toBeTruthy();
        expect(screen.getByRole('button', { name: /data flow/i })).toBeTruthy();
        expect(screen.getByPlaceholderText(/ask about code structure/i)).toBeTruthy();
        const submitButton = screen.getByRole('button', { name: /generate tour/i }) as HTMLButtonElement;
        expect(submitButton.disabled).toBe(true);
    });

    it('submits custom query when valid', async () => {
        const user = userEvent.setup();
        const onSubmit = vi.fn();
        render(<QueryBar onSubmit={onSubmit} />);

        await user.type(screen.getByPlaceholderText(/ask about code structure/i), 'How is authentication handled?');
        await user.click(screen.getByRole('button', { name: /generate tour/i }));

        expect(onSubmit).toHaveBeenCalledWith('How is authentication handled?', 'custom');
    });

    it('accepts a two-word query at the minimum length boundary', async () => {
        const user = userEvent.setup();
        const onSubmit = vi.fn();
        render(<QueryBar onSubmit={onSubmit} />);

        await user.type(screen.getByPlaceholderText(/ask about code structure/i), MIN_LENGTH_VALID_QUERY);
        await user.click(screen.getByRole('button', { name: /generate tour/i }));

        expect(onSubmit).toHaveBeenCalledWith(MIN_LENGTH_VALID_QUERY, 'custom');
    });

    it('rejects too-short custom query and shows validation message', async () => {
        const user = userEvent.setup();
        const onSubmit = vi.fn();
        render(<QueryBar onSubmit={onSubmit} />);

        await user.type(screen.getByPlaceholderText(/ask about code structure/i), 'short');
        await user.click(screen.getByRole('button', { name: /generate tour/i }));

        expect(onSubmit).not.toHaveBeenCalled();
        expect(screen.getByText(/query too short/i)).toBeTruthy();
    });
});
