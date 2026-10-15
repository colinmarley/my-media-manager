import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { vi, describe, it, expect, afterEach } from 'vitest';

import { useUnsavedChangesGuard } from '../../src/components/form';

function Page({ dirty, onNavigate }: { dirty: boolean; onNavigate: () => void }) {
  useUnsavedChangesGuard(dirty);
  return (
    <a href="/dashboard/other" onClick={(e) => { if (!e.defaultPrevented) onNavigate(); e.preventDefault(); }}>
      Go
    </a>
  );
}

describe('useUnsavedChangesGuard', () => {
  afterEach(() => vi.restoreAllMocks());

  it('lets in-app links through when the form is clean', () => {
    const confirmSpy = vi.spyOn(window, 'confirm');
    const onNavigate = vi.fn();
    render(<Page dirty={false} onNavigate={onNavigate} />);
    fireEvent.click(screen.getByText('Go'));
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(onNavigate).toHaveBeenCalled();
  });

  it('blocks in-app navigation when the user cancels the confirm', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    const onNavigate = vi.fn();
    render(<Page dirty onNavigate={onNavigate} />);
    fireEvent.click(screen.getByText('Go'));
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it('allows navigation when the user confirms', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const onNavigate = vi.fn();
    render(<Page dirty onNavigate={onNavigate} />);
    fireEvent.click(screen.getByText('Go'));
    expect(onNavigate).toHaveBeenCalled();
  });
});
