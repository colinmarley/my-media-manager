import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import FilesTab from '../../src/app/dashboard/my-library/_components/detail/FilesTab';
import type { FileActionHandlers } from '../../src/app/dashboard/my-library/_components/detail/fileActionTypes';
import { flattenFileGroups } from '../../src/service/library/MediaFilesService';
import type { MediaFile, MediaFileGroups } from '../../src/types/library/MediaFile.type';

const GB = 1024 ** 3;

const file = (overrides: Partial<MediaFile>): MediaFile => ({
  id: 'f',
  fileName: 'file.mkv',
  filePath: '/lib/file.mkv',
  fileSize: null,
  detectedMediaType: null,
  assignmentStatus: null,
  targetPath: null,
  organizationStatus: null,
  createdAt: null,
  probedAt: '2026-01-01T00:00:00Z',
  ...overrides,
});

const MAIN = file({
  id: 'main',
  fileName: 'Big Movie (1995).mkv',
  relativePath: 'Movies/Big Movie (1995)/Big Movie (1995).mkv',
  role: 'main',
  fileSize: 23.44 * GB,
  container: 'matroska,webm',
  videoCodec: 'hevc',
  resolutionCategory: '4K',
  hdrFormat: 'HDR10',
  audioCodec: 'truehd',
  audioChannels: 8,
  durationMs: 8_280_000,
  discId: 'disc-1',
  disc: { id: 'disc-1', title: 'Disc One', format: 'UHD Blu-ray' },
});

const BARE = file({
  id: 'bare',
  fileName: 'Big Movie - Trailer.mp4',
  role: 'extra',
  probedAt: null,
  container: null,
  videoCodec: null,
  resolutionCategory: null,
  hdrFormat: null,
  audioCodec: null,
  audioChannels: null,
  durationMs: null,
});

const MISSING = file({ id: 'gone', fileName: 'Old Cut.mkv', role: 'version', isAvailable: false, missingSince: '2026-03-04T00:00:00Z' });
const FLAGGED = file({ id: 'flag', fileName: 'Odd.mkv', role: 'other', needsReview: true, reviewNote: 'audio drifts' });
const FAILED = file({ id: 'fail', fileName: 'Broken.mkv', role: 'other', probedAt: null, probeError: 'moov atom not found' });

const MOVIE_GROUPS: MediaFileGroups = { main: [MAIN], versions: [MISSING], extras: [BARE], other: [FLAGGED, FAILED], seasons: [] };

const SHOW_GROUPS: MediaFileGroups = {
  main: [],
  versions: [],
  extras: [],
  other: [],
  seasons: [
    {
      seasonNumber: 1,
      episodes: [
        file({ id: 'e1', fileName: 'Show - S01E01.mkv', role: 'episode', seasonNumber: 1, episodeNumber: 1 }),
        file({ id: 'e2', fileName: 'Show - S01E02.mkv', role: 'episode', seasonNumber: 1, episodeNumber: 2 }),
      ],
      extras: [],
      other: [],
    },
    { seasonNumber: 2, episodes: [file({ id: 'e3', fileName: 'Show - S02E01.mkv', role: 'episode', seasonNumber: 2, episodeNumber: 1 })], extras: [], other: [] },
  ],
};

const handlers = (overrides: Partial<FileActionHandlers> = {}): FileActionHandlers => ({
  onLink: vi.fn(),
  onUnlink: vi.fn(),
  onReassign: vi.fn(),
  onSetFlag: vi.fn(),
  onRename: vi.fn(),
  reviewUnavailable: false,
  renameUnavailable: false,
  busy: false,
  ...overrides,
});

const renderTab = (groups: MediaFileGroups, actions = handlers(), extra: Partial<React.ComponentProps<typeof FilesTab>> = {}) =>
  render(
    <FilesTab
      groups={groups}
      allFiles={flattenFileGroups(groups)}
      actions={actions}
      hasInventory
      onScan={vi.fn()}
      scanning={false}
      {...extra}
    />,
  );

const row = (name: string) => screen.getByRole('rowheader', { name: new RegExp(name.replace(/[()]/g, '\\$&')) }).closest('tr') as HTMLElement;

