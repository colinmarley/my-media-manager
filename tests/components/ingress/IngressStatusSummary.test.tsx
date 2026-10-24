import { describe, expect, it } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';

import IngressStatusSummary from '@/app/admin/_components/ingress/IngressStatusSummary';
import type {
  IngressQueueStatus,
  IngressWatcherStatus,
} from '@/service/ingress/IngressAutomationService';

const watcher: IngressWatcherStatus = {
  is_running: true,
  watched_paths: ['/data/ingress', '/data/series'],
  pending_count: 0,
  queue_count: 0,
  processed_event_count: 0,
};

describe('IngressStatusSummary', () => {
  it('shows watcher state and how many paths it is watching', () => {
    render(<IngressStatusSummary watcher={watcher} queueStatus={null} health={null} />);

    expect(screen.getByText('Watcher')).toBeInTheDocument();
    expect(screen.getByText('Running')).toBeInTheDocument();
    expect(screen.getByText('Watching 2 path(s)')).toBeInTheDocument();
  });

  it('shows a stopped watcher when the status has not loaded yet', () => {
    render(<IngressStatusSummary watcher={null} queueStatus={null} health={null} />);

    expect(screen.getByText('Stopped')).toBeInTheDocument();
    expect(screen.getByText('Watching 0 path(s)')).toBeInTheDocument();
  });

  it('renders one chip per non-zero queue status', () => {
    const queueStatus: IngressQueueStatus = {
      total: 5,
      counts: { needs_review: 3, completed: 2, failed: 0 },
      recent: [],
    };

    render(<IngressStatusSummary watcher={watcher} queueStatus={queueStatus} health={null} />);

    expect(screen.getByText('needs_review: 3')).toBeInTheDocument();
    expect(screen.getByText('completed: 2')).toBeInTheDocument();
    expect(screen.queryByText('failed: 0')).not.toBeInTheDocument();
  });

  it('says the queue is empty instead of rendering chips', () => {
    render(
      <IngressStatusSummary
        watcher={watcher}
        queueStatus={{ total: 0, counts: {}, recent: [] }}
        health={null}
      />
    );

    expect(screen.getByText('Empty')).toBeInTheDocument();
  });

  it('lists every configured ingress path with its accessibility', () => {
    render(
      <IngressStatusSummary
        watcher={watcher}
        queueStatus={null}
        health={{
          ingress_paths: [
            { path: '/data/ingress', exists: true, readable: true },
            { path: '/mnt/missing', exists: false, readable: false },
          ],
        }}
      />
    );

    expect(screen.getByText('OK')).toBeInTheDocument();
    expect(screen.getByText('Missing')).toBeInTheDocument();
    expect(screen.getByText('/data/ingress')).toBeInTheDocument();
    expect(screen.getByText('/mnt/missing')).toBeInTheDocument();
  });

  it('says health has not loaded when the health call has not returned', () => {
    render(<IngressStatusSummary watcher={watcher} queueStatus={null} health={{}} />);

    expect(screen.getByText('Health not loaded')).toBeInTheDocument();
  });
});
