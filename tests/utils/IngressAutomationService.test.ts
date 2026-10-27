/**
 * Request budgets of the ingress service (#35 review). A group-scoped batch walks every row of a
 * folder through the same organize/record path a single accept takes, so it cannot share the budget a
 * read gets: when the client gave up at 15s the batch was usually still applying server-side, and the
 * grouped view treated that as "nothing happened". A stopped request therefore has to be identifiable
 * as "outcome unknown" (`IngressTimeoutError`) so callers reload instead of reverting.
 */
/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import IngressAutomationService from '@/service/ingress/IngressAutomationService';
import { INGRESS_TIMEOUT_ERROR_NAME, isIngressTimeoutError } from '@/service/ingress/ingressQueueModel';

/** Stands in for a backend that keeps working: the request only settles when its signal aborts. */
function makeHangingFetch() {
  return vi.fn(
    (_url: string, init?: RequestInit) =>
      new Promise<never>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('The operation was aborted.', 'AbortError')));
      })
  );
}

const groupKey = { media_type: 'movie' as const, ingress_path: '/movies/incoming', title: 'Dune (2021)' };

const signalOf = (fetchMock: ReturnType<typeof makeHangingFetch>, call = 0) => fetchMock.mock.calls[call]?.[1]?.signal;

describe('IngressAutomationService request budgets', () => {
  let fetchMock: ReturnType<typeof makeHangingFetch>;

  beforeEach(() => {
    // Only the timer and the clock are faked: promise plumbing stays native so advancing can settle the request.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    fetchMock = makeHangingFetch();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('outlives the 15s read budget when posting a group batch', async () => {
    const startedAt = Date.now();
    const settled = IngressAutomationService.bulkQueueAction({ action: 'accept', group: groupKey }).then(
      () => 'resolved',
      (error) => error
    );

    // A batch this long is normal for a large folder, so the read deadline must not cut it short.
    await vi.advanceTimersByTimeAsync(14_999);
    expect(signalOf(fetchMock)?.aborted).toBe(false);

    await vi.advanceTimersToNextTimerAsync();
    const waited = Date.now() - startedAt;
    const error = await settled;

    expect(waited).toBeGreaterThan(15_000);
    expect(signalOf(fetchMock)?.aborted).toBe(true);
    expect(isIngressTimeoutError(error)).toBe(true);
    expect((error as Error).name).toBe(INGRESS_TIMEOUT_ERROR_NAME);
  });

  it('keeps the short budget for reads so a dead backend still surfaces quickly', async () => {
    const startedAt = Date.now();
    const settled = IngressAutomationService.getQueueGroups({ groupBy: 'source_folder' }).then(
      () => 'resolved',
      (error) => error
    );

    await vi.advanceTimersToNextTimerAsync();
    const error = await settled;

    expect(Date.now() - startedAt).toBe(15_000);
    expect(signalOf(fetchMock)?.aborted).toBe(true);
    expect(isIngressTimeoutError(error)).toBe(true);
  });

  it('leaves an explicit refusal from the backend distinguishable from a timeout', async () => {
    vi.useRealTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 409, text: async () => 'Queue is busy' })
    );

    const error = await IngressAutomationService.bulkQueueAction({ action: 'ignore', itemIds: ['item-1'] }).catch((err) => err);

    expect((error as Error).message).toBe('Queue is busy');
    expect(isIngressTimeoutError(error)).toBe(false);
  });
});
