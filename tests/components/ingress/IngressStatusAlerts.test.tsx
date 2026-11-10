import { describe, expect, it } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';

import IngressStatusAlerts from '@/app/admin/_components/ingress/IngressStatusAlerts';
import type {
  IngressQueueStatus,
  IngressWatcherStatus,
} from '@/service/ingress/IngressAutomationService';

const watcherStopped: IngressWatcherStatus = {
  is_running: false,
  watched_paths: ['/data/ingress'],
  pending_count: 3,
  queue_count: 3,
  processed_event_count: 0,
};

const watcherRunning: IngressWatcherStatus = { ...watcherStopped, is_running: true };

const queueStatus: IngressQueueStatus = {
  total: 3,
  counts: { pending: 2, needs_review: 1 },
  recent: [],
};

describe('IngressStatusAlerts', () => {
  it('surfaces the error and status message passed down from the status hook', () => {
    render(
      <IngressStatusAlerts
        error="Queue refresh failed"
        statusMessage="Watcher started"
        watcher={watcherRunning}
        queueStatus={null}
        health={null}
      />
    );

    expect(screen.getByText('Queue refresh failed')).toBeInTheDocument();
    expect(screen.getByText('Watcher started')).toBeInTheDocument();
  });

  it('warns when an ingress path is unreadable or the destination mount is missing', () => {
    render(
      <IngressStatusAlerts
        error={null}
        statusMessage={null}
        watcher={watcherRunning}
        queueStatus={null}
        health={{
          ingress_paths: [{ path: '/data/ingress', exists: true, readable: false }],
          destination: { exists: true },
        }}
      />
    );

    expect(screen.getByText(/one or more ingress paths are not accessible/i)).toBeInTheDocument();
    expect(screen.queryByText(/destination mount is not accessible/i)).not.toBeInTheDocument();
  });

  it('tells the operator to start the watcher when work is waiting and the watcher is stopped', () => {
    render(
      <IngressStatusAlerts
        error={null}
        statusMessage={null}
        watcher={watcherStopped}
        queueStatus={queueStatus}
        health={null}
      />
    );

    const backlogAlerts = screen
      .getAllByRole('alert')
      .filter((alert) => /watcher is stopped/i.test(alert.textContent ?? ''));

    expect(backlogAlerts).toHaveLength(1);
    expect(backlogAlerts[0]).toHaveTextContent('3 files waiting');
    expect(backlogAlerts[0]).toHaveTextContent('(1 need manual review)');
  });

  it('switches to an informational backlog summary while the watcher is running', () => {
    render(
      <IngressStatusAlerts
        error={null}
        statusMessage={null}
        watcher={watcherRunning}
        queueStatus={queueStatus}
        health={{
          ingress_paths: [{ path: '/data/ingress', exists: true, readable: true }],
          destination: { exists: true },
        }}
      />
    );

    expect(screen.getByText(/files pending processing/i)).toBeInTheDocument();
    expect(screen.getByText(/need manual review\./i)).toBeInTheDocument();
    expect(screen.queryByText(/watcher is stopped/i)).not.toBeInTheDocument();
  });

  it('keeps the auto-assignment explanation visible when the queue is empty', () => {
    render(
      <IngressStatusAlerts
        error={null}
        statusMessage={null}
        watcher={null}
        queueStatus={{ total: 0, counts: {}, recent: [] }}
        health={null}
      />
    );

    expect(screen.getByText(/high-confidence matches are auto-assigned/i)).toBeInTheDocument();
    expect(screen.queryByText(/waiting/i)).not.toBeInTheDocument();
  });
});
