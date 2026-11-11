import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getSummary = vi.hoisted(() => vi.fn());
vi.mock('@/service/attention/AttentionService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/attention/AttentionService')>();
  return { ...actual, default: { ...actual.default, getSummary } };
});

import useAttentionSummary, { ATTENTION_POLL_MS, resetAttentionSummaryStore } from '@/hooks/attention/useAttentionSummary';
import { ApiError } from '@/service/api/apiClient';
import { attentionSummary } from '../utils/attentionFixtures';

function Probe({ id }: { id: string }) {
  const { total, unsupported, status } = useAttentionSummary();
  return <p data-testid={id}>{`${status}:${total}:${unsupported}`}</p>;
}

let visibility: DocumentVisibilityState = 'visible';

describe('useAttentionSummary (shared store)', () => {
  beforeEach(() => {
    resetAttentionSummaryStore();
    visibility = 'visible';
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
    getSummary.mockReset().mockResolvedValue(attentionSummary({ needs_rename: 4, needs_review: 2 }));
  });

  afterEach(() => {
    vi.useRealTimers();
    resetAttentionSummaryStore();
  });

  it('serves every component from one request', async () => {
    render(<><Probe id="a" /><Probe id="b" /><Probe id="c" /></>);
    await waitFor(() => expect(screen.getByTestId('a')).toHaveTextContent('ready:6:false'));
    expect(screen.getByTestId('c')).toHaveTextContent('ready:6:false');
    expect(getSummary).toHaveBeenCalledTimes(1);
  });

  it('polls every 60 s while visible and pauses while the tab is hidden', async () => {
    vi.useFakeTimers();
    render(<Probe id="a" />);
    await act(async () => { await Promise.resolve(); });
    expect(getSummary).toHaveBeenCalledTimes(1);

    await act(async () => { vi.advanceTimersByTime(ATTENTION_POLL_MS); await Promise.resolve(); });
    expect(getSummary).toHaveBeenCalledTimes(2);

    visibility = 'hidden';
    await act(async () => { vi.advanceTimersByTime(ATTENTION_POLL_MS * 3); await Promise.resolve(); });
    expect(getSummary).toHaveBeenCalledTimes(2);

    // Coming back after the interval refreshes right away.
    visibility = 'visible';
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); await Promise.resolve(); });
    expect(getSummary).toHaveBeenCalledTimes(3);
  });

  it('stops polling when the last component unmounts', async () => {
    vi.useFakeTimers();
    const { unmount } = render(<Probe id="a" />);
    await act(async () => { await Promise.resolve(); });
    unmount();
    await act(async () => { vi.advanceTimersByTime(ATTENTION_POLL_MS * 2); await Promise.resolve(); });
    expect(getSummary).toHaveBeenCalledTimes(1);
  });

  it('reports an older server (404) as unsupported with no badge, and stops asking', async () => {
    vi.useFakeTimers();
    getSummary.mockRejectedValue(new ApiError(404, 'Not Found'));
    render(<Probe id="a" />);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(screen.getByTestId('a')).toHaveTextContent('unsupported:0:true');
    await act(async () => { vi.advanceTimersByTime(ATTENTION_POLL_MS * 2); await Promise.resolve(); });
    expect(getSummary).toHaveBeenCalledTimes(1);
  });

  it('keeps the last good summary when a later poll fails', async () => {
    vi.useFakeTimers();
    render(<Probe id="a" />);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    getSummary.mockRejectedValueOnce(new Error('boom'));
    await act(async () => { vi.advanceTimersByTime(ATTENTION_POLL_MS); await Promise.resolve(); await Promise.resolve(); });
    expect(screen.getByTestId('a')).toHaveTextContent('ready:6:false');
  });
});
