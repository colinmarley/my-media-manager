/**
 * Content verification on the triage screen: what reading the file itself said about the proposed match.
 *
 * The backend stores the result at `parsed_info["content_verification"]`; triage shows it as a chip with
 * the evidence in its title, hides a result that judged an older match, and offers a per-file check that
 * posts one item id. The check is advisory: no test here expects a status or a match to move.
 */
/** @vitest-environment jsdom */
import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import IngressTriageGroups from '@/app/admin/_components/IngressTriageGroups';
import type { IngressQueueGroupsResult, IngressQueueItem } from '@/service/ingress/IngressAutomationService';
import { describeContentVerifyError, getItemContentCheck } from '@/service/ingress/ingressTriageGroupsModel';

const { getQueueGroups, verifyQueueItemContent } = vi.hoisted(() => ({
  getQueueGroups: vi.fn(),
  verifyQueueItemContent: vi.fn(),
}));

vi.mock('@/service/ingress/IngressAutomationService', () => ({
  default: { getQueueGroups, verifyQueueItemContent },
}));

const archer = { title: 'Archer', media_type: 'episode', season: 1, episode: 2 };
const archerClaim = { title: 'Archer', year: null, media_type: 'episode', season: 1, episode: 2 };

const makeItem = (overrides = {}) =>
  ({
    id: 'item-1',
    file_path: '/tv/incoming/ARCHER_S1D1/title_t01.mkv',
    file_name: 'title_t01.mkv',
    status: 'needs_review',
    parsed_info: null,
    best_match: archer,
    classification_override: null,
    confidence_score: 60,
    ...overrides,
  }) as unknown as IngressQueueItem;

const veto = {
  verdict: 'veto',
  claim: archerClaim,
  suggested: { season: 1, episode: 1, episode_title: 'Mole Hunt' },
  evidence: ['Title on screen: "ARCHER"', 'The dialogue (subtitles) fits episode 1, "Mole Hunt" at 88%'],
};

const makeResult = (items: IngressQueueItem[]): IngressQueueGroupsResult =>
  ({
    groups: [
      {
        group_key: { media_type: 'episode', ingress_path: '/tv/incoming', title: 'Archer', source_folder: 'ARCHER_S1D1' },
        media_type: 'episode',
        ingress_path: '/tv/incoming',
        title: 'Archer',
        source_folder: 'ARCHER_S1D1',
        item_count: items.length,
        matching_count: items.length,
        status_counts: { needs_review: items.length },
        confidence_min: 0.6,
        confidence_max: 0.6,
        first_queued_at: 1_700_000_000,
        last_queued_at: 1_700_000_003,
        preview_items: items,
      },
    ],
    total_groups: 1,
    total_items: items.length,
    status_counts: { needs_review: items.length },
    ai: { mode: 'off', min_confidence: 0.7 },
    group_by: 'source_folder',
    limit: 25,
    offset: 0,
    preview_size: 50,
  }) as unknown as IngressQueueGroupsResult;

const expandGroup = async (rows: number) => {
  await waitFor(() => expect(screen.getAllByTestId(/^triage-group-/)).toHaveLength(1));
  fireEvent.click(within(screen.getAllByTestId(/^triage-group-/)[0]).getByRole('button', { name: /^Expand/ }));
  await waitFor(() => expect(screen.getAllByTestId(/^triage-item-/)).toHaveLength(rows));
};

