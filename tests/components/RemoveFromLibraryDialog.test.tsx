import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import RemoveFromLibraryDialog from '../../src/app/dashboard/my-library/_components/detail/RemoveFromLibraryDialog';

describe('RemoveFromLibraryDialog', () => {
  it('does not render when closed', () => {
    render(<RemoveFromLibraryDialog open={false} onClose={vi.fn()} error={null} deleting={false} onConfirm={vi.fn()} />);

    expect(screen.queryByText('Remove from Library?')).not.toBeInTheDocument();
  });

  it('names the title and explains that organized folders are moved to _NeedsReview', () => {
    render(
      <RemoveFromLibraryDialog
        open
        onClose={vi.fn()}
        title="Big Movie"
        error={null}
        deleting={false}
        onConfirm={vi.fn()}
      />
    );

    expect(screen.getByText('Remove from Library?')).toBeInTheDocument();
    expect(screen.getByText('Big Movie')).toBeInTheDocument();
    expect(screen.getByText('_NeedsReview', { exact: false })).toBeInTheDocument();
  });

  it('confirms removal and surfaces removal errors', () => {
    const onConfirm = vi.fn();
    render(
      <RemoveFromLibraryDialog
        open
        onClose={vi.fn()}
        title="Big Movie"
        error="Removal failed."
        deleting={false}
        onConfirm={onConfirm}
      />
    );

    expect(screen.getByText('Removal failed.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('locks both actions while the removal is running', () => {
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    render(
      <RemoveFromLibraryDialog open onClose={onClose} title="Big Movie" error={null} deleting onConfirm={onConfirm} />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Removing…' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onConfirm).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
});
