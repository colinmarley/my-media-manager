import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

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
});