describe('getItemContentCheck', () => {
  it('reads a veto with the episode it points at and the evidence behind it', () => {
    const check = getItemContentCheck(makeItem({ parsed_info: { content_verification: veto } }));
    expect(check?.text).toBe('content ✗ E01');
    expect(check?.color).toBe('error');
    expect(check?.detail.split('\n')).toEqual([
      'The file looks like episode 1, "Mole Hunt", not this match.',
      'Title on screen: "ARCHER"',
      'The dialogue (subtitles) fits episode 1, "Mole Hunt" at 88%',
      'Advisory only: nothing was changed. Click to check again.',
    ]);
  });

  it('labels each verdict without overclaiming', () => {
    const label = (verification: object, item = {}) =>
      getItemContentCheck(makeItem({ parsed_info: { content_verification: verification }, ...item }))?.text;
    expect(label({ verdict: 'confirm', claim: archerClaim })).toBe('content ✓');
    // The series is right, but nothing said which episode: that must not read as a full confirmation.
    expect(label({ verdict: 'partial', claim: archerClaim })).toBe('title ✓');
    expect(label({ verdict: 'no_evidence', claim: archerClaim })).toBe('content ?');
    expect(
      label({ verdict: 'suggest', claim: null, suggested: { title: 'Heat', year: 1995 } }, { best_match: undefined })
    ).toBe('looks like Heat');
  });

  it('hides a result that judged a match the item no longer has', () => {
    const stored = { parsed_info: { content_verification: veto } };
    expect(getItemContentCheck(makeItem({ ...stored, best_match: { ...archer, episode: 1 } }))).toBeNull();
    expect(getItemContentCheck(makeItem({ ...stored, best_match: { ...archer, title: 'Archer (2009)' } }))).toBeNull();
    // A result for an unmatched file is stale once the file has a match.
    const unmatched = { parsed_info: { content_verification: { verdict: 'no_evidence', claim: null } } };
    expect(getItemContentCheck(makeItem(unmatched))).toBeNull();
    expect(getItemContentCheck(makeItem({ parsed_info: {} }))).toBeNull();
  });

  it('explains a refused check in plain words', () => {
    expect(describeContentVerifyError(new Error('{"detail":{"code":"CONTENT_VERIFY_FAILED"}}'))).toContain('could not be checked');
    expect(describeContentVerifyError(new Error('boom'))).toBe('boom');
  });
});

describe('triage content check', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows the stored verdict on the file with its evidence', async () => {
    getQueueGroups.mockResolvedValue(makeResult([makeItem({ parsed_info: { content_verification: veto } }), makeItem({ id: 'item-2', file_name: 'title_t02.mkv' })]));
    render(<IngressTriageGroups />);
    await expandGroup(2);

    const chip = screen.getByTestId('triage-content-item-1');
    expect(chip.textContent).toBe('content ✗ E01');
    expect(chip.getAttribute('title')).toContain('fits episode 1, "Mole Hunt" at 88%');
    expect(screen.queryByTestId('triage-content-item-2')).toBeNull();
    expect(screen.getByRole('button', { name: 'Check the content of title_t02.mkv against its match' })).toBeTruthy();
  });

  it('checks one file on request and re-reads the list for the stored result', async () => {
    getQueueGroups
      .mockResolvedValueOnce(makeResult([makeItem()]))
      .mockResolvedValue(makeResult([makeItem({ parsed_info: { content_verification: { verdict: 'confirm', claim: archerClaim } } })]));
    verifyQueueItemContent.mockResolvedValue({ verdict: 'confirm' });
    render(<IngressTriageGroups />);
    await expandGroup(1);

    fireEvent.click(screen.getByRole('button', { name: 'Check the content of title_t01.mkv against its match' }));

    await waitFor(() => expect(screen.getByTestId('triage-content-item-1').textContent).toBe('content ✓'));
    expect(verifyQueueItemContent).toHaveBeenCalledTimes(1);
    expect(verifyQueueItemContent).toHaveBeenCalledWith('item-1');
  });

  it('reports a check that could not run and leaves the row as it was', async () => {
    getQueueGroups.mockResolvedValue(makeResult([makeItem()]));
    verifyQueueItemContent.mockRejectedValue(new Error('{"detail":{"code":"CONTENT_VERIFY_FAILED"}}'));
    render(<IngressTriageGroups />);
    await expandGroup(1);

    fireEvent.click(screen.getByRole('button', { name: 'Check the content of title_t01.mkv against its match' }));

    await waitFor(() => expect(screen.getByText('Content check did not finish for title_t01.mkv')).toBeTruthy());
    expect(screen.getByText(/could not be checked/)).toBeTruthy();
    expect(screen.queryByTestId('triage-content-item-1')).toBeNull();
  });
});
