/**
 * Issue #36: what the grouped triage screen shows about the Jev ingest classifier.
 *
 * The classifier answers a whole folder at parse time and stores each answer at
 * `parsed_info["ai_classification"]`; the server rolls those answers up per group. These tests pin what a
 * reviewer sees from that: the answer and its confidence on the file, the counts on the folder, an explicit
 * "no answer" when Jev is off, and — the part that moves files — accepting a folder at a confidence floor,
 * which has to reach `/queue/bulk` as `min_confidence` and come back saying which rows it declined.
 *
 * The component never computes a status from an answer; the backend does, so these assertions stay on text
 * and on the one request body.
 */
/** @vitest-environment jsdom */
import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import IngressTriageGroups from '@/app/admin/_components/IngressTriageGroups';
import type { IngressQueueGroupsResult } from '@/service/ingress/IngressAutomationService';

const { getQueueGroups, bulkQueueAction, updateClassification, classifyQueueItemWithAI } = vi.hoisted(() => ({
  getQueueGroups: vi.fn(),
  bulkQueueAction: vi.fn(),
  updateClassification: vi.fn(),
  classifyQueueItemWithAI: vi.fn(),
}));

vi.mock('@/service/ingress/IngressAutomationService', () => ({
  default: { getQueueGroups, bulkQueueAction, updateClassification, classifyQueueItemWithAI },
}));

const duneKey = { media_type: 'movie', ingress_path: '/movies/incoming', title: 'Dune (2021)', source_folder: 'Dune (2021)' };

const makeItem = (overrides = {}) => ({
  id: 'item-1',
  file_path: '/movies/incoming/Dune.2021.1080p.mkv',
  file_name: 'Dune.2021.1080p.mkv',
  source_folder: '/movies/incoming',
  status: 'needs_review',
  error_message: null,
  created_at: 1_700_000_000,
  updated_at: 1_700_000_000,
  processed_at: null,
  parsed_info: null,
  matched_media_id: null,
  classification_override: null,
  confidence_score: null,
  ...overrides,
});

const answered = (label: string, confidence: number) => ({ ai_classification: { label, confidence, model: 'jev-decisions' } });

const makeGroup = (overrides = {}) => ({
  group_key: duneKey,
  media_type: 'movie',
  ingress_path: '/movies/incoming',
  title: 'Dune (2021)',
  source_folder: 'Dune (2021)',
  item_count: 3,
  matching_count: 3,
  status_counts: { needs_review: 3 },
  confidence_min: 0.55,
  confidence_max: 0.95,
  first_queued_at: 1_700_000_000,
  last_queued_at: 1_700_000_003,
  preview_items: [
    makeItem({ id: 'item-1', parsed_info: answered('alternate_version', 0.825) }),
    makeItem({ id: 'item-2', parsed_info: answered('main_feature', 0.95) }),
    makeItem({ id: 'item-3', parsed_info: answered('main_feature', 0.55) }),
  ],
  ...overrides,
});

const makeResult = (groups: ReturnType<typeof makeGroup>[], overrides = {}): IngressQueueGroupsResult => ({
  groups,
  total_groups: groups.length,
  total_items: groups.reduce((sum, group) => sum + group.item_count, 0),
  status_counts: { needs_review: 3 },
  ai: { mode: 'shadow', min_confidence: 0.7 },
  group_by: 'parsed_title',
  limit: 25,
  offset: 0,
  preview_size: 50,
  ...overrides,
});

const makeBulkResult = (overrides = {}) => ({
  action: 'accept',
  requested: 3,
  succeeded: 0,
  failed: 0,
  skipped: 3,
  results: [
    { item_id: 'item-3', action: 'accept', status: 'skipped', item_status: 'needs_review', error: 'Jev confidence 0.55 is under the 0.8 floor' },
  ],
  ...overrides,
});

const groupRows = () => screen.getAllByTestId(/^triage-group-/);

// MUI keeps the value on a hidden native select, so a floor is picked the way a reviewer picks it.
const pickAcceptFloor = async (label: string) => {
  fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Jev accept floor' }));
  fireEvent.click(await screen.findByRole('option', { name: label }));
};

const expandFirstGroup = async (previewRows = 3) => {
  await waitFor(() => expect(groupRows()).toHaveLength(1));
  fireEvent.click(within(groupRows()[0]).getByRole('button', { name: /^Expand/ }));
  await waitFor(() => expect(screen.getAllByTestId(/^triage-item-/)).toHaveLength(previewRows));
};

