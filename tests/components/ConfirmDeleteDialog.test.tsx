import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect } from 'vitest';

import ConfirmDeleteDialog from '../../src/app/dashboard/physical-media/_components/ConfirmDeleteDialog';

describe('ConfirmDeleteDialog', () => {
  it('renders the title and description', () => {
    render(
      <ConfirmDeleteDialog
        open
        title="Delete disc?"
        description="This cannot be undone."
        onClose={vi.fn()}
        onConfirm={vi.fn().mockResolvedValue(undefined)}
      />
    );
    expect(screen.getByText('Delete disc?')).toBeInTheDocument();
    expect(screen.getByText('This cannot be undone.')).toBeInTheDocument();
  });

  it('calls onClose (not onConfirm) when Cancel is clicked', () => {
    const onClose = vi.fn();
    const onConfirm = vi.fn();
    render(
      <ConfirmDeleteDialog open title="t" description="d" onClose={onClose} onConfirm={onConfirm} />
    );
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('calls onConfirm then onClose when Delete is clicked', async () => {
    const onClose = vi.fn();
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    render(
      <ConfirmDeleteDialog open title="t" description="d" onClose={onClose} onConfirm={onConfirm} />
    );
    fireEvent.click(screen.getByRole('button', { name: /^delete$/i }));
    await waitFor(() => {
      expect(onConfirm).toHaveBeenCalledTimes(1);
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('shows an error and does not close when onConfirm rejects', async () => {
    const onClose = vi.fn();
    const onConfirm = vi.fn().mockRejectedValue(new Error('cannot delete: still referenced'));
    render(
      <ConfirmDeleteDialog open title="t" description="d" onClose={onClose} onConfirm={onConfirm} />
    );
    fireEvent.click(screen.getByRole('button', { name: /^delete$/i }));
    await waitFor(() => {
      expect(screen.getByText('cannot delete: still referenced')).toBeInTheDocument();
    });
    expect(onClose).not.toHaveBeenCalled();
  });
});
