/**
 * AC1/AC2 of #35 at the HTTP boundary (#35 test probe).
 *
 * The shipped suites mock `IngressAutomationService`, so they prove the view asks the service for a
 * page of groups but not what leaves the browser. AC1's second clause — "no call fetches the entire
 * queue" — only holds at the wire: a view that paged correctly could still warm itself with an
 * unbounded `GET /queue/items`, and AC2's "one bulk request" could still degrade to one POST per row.
 * These probes stub `fetch` instead of the service, so they read the URLs and bodies that actually go
 * out. They are written against the acceptance criteria, not against the implementation.
 */
/** @vitest-environment jsdom */
import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { IngressTriageGroups } from '@/app/admin/_components/IngressTriageGroups';
import { GROUP_PREVIEW_SIZE, GROUP_ROWS_PER_PAGE_OPTIONS } from '@/service/ingress/ingressTriageGroupsModel';

const BASE = '/api/backend/api/ingress';

interface Recorded {
  url: URL;
  method: string;
  body?: any;
}

function item(id: string, status = 'needs_review') {
  return { id, file_path: `/ark/ingest/disc1/${id}.mkv`, file_name: `${id}.mkv`, status, attempts: 1, queued_at: 1777000000 };
}

function group(title: string, statusCounts: Record<string, number>, previews: any[] = []) {
  const itemCount = Object.values(statusCounts).reduce((sum, count) => sum + count, 0);
  return {
    group_key: { media_type: 'movie', ingress_path: '/ark/ingest', source_folder: `/ark/ingest/${title}` },
    media_type: 'movie',
    ingress_path: '/ark/ingest',
    title,
    source_folder: `/ark/ingest/${title}`,
    item_count: itemCount,
    matching_count: itemCount,
    status_counts: statusCounts,
    confidence_min: 61,
    confidence_max: 93,
    first_queued_at: new Date(Date.now() - 3 * 86400000).toISOString(),
    last_queued_at: new Date().toISOString(),
    preview_items: previews,
  };
}

/** A backend that answers: 40 groups exist, this page carries `limit` of them. */
function groupsPayload(request: URL) {
  const limit = Number(request.searchParams.get('limit') ?? 0);
  const offset = Number(request.searchParams.get('offset') ?? 0);
  const groups = Array.from({ length: Math.min(limit, 40 - offset) }, (_, index) =>
    group(`Movie ${offset + index}`, { needs_review: 4 }, [item(`p${offset + index}-1`), item(`p${offset + index}-2`)])
  );
  return {
    groups,
    total_groups: 40,
    total_items: 160,
    status_counts: { needs_review: 160 },
    group_by: 'source_folder',
    limit,
    offset,
    preview_size: Number(request.searchParams.get('previewSize') ?? 0),
  };
}

const bulkPayload = {
  batch_id: 'batch-http-1',
  action: 'accept',
  requested: 4,
  succeeded: 4,
  failed: 0,
  skipped: 0,
  group_truncated: false,
  group_limit: 1000,
  results: Array.from({ length: 4 }, (_, index) => ({
    item_id: `bulk-${index}`,
    action: 'accept',
    status: 'succeeded',
    item_status: 'auto_assigned',
  })),
};

function stubFetch() {
  const calls: Recorded[] = [];
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const parsed = new URL(String(url), 'http://localhost');
    calls.push({
      url: parsed,
      method: (init?.method ?? 'GET').toUpperCase(),
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    const path = parsed.pathname;
    const data = path.endsWith('/queue/groups')
      ? groupsPayload(parsed)
      : path.endsWith('/queue/bulk')
        ? bulkPayload
        : {};
    return { ok: true, status: 200, json: async () => data, text: async () => JSON.stringify(data) };
  });
  vi.stubGlobal('fetch', fetchMock);
  return calls;
}

const queueReads = (calls: Recorded[]) => calls.filter((call) => call.url.pathname.startsWith(`${BASE}/queue`));
const groupReads = (calls: Recorded[]) => calls.filter((call) => call.url.pathname.endsWith('/queue/groups'));
const wholeQueueReads = (calls: Recorded[]) => calls.filter((call) => call.url.pathname.endsWith('/queue/items'));

describe('IngressTriageGroups HTTP probes', () => {
  beforeEach(() => {
    Object.defineProperty(HTMLDivElement.prototype, 'clientHeight', { configurable: true, get: () => 800 });
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as any;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // AC1: the grouped view reads one server-paged collection, and every read it makes is bounded.
  it('AC1: reads only /queue/groups, always with a bounded limit, and never the whole queue', async () => {
    const calls = stubFetch();

    render(<IngressTriageGroups />);
    await waitFor(() => expect(screen.getAllByTestId(/^triage-group-/).length).toBeGreaterThan(0));

    expect(groupReads(calls)).toHaveLength(1);
    expect(queueReads(calls).every((call) => call.url.pathname.endsWith('/queue/groups'))).toBe(true);

    const params = groupReads(calls)[0].url.searchParams;
    expect(GROUP_ROWS_PER_PAGE_OPTIONS).toContain(Number(params.get('limit')));
    expect(Number(params.get('offset'))).toBe(0);
    expect(Number(params.get('previewSize'))).toBeGreaterThan(0);
    expect(Number(params.get('previewSize'))).toBeLessThanOrEqual(GROUP_PREVIEW_SIZE);

    // Paging is a new bounded read, not a growing one: AC1 rules out "fetch it all and slice locally".
    fireEvent.click(screen.getByLabelText('Go to next page'));
    await waitFor(() => expect(groupReads(calls)).toHaveLength(2));

    const second = groupReads(calls)[1].url.searchParams;
    expect(GROUP_ROWS_PER_PAGE_OPTIONS).toContain(Number(second.get('limit')));
    expect(Number(second.get('offset'))).toBe(Number(second.get('limit')));
    expect(wholeQueueReads(calls)).toHaveLength(0);
  });

  // AC2: a whole folder is one request whatever its size, and the answer drives the row.
  it('AC2: accepting a group posts one group-scoped bulk request and re-keys from its reply without reloading', async () => {
    const calls = stubFetch();

    render(<IngressTriageGroups />);
    await waitFor(() => expect(screen.getAllByTestId(/^triage-group-/).length).toBeGreaterThan(0));
    const row = screen.getAllByTestId(/^triage-group-/)[0];
    expect(row.textContent).toContain('4 needs review');

    fireEvent.click(within(row).getByRole('button', { name: /^Accept/ }));
    await waitFor(() => expect(calls.filter((call) => call.url.pathname.endsWith('/queue/bulk'))).toHaveLength(1));

    const post = calls.find((call) => call.url.pathname.endsWith('/queue/bulk'))!;
    expect(post.url.pathname).toBe(`${BASE}/queue/bulk`);
    expect(post.body.action).toBe('accept');
    expect(post.body.itemIds).toBeUndefined();
    expect(post.body.group).toMatchObject({ ingress_path: '/ark/ingest', source_folder: '/ark/ingest/Movie 0' });

    await waitFor(() => expect(within(row).getByText('4 auto assigned')).toBeTruthy());
    // The row followed the reply: no page read was issued behind it.
    expect(groupReads(calls)).toHaveLength(1);
  });
});
