import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import MediaDetailHeaderBar from '../../src/app/dashboard/my-library/_components/detail/MediaDetailHeaderBar';

describe('MediaDetailHeaderBar', () => {
  it('links back to the library and exposes the remove action', () => {
    render(<MediaDetailHeaderBar hasMedia onRemoveFromLibrary={() => {}} />);

    expect(screen.getByRole('link', { name: 'Back to My Library' })).toHaveAttribute(
      'href',
      '/dashboard/my-library'
    );
    expect(screen.getByRole('button', { name: 'Remove from Library' })).toBeInTheDocument();
  });

  it('hides the remove action when the record is still loading', () => {
    render(<MediaDetailHeaderBar hasMedia={false} onRemoveFromLibrary={() => {}} />);

    expect(screen.queryByRole('button', { name: 'Remove from Library' })).not.toBeInTheDocument();
  });

  it('offers "Rescan files" when a rescan handler is given, and shows the running scan', () => {
    const onRescan = vi.fn();
    const { rerender } = render(<MediaDetailHeaderBar hasMedia onRemoveFromLibrary={() => {}} onRescan={onRescan} />);

    fireEvent.click(screen.getByRole('button', { name: 'Rescan files' }));
    expect(onRescan).toHaveBeenCalled();

    rerender(<MediaDetailHeaderBar hasMedia onRemoveFromLibrary={() => {}} onRescan={onRescan} scanning />);
    expect(screen.getByRole('button', { name: 'Scanning…' })).toBeDisabled();
  });

  it('hides "Rescan files" without a rescan handler', () => {
    render(<MediaDetailHeaderBar hasMedia onRemoveFromLibrary={() => {}} />);

    expect(screen.queryByRole('button', { name: 'Rescan files' })).not.toBeInTheDocument();
  });
});
