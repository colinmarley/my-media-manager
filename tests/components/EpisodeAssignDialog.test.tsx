import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ComponentProps } from 'react';

import EpisodeAssignDialog from '../../src/app/dashboard/my-library/_components/detail/EpisodeAssignDialog';
import type { SeriesEpisodeOption } from '@/service/library/mediaDetailModel';

type DialogProps = ComponentProps<typeof EpisodeAssignDialog>;

const SEASON_OPTIONS: SeriesEpisodeOption[] = [
  { seasonNumber: 1, seasonTitle: 'Season One', episodes: [{ episodeNumber: 1, title: 'Pilot' }] },
  { seasonNumber: 2, seasonTitle: 'Season Two', episodes: [{ episodeNumber: 5, title: 'Broken Record' }] },
];

const buildProps = (overrides: Partial<DialogProps> = {}): DialogProps => ({
  open: true,
  onClose: vi.fn(),
  file: { path: '/ark/media/jellyfin/Show/loose.mkv', name: 'loose.mkv' },
  season: '1',
  onSeasonChange: vi.fn(),
  onSeasonSelectChange: vi.fn(),
  episode: '1',
  onEpisodeChange: vi.fn(),
  seasonOptions: SEASON_OPTIONS,
  episodeOptions: SEASON_OPTIONS[0].episodes,
  saving: false,
  error: null,
  onAssign: vi.fn(),
  ...overrides,
});

describe('EpisodeAssignDialog', () => {
  it('does not render when closed', () => {
    render(<EpisodeAssignDialog {...buildProps({ open: false })} />);

    expect(screen.queryByText('Assign File to Episode')).not.toBeInTheDocument();
  });

  it('shows the file being assigned', () => {
    render(<EpisodeAssignDialog {...buildProps()} />);

    expect(screen.getByText('File: loose.mkv')).toBeInTheDocument();
  });

  it('uses season and episode pickers when the show has metadata', async () => {
    render(<EpisodeAssignDialog {...buildProps()} />);

    const [seasonSelect, episodeSelect] = screen.getAllByRole('combobox');
    expect(seasonSelect).toHaveTextContent('Season 01 · Season One');
    expect(episodeSelect).toHaveTextContent('E01 · Pilot');

    fireEvent.mouseDown(episodeSelect);
    expect(await screen.findByRole('option', { name: 'E01 · Pilot' })).toBeInTheDocument();
  });

  it('reports the selected season and episode changes', async () => {
    const onSeasonSelectChange = vi.fn();
    const onEpisodeChange = vi.fn();
    const episodeOptions = [...SEASON_OPTIONS[0].episodes, ...SEASON_OPTIONS[1].episodes];
    render(
      <EpisodeAssignDialog
        {...buildProps({ onSeasonSelectChange, onEpisodeChange, episodeOptions })}
      />
    );

    const [seasonSelect, episodeSelect] = screen.getAllByRole('combobox');
    fireEvent.mouseDown(seasonSelect);
    fireEvent.click(await screen.findByRole('option', { name: 'Season 02 · Season Two' }));
    expect(onSeasonSelectChange).toHaveBeenCalledWith('2');

    fireEvent.mouseDown(episodeSelect);
    fireEvent.click(await screen.findByRole('option', { name: 'E05 · Broken Record' }));
    expect(onEpisodeChange).toHaveBeenCalledWith('5');
  });

  it('falls back to manual season and episode fields without show metadata', () => {
    render(<EpisodeAssignDialog {...buildProps({ seasonOptions: [], episodeOptions: [], season: '3', episode: '7' })} />);

    expect(screen.queryAllByRole('combobox')).toHaveLength(0);
    expect(screen.getByLabelText('Season')).toHaveValue(3);
    expect(screen.getByLabelText('Episode')).toHaveValue(7);
  });

  it('forwards manual edits through the manual season handler', () => {
    const onSeasonChange = vi.fn();
    const onEpisodeChange = vi.fn();
    render(
      <EpisodeAssignDialog
        {...buildProps({ seasonOptions: [], episodeOptions: [], onSeasonChange, onEpisodeChange })}
      />
    );

    fireEvent.change(screen.getByLabelText('Season'), { target: { value: '5' } });
    fireEvent.change(screen.getByLabelText('Episode'), { target: { value: '9' } });

    expect(onSeasonChange).toHaveBeenCalledWith('5');
    expect(onEpisodeChange).toHaveBeenCalledWith('9');
  });

  it('assigns the episode or keeps the original filename', () => {
    const onAssign = vi.fn();
    render(<EpisodeAssignDialog {...buildProps({ onAssign })} />);

    fireEvent.click(screen.getByRole('button', { name: 'Assign Episode' }));
    expect(onAssign).toHaveBeenLastCalledWith(false);

    fireEvent.click(screen.getByRole('button', { name: 'Keep Filename in Unknown Folder' }));
    expect(onAssign).toHaveBeenLastCalledWith(true);

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onAssign).toHaveBeenCalledTimes(2);
  });

  it('surfaces assignment errors', () => {
    render(<EpisodeAssignDialog {...buildProps({ error: 'Episode assignment failed.' })} />);

    expect(screen.getByText('Episode assignment failed.')).toBeInTheDocument();
  });

  it('locks every action while saving', () => {
    render(<EpisodeAssignDialog {...buildProps({ saving: true })} />);

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: 'Keep Filename in Unknown Folder' })).toBeDisabled();
    expect(within(dialog).queryByRole('button', { name: 'Assign Episode' })).not.toBeInTheDocument();
    expect(within(dialog).getByRole('progressbar')).toBeInTheDocument();
  });
});