describe('triage shows the Jev answer per file (#36)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getQueueGroups.mockResolvedValue(makeResult([makeGroup()]));
    bulkQueueAction.mockResolvedValue(makeBulkResult({ succeeded: 3, skipped: 0, results: [] }));
    classifyQueueItemWithAI.mockResolvedValue({ mode: 'shadow', classifications: [{ item_id: 'item-1', label: 'alternate_version', confidence: 0.83 }, { item_id: 'item-2', label: 'main_feature', confidence: 0.95 }] });
  });

  it('AC: shows the label, the confidence and the mode on each file', async () => {
    render(<IngressTriageGroups />);
    await expandFirstGroup();

    const cell = screen.getByTestId('triage-ai-item-1');
    expect(cell.textContent).toBe('alt 83%');
    expect(cell.getAttribute('title')).toContain('Jev says alternate version at 83% by jev-decisions');
    // `shadow` must not read as if it had acted on the queue.
    expect(cell.getAttribute('title')).toContain('shadow mode: advisory only');
    expect(screen.getByTestId('triage-ai-item-2').textContent).toBe('main 95%');
  });

  it('AC: calls out a file with no answer, and says the mode that left it blank', async () => {
    const group = makeGroup({
      preview_items: [makeItem({ id: 'item-1' }), makeItem({ id: 'item-2', parsed_info: { ai_classification_failed: 'model unreachable' } })],
      item_count: 2,
      matching_count: 2,
      status_counts: { needs_review: 2 },
    });
    getQueueGroups.mockResolvedValue(makeResult([group], { ai: { mode: 'off', min_confidence: 0.7 } }));

    render(<IngressTriageGroups />);
    await expandFirstGroup(2);

    expect(screen.getByTestId('triage-ai-item-1').textContent).toBe('no AI');
    expect(screen.getByTestId('triage-ai-item-1').getAttribute('title')).toContain('AI is off');
    expect(screen.getByTestId('triage-ai-item-2').textContent).toBe('AI failed');
    expect(screen.getByTestId('triage-ai-item-2').getAttribute('title')).toContain('model unreachable');
  });

  it('AC: sums the folder up as agreements, conflicts and the weakest answer', async () => {
    const group = makeGroup({ ai_summary: { answered: 3, missing: 1, agree: 2, conflict: 1, min_confidence: 0.55 } });
    getQueueGroups.mockResolvedValue(makeResult([group]));
    render(<IngressTriageGroups />);
    await waitFor(() => expect(groupRows()).toHaveLength(1));

    expect(within(groupRows()[0]).getByText('Jev 3/4 answered · 2 agree · 1 conflict · min 55%')).toBeInTheDocument();
  });

  it('AC: says when there are no answers in the folder instead of showing empty counts', async () => {
    const group = makeGroup({ ai_summary: { answered: 0, missing: 3, agree: 0, conflict: 0, min_confidence: null } });
    getQueueGroups.mockResolvedValue(makeResult([group], { ai: { mode: 'off', min_confidence: 0.7 } }));

    render(<IngressTriageGroups />);
    await waitFor(() => expect(groupRows()).toHaveLength(1));

    expect(within(groupRows()[0]).getByText('Jev: no answers in 3 files — AI is off, so there is no answer to show')).toBeInTheDocument();
    // The toolbar states the mode, so "no answers" is never mistaken for a classifier that ran and lost.
    expect(screen.getByTestId('triage-ai-mode').textContent).toBe('Jev off · floor 70%');
  });
});

