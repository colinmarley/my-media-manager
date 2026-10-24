import { describe, expect, it, vi } from 'vitest';
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';

import IngressWatcherControlCard from '@/app/admin/_components/ingress/IngressWatcherControlCard';
import type { IngressWatcherStatus } from '@/service/ingress/IngressAutomationService';

const stoppedWatcher: IngressWatcherStatus = {
  is_running: false,
  watched_paths: ['/data/ingress'],
  pending_count: 0,
  queue_count: 0,
  processed_event_count: 0,
};

const renderCard = (overrides: Record<string, unknown> = {}) => {
  const props = {
    pathsInput: '/data/ingress',
    onPathsInputChange: vi.fn(),
    processExistingOnStart: false,
    onProcessExistingOnStartChange: vi.fn(),
    resetCompletedOnStart: false,
    onResetCompletedOnStartChange: vi.fn(),
    working: false,
    watcher: stoppedWatcher,
    onOpenFolderBrowser: vi.fn(),
    onStartWatcher: vi.fn(),
    onStopWatcher: vi.fn(),
    onProcessPending: vi.fn(),
    onRefresh: vi.fn(),
    ...overrides,
  };

  render(<IngressWatcherControlCard {...(props as never)} />);

  return props;
};

describe('IngressWatcherControlCard', () => {
  it('labels the start button for the work that is actually running', () => {
    renderCard();
    expect(screen.getByRole('button', { name: 'Start Watcher' })).toBeInTheDocument();

    renderCard({ watcher: { ...stoppedWatcher, initial_queue: { in_progress: true, scanned_files: 0, queued_files: 0 } } });
    expect(screen.getByRole('button', { name: 'Queueing Existing Files…' })).toBeInTheDocument();

    renderCard({ working: true });
    expect(screen.getByRole('button', { name: 'Working…' })).toBeInTheDocument();
  });

  it('disables every watcher action while a request is in flight', () => {
    const props = renderCard({ working: true });

    expect(screen.getByRole('button', { name: 'Working…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Stop Watcher' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Process Pending Now' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Browse Folder' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Stop Watcher' }));
    expect(props.onStopWatcher).not.toHaveBeenCalled();
  });

  it('sends the edited paths and the start-up switches back to the hook', () => {
    const props = renderCard();

    fireEvent.change(screen.getByLabelText('Ingress Paths (one per line)'), {
      target: { value: '/data/ingress\n/data/series' },
    });
    expect(props.onPathsInputChange).toHaveBeenCalledWith('/data/ingress\n/data/series');

    fireEvent.click(screen.getByRole('switch', { name: 'Move completed organized files back to encoded before starting watcher' }));
    expect(props.onResetCompletedOnStartChange).toHaveBeenCalledWith(true);

    fireEvent.click(screen.getByRole('button', { name: 'Browse Folder' }));
    expect(props.onOpenFolderBrowser).toHaveBeenCalled();
  });

  it('wires the watcher commands to their handlers', () => {
    const props = renderCard();

    fireEvent.click(screen.getByRole('button', { name: 'Start Watcher' }));
    fireEvent.click(screen.getByRole('button', { name: 'Stop Watcher' }));
    fireEvent.click(screen.getByRole('button', { name: 'Process Pending Now' }));
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));

    expect(props.onStartWatcher).toHaveBeenCalled();
    expect(props.onStopWatcher).toHaveBeenCalled();
    expect(props.onProcessPending).toHaveBeenCalled();
    expect(props.onRefresh).toHaveBeenCalled();
  });
});
