import { describe, expect, it, vi } from 'vitest';
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';

import IngressManualAssignDialog from '@/app/admin/_components/ingress/IngressManualAssignDialog';
import type { IngressQueueItem } from '@/service/ingress/IngressAutomationService';
import type { SearchResult } from '@/service/library/MediaAssignmentSearchService';

const target: IngressQueueItem = {
  id: 'ep-1',
  file_path: '/ingest/show.s01e02.mkv',
  file_name: 'show.s01e02.mkv',
  status: 'needs_review',
  attempts: 0,
  queued_at: 0,
  parsed_info: { media_type: 'episode', season: 1, episode: 2 },
};

const result: SearchResult = {
  id: 'tt0903747',
  title: 'Breaking Bad',
  year: '2008',
  type: 'series',
  poster: '',
  imdbId: 'tt0903747',
  source: 'omdb',
  data: {},
};

const otherResult: SearchResult = { ...result, id: 'tt1111111', title: 'The Wire', year: '2002' };

const renderDialog = (overrides: Record<string, unknown> = {}) => {
  const props = {
    open: true,
    assigning: false,
    assignSearching: false,
    assignTargetCount: 1,
    assignMediaType: 'movie' as const,
    onAssignMediaTypeChange: vi.fn(),
    assignSearchMode: 'title' as const,
    onAssignSearchModeChange: vi.fn(),
    assignSearchSource: 'omdb' as const,
    onAssignSearchSourceChange: vi.fn(),
    assignSearchQuery: 'breaking',
    onAssignSearchQueryChange: vi.fn(),
    assignImdbQuery: '',
    onAssignImdbQueryChange: vi.fn(),
    assignSearchResults: [result] as SearchResult[],
    visibleAssignSearchResults: [result] as SearchResult[],
    selectedAssignResult: null as SearchResult | null,
    onSelectAssignResult: vi.fn(),
    assignTargets: [target] as IngressQueueItem[],
    episodeMapByItemId: { 'ep-1': { season: 1, episode: 2, unknown: false } },
    onEpisodeMappingChange: vi.fn(),
    organizeAfterAssign: true,
    onOrganizeAfterAssignChange: vi.fn(),
    onSearch: vi.fn(),
    onImdbSearch: vi.fn(),
    onResultsScroll: vi.fn(),
    onClose: vi.fn(),
    onAssign: vi.fn(),
    ...overrides,
  };

  render(<IngressManualAssignDialog {...(props as never)} />);

  return props;
};

describe('IngressManualAssignDialog', () => {
  it('states how many queue items the assignment will cover', () => {
    renderDialog({ assignTargetCount: 3 });

    expect(screen.getByText('Manual Assignment')).toBeInTheDocument();
    expect(screen.getByText(/Assigning 3 queue items\./)).toBeInTheDocument();
  });

  it('uses the singular wording for a single queue item', () => {
    renderDialog({ assignTargetCount: 1 });

    expect(screen.getByText(/Assigning 1 queue item\./)).toBeInTheDocument();
  });

  it('keeps Assign disabled until a search result is picked', () => {
    renderDialog();

    expect(screen.getByRole('button', { name: 'Assign' })).toBeDisabled();
  });

  it('assigns the picked result', () => {
    const props = renderDialog({ selectedAssignResult: result });

    const assign = screen.getByRole('button', { name: 'Assign' });
    expect(assign).toBeEnabled();

    fireEvent.click(assign);
    expect(props.onAssign).toHaveBeenCalled();
  });

  it('shows the IMDb lookup field when searching by id', () => {
    const props = renderDialog({ assignSearchMode: 'imdb_id' });

    expect(screen.getByLabelText('IMDb ID')).toBeInTheDocument();
    expect(screen.queryByLabelText(/search movie/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Lookup' })).toBeDisabled();

    fireEvent.change(screen.getByLabelText('IMDb ID'), { target: { value: 'tt0903747' } });
    expect(props.onAssignImdbQueryChange).toHaveBeenCalledWith('tt0903747');

    fireEvent.keyDown(screen.getByLabelText('IMDb ID'), { key: 'Enter' });
    expect(props.onImdbSearch).toHaveBeenCalled();
  });

  it('searches by title from the selected source', () => {
    const props = renderDialog({ assignSearchQuery: '' });

    expect(screen.getByLabelText(/search movie/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Search' })).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/search movie/i), { target: { value: 'breaking' } });
    expect(props.onAssignSearchQueryChange).toHaveBeenCalledWith('breaking');

    fireEvent.keyDown(screen.getByLabelText(/search movie/i), { key: 'Enter' });
    expect(props.onSearch).toHaveBeenCalled();
  });

  it('hides the episode mapping rows for a movie assignment', () => {
    renderDialog({ assignMediaType: 'movie' });

    expect(screen.queryByText('Episode Mapping')).not.toBeInTheDocument();
  });

  it('shows editable season and episode fields for an episode assignment', () => {
    const props = renderDialog({ assignMediaType: 'episode' });

    expect(screen.getByText('Episode Mapping')).toBeInTheDocument();
    expect(screen.getByText('show.s01e02.mkv')).toBeInTheDocument();
    expect(screen.getByLabelText('Season')).toHaveValue(1);
    expect(screen.getByLabelText('Episode')).toHaveValue(2);
    expect(screen.getByRole('checkbox', { name: 'Unknown' })).not.toBeChecked();

    fireEvent.change(screen.getByLabelText('Season'), { target: { value: '3' } });

    expect(props.onEpisodeMappingChange).toHaveBeenCalledWith('ep-1', { season: 3, episode: 2, unknown: false });
  });

  it('locks the season and episode fields when the row is marked Unknown', () => {
    const props = renderDialog({
      assignMediaType: 'episode',
      episodeMapByItemId: { 'ep-1': { season: undefined, episode: undefined, unknown: true } },
    });

    expect(screen.getByRole('checkbox', { name: 'Unknown' })).toBeChecked();
    expect(screen.getByLabelText('Season')).toBeDisabled();
    expect(screen.getByLabelText('Episode')).toBeDisabled();

    fireEvent.click(screen.getByRole('checkbox', { name: 'Unknown' }));

    expect(props.onEpisodeMappingChange).toHaveBeenCalledWith('ep-1', {
      season: undefined,
      episode: undefined,
      unknown: false,
    });
  });

  it('keeps the paging hint visible while more results exist than are rendered', () => {
    renderDialog({
      assignSearchResults: [result, otherResult],
      visibleAssignSearchResults: [result],
    });

    expect(screen.getByText(/Showing 1 of 2 results/)).toBeInTheDocument();
  });

  it('lets the operator defer organizing the files', () => {
    const props = renderDialog();

    const organize = screen.getByRole('checkbox', { name: 'Organize files immediately' });
    expect(organize).toBeChecked();

    fireEvent.click(organize);
    expect(props.onOrganizeAfterAssignChange).toHaveBeenCalledWith(false);
  });

  it('locks the dialog while the assignment request is running', () => {
    renderDialog({ assigning: true, selectedAssignResult: result });

    expect(screen.getByRole('button', { name: 'Assigning…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
  });

  it('closes through the cancel button', () => {
    const props = renderDialog();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(props.onClose).toHaveBeenCalled();
  });
});