describe('FilesTab', () => {
  it('groups a movie into Main feature, Versions, Extras and Other tables', () => {
    renderTab(MOVIE_GROUPS);

    const tables = screen.getAllByRole('table');
    expect(tables.map((t) => t.getAttribute('aria-labelledby')).every(Boolean)).toBe(true);
    expect(screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual([
      'Main feature', 'Versions', 'Extras', 'Other',
    ]);
  });

  it('shows quality, codecs, audio layout, type, size, duration and the source disc', () => {
    renderTab(MOVIE_GROUPS);
    const main = within(row('Big Movie (1995).mkv'));

    expect(main.getByText('Movies/Big Movie (1995)/Big Movie (1995).mkv')).toBeInTheDocument();
    expect(main.getByText('Main feature')).toBeInTheDocument();
    expect(main.getByText('4K · HDR10')).toBeInTheDocument();
    expect(main.getByText('HEVC')).toBeInTheDocument();
    expect(main.getByText('TRUEHD 7.1')).toBeInTheDocument();
    expect(main.getByText('MKV')).toBeInTheDocument();
    expect(main.getByText('23.4 GB')).toBeInTheDocument();
    expect(main.getByText('2h 18m')).toBeInTheDocument();
    expect(main.getByRole('link', { name: /Source disc: Disc One/ })).toHaveAttribute('href', '/dashboard/physical-media/discs/disc-1');
    expect(main.getByText('OK')).toBeInTheDocument();
  });

  it('renders dashes and "Not probed" for a file with every technical field null', () => {
    renderTab(MOVIE_GROUPS);
    const bare = within(row('Big Movie - Trailer.mp4'));

    expect(bare.getAllByLabelText('Unknown').length).toBeGreaterThanOrEqual(3);
    expect(bare.getByText('.mp4')).toBeInTheDocument();
    expect(bare.getByText('Not probed')).toBeInTheDocument();
    expect(bare.getByRole('button', { name: /Link Big Movie - Trailer.mp4 to a disc or tape/ })).toBeInTheDocument();
  });

  it('dims missing files and labels missing, flagged and probe-failed states', () => {
    renderTab(MOVIE_GROUPS);

    const missing = row('Old Cut.mkv');
    expect(missing).toHaveAttribute('data-missing', 'true');
    expect(within(missing).getByText(/^Missing since /)).toBeInTheDocument();
    expect(row('Big Movie (1995).mkv')).not.toHaveAttribute('data-missing');

    expect(within(row('Odd.mkv')).getByText('Flagged for second look')).toBeInTheDocument();
    expect(within(row('Broken.mkv')).getByText('Probe failed')).toBeInTheDocument();
  });

  it('collapses seasons and keeps episodes in order', () => {
    renderTab(SHOW_GROUPS);

    const season1 = screen.getByRole('button', { name: /Season 1/ });
    expect(season1).toHaveAttribute('aria-expanded', 'true');
    const rows = screen.getAllByRole('rowheader').map((cell) => cell.textContent ?? '');
    expect(rows[0]).toMatch(/^Show - S01E01\.mkv/);
    expect(rows[1]).toMatch(/^Show - S01E02\.mkv/);
    expect(rows[2]).toMatch(/^Show - S02E01\.mkv/);
    expect(within(row('Show - S01E02.mkv')).getByText('S01E02')).toBeInTheDocument();

    fireEvent.click(season1);
    expect(season1).toHaveAttribute('aria-expanded', 'false');
  });

  it('bulk-selects rows and hands the selection to the bulk actions', () => {
    const actions = handlers();
    renderTab(MOVIE_GROUPS, actions);

    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Big Movie (1995).mkv' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select all files in Other' }));

    const toolbar = screen.getByRole('toolbar', { name: 'Bulk actions for selected files' });
    expect(within(toolbar).getByText('3 selected')).toBeInTheDocument();

    fireEvent.click(within(toolbar).getByRole('button', { name: 'Link to disc/tape…' }));
    expect((actions.onLink as ReturnType<typeof vi.fn>).mock.calls[0][0].map((f: MediaFile) => f.id)).toEqual(['main', 'flag', 'fail']);

    fireEvent.click(within(toolbar).getByRole('button', { name: 'Unlink' }));
    expect((actions.onUnlink as ReturnType<typeof vi.fn>).mock.calls[0][0].map((f: MediaFile) => f.id)).toEqual(['main']);

    fireEvent.click(within(toolbar).getByRole('button', { name: 'Flag for second look' }));
    expect(actions.onSetFlag).toHaveBeenCalledWith(expect.any(Array), true);

    fireEvent.click(within(toolbar).getByRole('button', { name: 'Clear selection' }));
    expect(screen.queryByRole('toolbar')).not.toBeInTheDocument();
  });

  it('offers the row actions from a keyboard-reachable menu, disabling unavailable ones', () => {
    const actions = handlers({ reviewUnavailable: true, onAssignEpisode: vi.fn() });
    renderTab(MOVIE_GROUPS, actions);

    const menuButton = screen.getByRole('button', { name: 'Actions for Big Movie (1995).mkv' });
    expect(menuButton.tagName).toBe('BUTTON');
    fireEvent.click(menuButton);

    const menu = screen.getByRole('menu');
    expect(within(menu).getByRole('menuitem', { name: /Flag for second look/ })).toHaveAttribute('aria-disabled', 'true');
    expect(within(menu).getByText('Not available on this server yet')).toBeInTheDocument();

    fireEvent.click(within(menu).getByRole('menuitem', { name: /Unlink from disc/ }));
    expect(actions.onUnlink).toHaveBeenCalledWith([MAIN]);

    fireEvent.click(menuButton);
    fireEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: /Assign episode/ }));
    expect(actions.onAssignEpisode).toHaveBeenCalledWith(MAIN);
  });

  it('explains an empty inventory, offers a scan and shows the folder fallback', () => {
    const onScan = vi.fn();
    renderTab({ main: [], versions: [], extras: [], other: [], seasons: [] }, handlers(), {
      onScan,
      folderFallback: <p>Folder listing</p>,
    });

    expect(screen.getByText('No files recorded for this title yet')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Scan library now' }));
    expect(onScan).toHaveBeenCalled();
    expect(screen.getByText('Folder listing')).toBeInTheDocument();
  });
});