describe('triage accepts a folder at a Jev confidence floor (#36)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getQueueGroups.mockResolvedValue(makeResult([makeGroup()]));
    bulkQueueAction.mockResolvedValue(makeBulkResult());
    classifyQueueItemWithAI.mockResolvedValue({ mode: 'shadow', classifications: [{ item_id: 'item-1', label: 'alternate_version', confidence: 0.83 }, { item_id: 'item-2', label: 'main_feature', confidence: 0.95 }] });
  });

  it('AC: accepting at a chosen floor sends min_confidence in one group request', async () => {
    render(<IngressTriageGroups />);
    await waitFor(() => expect(groupRows()).toHaveLength(1));

    await pickAcceptFloor('≥ 80%');

    // The button names the floor: "accept these" and "accept these at 80%" are not the same request.
    const accept = within(groupRows()[0]).getByRole('button', { name: 'Accept 3 items ≥ 80% confidence in this group' });
    expect(accept.textContent).toBe('Accept 3 ≥ 80%');
    fireEvent.click(accept);

    await waitFor(() => expect(bulkQueueAction).toHaveBeenCalledTimes(1));
    expect(bulkQueueAction.mock.calls[0][0]).toEqual({
      action: 'accept',
      group: duneKey,
      statuses: ['needs_review'],
      min_confidence: 0.8,
    });
  });

  it('AC: leaves the floor out of the request when the reviewer did not pick one', async () => {
    render(<IngressTriageGroups />);
    await waitFor(() => expect(groupRows()).toHaveLength(1));

    fireEvent.click(within(groupRows()[0]).getByRole('button', { name: 'Accept 3 in this group' }));

    await waitFor(() => expect(bulkQueueAction).toHaveBeenCalledTimes(1));
    expect(bulkQueueAction.mock.calls[0][0]).not.toHaveProperty('min_confidence');
  });

  it('AC: reports the rows the floor declined, and the floor the server applied', async () => {
    bulkQueueAction.mockResolvedValue(makeBulkResult({
      succeeded: 2,
      skipped: 1,
      confidence_floor: 0.8,
    }));

    render(<IngressTriageGroups />);
    await waitFor(() => expect(groupRows()).toHaveLength(1));

    await pickAcceptFloor('≥ 80%');
    fireEvent.click(within(groupRows()[0]).getByRole('button', { name: 'Accept 3 items ≥ 80% confidence in this group' }));

    await waitFor(() => expect(
      screen.getByText('2 accepted in Dune (2021) · 1 skipped · Jev confidence floor 80%')
    ).toBeInTheDocument());
    // A row the floor declined was left in the queue, not failed: it gets no failure line.
    expect(screen.queryByText(/item-3: /)).not.toBeInTheDocument();
  });

  it('AC: offers only thresholds at or above the configured floor', async () => {
    getQueueGroups.mockResolvedValue(makeResult([makeGroup()], { ai: { mode: 'assist', min_confidence: 0.8 } }));

    render(<IngressTriageGroups />);
    await waitFor(() => expect(groupRows()).toHaveLength(1));

    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Jev accept floor' }));
    const offered = await screen.findAllByRole('option');
    expect(offered.map((option) => option.textContent)).toEqual(['No floor', '≥ 80%', '≥ 90%']);
    expect(screen.getByTestId('triage-ai-mode').textContent).toBe('Jev assist · floor 80%');
  });
});

describe('triage re-classifies a folder with Jev on demand (#36)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getQueueGroups.mockResolvedValue(makeResult([makeGroup()]));
    bulkQueueAction.mockResolvedValue(makeBulkResult({ succeeded: 3, skipped: 0, results: [] }));
  });

  it('AC: asks for the folder once and re-reads the queue to get the answers', async () => {
    // The queue service keys a folder's answers by item id; the count on screen follows that shape.
    classifyQueueItemWithAI.mockResolvedValue({
      mode: 'assist',
      classifications: {
        'item-1': { label: 'main_feature', confidence: 0.95 },
        'item-2': { label: 'main_feature', confidence: 0.9 },
        'item-3': { label: 'alternate_version', confidence: 0.55 },
      },
    });

    render(<IngressTriageGroups />);
    await waitFor(() => expect(groupRows()).toHaveLength(1));
    expect(getQueueGroups).toHaveBeenCalledTimes(1);

    fireEvent.click(within(groupRows()[0]).getByRole('button', { name: 'Re-classify Dune (2021) with Jev' }));

    await waitFor(() => expect(classifyQueueItemWithAI).toHaveBeenCalledTimes(1));
    // One id is enough: the classifier answers the whole folder from the file it is given.
    expect(classifyQueueItemWithAI).toHaveBeenCalledWith('item-1');
    await waitFor(() => expect(getQueueGroups).toHaveBeenCalledTimes(2));
    expect(screen.getByText('Jev answered 3 files in Dune (2021) (mode: assist)')).toBeInTheDocument();
  });

  it('AC: a backend with no classifier says so rather than guessing an answer', async () => {
    classifyQueueItemWithAI.mockRejectedValue(new Error('502 {"detail":{"code":"INGEST_AI_NOT_CONFIGURED"}}'));

    render(<IngressTriageGroups />);
    await waitFor(() => expect(groupRows()).toHaveLength(1));

    fireEvent.click(within(groupRows()[0]).getByRole('button', { name: 'Re-classify Dune (2021) with Jev' }));

    await waitFor(() => expect(
      screen.getByText('No Jev classifier on this backend — set MEDIA_LIBRARY_INGEST_AI_MODE to shadow or assist to get answers')
    ).toBeInTheDocument());
    expect(screen.getByText(/Jev did not re-classify Dune \(2021\)/)).toBeInTheDocument();
    // The rows are left alone: no answer arrived, so nothing may be accepted on one.
    expect(bulkQueueAction).not.toHaveBeenCalled();
  });
});
