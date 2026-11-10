import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ComponentProps } from 'react';

import MediaFolderFileList from '../../src/app/dashboard/my-library/_components/detail/MediaFolderFileList';

type SectionProps = ComponentProps<typeof MediaFolderFileList>;

const FOLDER = '/ark/media/jellyfin/Movies/Big Movie';
const VIDEO_FILE = { path: `${FOLDER}/Big Movie.mkv`, name: 'Big Movie.mkv', size: 1536 };

const buildProps = (overrides: Partial<SectionProps> = {}): SectionProps => ({
  files: [VIDEO_FILE],
  isSeries: false,
  seasonFolders: [],
  selectedSeasonPath: '',
  onSeasonChange: vi.fn(),
  folderPath: FOLDER,
  onReassignFolder: vi.fn(),
  onReassignFile: vi.fn(),
  onAssignEpisode: vi.fn(),
  ...overrides,
});

describe('MediaFolderFileList', () => {
  it('renders destination files with their formatted size', () => {
    render(<MediaFolderFileList {...buildProps()} />);

    expect(screen.getByText('Big Movie.mkv')).toBeInTheDocument();
    expect(screen.getByText('1.5 KB')).toBeInTheDocument();
  });

  it('omits the size line for zero-byte files', () => {
    render(<MediaFolderFileList {...buildProps({ files: [{ path: '/x/tt1.nfo', name: 'tt1.nfo', size: 0 }] })} />);

    expect(screen.getByText('tt1.nfo')).toBeInTheDocument();
    expect(screen.queryByText('1.5 KB')).not.toBeInTheDocument();
  });

  it('reassigns a single file from its row action', () => {
    const onReassignFile = vi.fn();
    render(<MediaFolderFileList {...buildProps({ onReassignFile })} />);

    fireEvent.click(screen.getByRole('button', { name: /^reassign$/i }));

    expect(onReassignFile).toHaveBeenCalledWith(`${FOLDER}/Big Movie.mkv`, 'Big Movie.mkv');
  });

  it('only offers episode assignment for series video files', () => {
    const { rerender } = render(<MediaFolderFileList {...buildProps({ isSeries: true })} />);
    expect(screen.getByRole('button', { name: 'Assign Episode' })).toBeInTheDocument();

    rerender(
      <MediaFolderFileList
        {...buildProps({ isSeries: true, files: [{ path: '/x/tt1.nfo', name: 'tt1.nfo', size: 12 }] })}
      />
    );
    expect(screen.queryByRole('button', { name: 'Assign Episode' })).not.toBeInTheDocument();

    rerender(<MediaFolderFileList {...buildProps({ isSeries: false })} />);
    expect(screen.queryByRole('button', { name: 'Assign Episode' })).not.toBeInTheDocument();
  });

  it('assigns the clicked file when the episode action is used', () => {
    const onAssignEpisode = vi.fn();
    render(<MediaFolderFileList {...buildProps({ isSeries: true, onAssignEpisode })} />);

    fireEvent.click(screen.getByRole('button', { name: 'Assign Episode' }));

    expect(onAssignEpisode).toHaveBeenCalledWith({ path: VIDEO_FILE.path, name: VIDEO_FILE.name });
  });

  it('renders the season picker only for series with season folders on disk', () => {
    const seasonFolders = [
      { name: 'Season 01', path: '/ark/media/jellyfin/Show/Season 01' },
      { name: 'Season 02', path: '/ark/media/jellyfin/Show/Season 02' },
    ];

    const { rerender } = render(
      <MediaFolderFileList
        {...buildProps({
          folderPath: '/ark/media/jellyfin/Show',
          isSeries: true,
          seasonFolders,
          selectedSeasonPath: seasonFolders[1].path,
        })}
      />
    );
    expect(screen.getByRole('combobox')).toHaveTextContent('Season 02');

    rerender(
      <MediaFolderFileList {...buildProps({ folderPath: '/ark/media/jellyfin/Show', isSeries: false, seasonFolders })} />
    );
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();

    rerender(
      <MediaFolderFileList {...buildProps({ folderPath: '/ark/media/jellyfin/Show', isSeries: true, seasonFolders: [] })} />
    );
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });

  it('changes the selected season and reassigns the whole folder', async () => {
    const onSeasonChange = vi.fn();
    const onReassignFolder = vi.fn();
    render(
      <MediaFolderFileList
        {...buildProps({
          folderPath: '/ark/media/jellyfin/Show',
          isSeries: true,
          seasonFolders: [
            { name: 'Season 01', path: '/ark/media/jellyfin/Show/Season 01' },
            { name: 'Season 02', path: '/ark/media/jellyfin/Show/Season 02' },
          ],
          selectedSeasonPath: '/ark/media/jellyfin/Show/Season 01',
          onSeasonChange,
          onReassignFolder,
        })}
      />
    );

    fireEvent.mouseDown(screen.getByRole('combobox'));
    fireEvent.click(await screen.findByRole('option', { name: 'Season 02' }));
    expect(onSeasonChange).toHaveBeenCalledWith('/ark/media/jellyfin/Show/Season 02');

    fireEvent.click(screen.getByRole('button', { name: /reassign entire folder/i }));
    expect(onReassignFolder).toHaveBeenCalledTimes(1);
  });

  it('hides the folder-level reassign action when the entry has no folder path', () => {
    render(<MediaFolderFileList {...buildProps({ folderPath: null })} />);

    expect(screen.queryByRole('button', { name: /reassign entire folder/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^reassign$/i })).toBeInTheDocument();
  });
});
