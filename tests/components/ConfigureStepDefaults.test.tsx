import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';

import ConfigureStep from '../../src/app/admin/disc-ripper/_components/ConfigureStep';
import type { DiscScanInfo, DiscTitle } from '../../src/types/disc-ripper/DiscRipper.type';

const findSeasonRipsMock = vi.fn();
const getMediaFilesMock = vi.fn();

vi.mock('../../src/service/tmdb/TmdbService', () => ({
  default: {
    searchTV: vi.fn().mockResolvedValue({
      results: [{ id: 2316, name: 'The Office', first_air_date: '2005-03-24', poster_path: null }],
    }),
    searchMovies: vi.fn().mockResolvedValue({ results: [] }),
    getTVSeriesDetails: vi.fn().mockResolvedValue({ seasons: [{ season_number: 1, name: 'Season 1', episode_count: 12 }] }),
    getTVSeriesExternalIds: vi.fn().mockResolvedValue({ imdb_id: 'tt0386676' }),
    getSeasonDetails: vi.fn().mockResolvedValue({
      episodes: Array.from({ length: 12 }, (_, i) => ({ id: 100 + i, episode_number: i + 1, name: `Ep ${i + 1}`, runtime: 22 })),
    }),
    getMovieDetails: vi.fn().mockResolvedValue({}),
  },
}));

vi.mock('../../src/service/catalog/DiscCatalogService', () => ({
  getDisc: vi.fn().mockResolvedValue(null),
  findSeasonRips: (...args: unknown[]) => findSeasonRipsMock(...args),
}));

vi.mock('../../src/service/library/MediaFilesService', () => ({
  getMediaFiles: (...args: unknown[]) => getMediaFilesMock(...args),
}));

vi.mock('../../src/app/admin/disc-ripper/_components/DiscCatalogLinkPanel', () => ({
  default: () => <div data-testid="link-panel" />,
}));

const title = (index: number, duration_seconds: number, file_size_bytes: number): DiscTitle => ({
  index, name: '', duration_seconds, chapter_count: 4, file_size_bytes, output_filename: `t${index}.mkv`,
  width: 720, height: 480, codec: 'Mpeg2',
});

// Five ~22 minute episodes, a 25 minute featurette the play-all leaves out,
// the play-all itself, and two different sketches of almost the same length.
const TITLES: DiscTitle[] = [
  title(0, 1320, 1_000_000_000), title(1, 1325, 1_010_000_000), title(2, 1310, 990_000_000),
  title(3, 1330, 1_020_000_000), title(4, 1318, 1_005_000_000), title(5, 1500, 1_100_000_000),
  title(6, 6603, 5_025_000_000), title(7, 132, 108_000_000), title(8, 133, 109_000_000),
];

const SCAN: DiscScanInfo = {
  scan_id: 'scan-2', scanned_at: null, fingerprint: 'b'.repeat(64), disc_type: 'DVD disc', disc_name: null,
  volume_label: 'OFFICE_S1_D2', drive_model: null, makemkv_version: null, title_count: TITLES.length,
};

async function pickTheShow() {
  fireEvent.change(screen.getByLabelText('Search TV show on TMDB'), { target: { value: 'the office' } });
  fireEvent.click(await screen.findByRole('option', { name: /The Office/ }, { timeout: 3000 }));
  await screen.findByText('12 episodes loaded');
}

const previewNames = () => {
  const heading = screen.getByText(/^Files? the ripper will deliver$/);
  return within(heading.parentElement as HTMLElement)
    .getAllByText(/\.mkv$/)
    .map((el) => el.textContent);
};

describe('ConfigureStep defaults', () => {
  beforeEach(() => {
    findSeasonRipsMock.mockReset().mockResolvedValue([]);
    getMediaFilesMock.mockReset().mockRejectedValue(new Error('404'));
  });

  it('numbers after the episodes already ripped, and names the extra as the ripper will', async () => {
    getMediaFilesMock.mockResolvedValue({
      seasons: [{ seasonNumber: 1, episodes: [1, 2, 3].map((n) => ({ episodeNumber: n })), extras: [], other: [] }],
    });
    findSeasonRipsMock.mockResolvedValue([{
      id: 'disc-1-rip', status: 'delivered', season: 1, fingerprint: 'a'.repeat(64),
      titles: [4, 5].map((n) => ({ titleIndex: n, status: 'delivered', season: 1, episode: n })),
    }]);
    render(<ConfigureStep titles={TITLES} scanId="scan-2" discInfo={SCAN} onSubmit={vi.fn()} />);
    await pickTheShow();

    expect(getMediaFilesMock).toHaveBeenCalledWith('series', 'tt0386676');
    expect(findSeasonRipsMock).toHaveBeenCalledWith({ tmdbId: 2316, imdbId: 'tt0386676', season: 1 });
    await screen.findByText(/Season 1 episodes 1–5 are already in your library/);
    expect(previewNames()).toEqual([
      'The Office S01E06 - Ep 6.mkv',
      'The Office S01E07 - Ep 7.mkv',
      'The Office S01E08 - Ep 8.mkv',
      'The Office S01E09 - Ep 9.mkv',
      'The Office S01E10 - Ep 10.mkv',
      'The Office (2005)-clip.mkv',
    ]);

    // The two sketches are not called the same, and the second can be ripped too.
    expect(screen.queryByText('Same as title 7')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('Short clip, possibly the same as title 7'));
    expect(previewNames()).toContain('The Office (2005) 2-clip.mkv');

    fireEvent.click(screen.getByRole('button', { name: 'Number from S01E01 instead' }));
    expect(previewNames().slice(0, 2)).toEqual(['The Office S01E01 - Ep 1.mkv', 'The Office S01E02 - Ep 2.mkv']);
  });

  it('numbers from the first episode when nothing is known about the season', async () => {
    render(<ConfigureStep titles={TITLES} scanId="scan-2" discInfo={SCAN} onSubmit={vi.fn()} />);
    await pickTheShow();
    expect(previewNames()[0]).toBe('The Office S01E01 - Ep 1.mkv');
    expect(previewNames()[5]).toBe('The Office (2005)-clip.mkv');
    expect(screen.queryByText(/already in your library/)).not.toBeInTheDocument();
  });

  it('keeps every long title an episode on a disc without a play-all', async () => {
    render(
      <ConfigureStep titles={TITLES.filter((t) => t.index !== 6)} scanId="scan-2" discInfo={SCAN} onSubmit={vi.fn()} />,
    );
    await pickTheShow();
    expect(previewNames()).toEqual([1, 2, 3, 4, 5, 6].map((n) => `The Office S01E0${n} - Ep ${n}.mkv`));
  });
});
