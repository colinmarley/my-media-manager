import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ComponentProps } from 'react';

import MediaAssociatedFilesCard from '../../src/app/dashboard/my-library/_components/detail/MediaAssociatedFilesCard';
import type { CatalogDisc } from '@/types/catalog/Disc.type';
import type { CatalogTape } from '@/types/catalog/Tape.type';

type CardProps = ComponentProps<typeof MediaAssociatedFilesCard>;

const DISC_A = {
  id: 'disc-1',
  title: 'Big Movie Disc',
  videoFiles: [{ fileName: 'big-movie-main.mkv' }],
  storageType: 'SATA',
  storageId: 'A1',
} as unknown as CatalogDisc;

const DISC_B = { id: 'disc-2', title: '', videoFiles: [] } as unknown as CatalogDisc;

const TAPE_A = {
  id: 'tape-1',
  title: 'Live Recording',
  videoFiles: [{ fileName: 'recording.mp4' }],
} as unknown as CatalogTape;

const buildProps = (overrides: Partial<CardProps> = {}): CardProps => ({
  folderPath: '/ark/media/jellyfin/Movies/Big Movie',
  selectedDiscCount: 0,
  onOpenReassign: vi.fn(),
  reassignSuccessMsg: null,
  onCloseReassignSuccessMsg: vi.fn(),
  diskReassignMsg: null,
  onCloseDiskReassignMsg: vi.fn(),
  associatedDiscs: [],
  associatedTapes: [],
  mediaLinksLoading: false,
  selectedDiscIds: new Set<string>(),
  onToggleDisc: vi.fn(),
  folderSection: {
    loading: false,
    files: [],
    isSeries: false,
    seasonFolders: [],
    selectedSeasonPath: '',
    onSeasonChange: vi.fn(),
    onReassignFolder: vi.fn(),
    onReassignFile: vi.fn(),
    onAssignEpisode: vi.fn(),
  },
  ...overrides,
});

describe('MediaAssociatedFilesCard', () => {
  it('explains when nothing is linked to the title', () => {
    render(<MediaAssociatedFilesCard {...buildProps({ folderPath: null })} />);

    expect(screen.getByText('No associated disc or file records were found.')).toBeInTheDocument();
  });

  it('shows the folder loading state instead of the file list', () => {
    render(
      <MediaAssociatedFilesCard
        {...buildProps({
          folderSection: { ...buildProps().folderSection, loading: true, files: [{ path: '/a.mkv', name: 'a.mkv', size: 10 }] },
        })}
      />
    );

    expect(screen.getByText('Loading files from folder…')).toBeInTheDocument();
    expect(screen.queryByText('a.mkv')).not.toBeInTheDocument();
  });

  it('delegates to the folder file list once files are loaded', () => {
    render(
      <MediaAssociatedFilesCard
        {...buildProps({
          folderSection: { ...buildProps().folderSection, files: [{ path: '/a.mkv', name: 'a.mkv', size: 10 }] },
        })}
      />
    );

    expect(screen.getByText('Destination files on disk. You can manually reassign the entire folder or individual files.')).toBeInTheDocument();
    expect(screen.getByText('a.mkv')).toBeInTheDocument();
  });

  it('says the destination folder is empty when the folder exists but has no files', () => {
    render(<MediaAssociatedFilesCard {...buildProps()} />);

    expect(screen.getByText('No files were found in the destination folder on disk.')).toBeInTheDocument();
  });

  it('offers the reassign action only when discs are selected', () => {
    const onOpenReassign = vi.fn();
    const { rerender } = render(<MediaAssociatedFilesCard {...buildProps({ associatedDiscs: [DISC_A], onOpenReassign })} />);
    expect(screen.queryByRole('button', { name: /reassign .* selected/i })).not.toBeInTheDocument();

    rerender(<MediaAssociatedFilesCard {...buildProps({ associatedDiscs: [DISC_A, DISC_B], selectedDiscCount: 2, onOpenReassign })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Reassign 2 selected' }));

    expect(onOpenReassign).toHaveBeenCalledTimes(1);
  });

  it('toggles disc selection from the row and reflects the selected set', () => {
    const onToggleDisc = vi.fn();
    render(
      <MediaAssociatedFilesCard
        {...buildProps({ associatedDiscs: [DISC_A, DISC_B], selectedDiscIds: new Set(['disc-1']), onToggleDisc })}
      />
    );

    expect(screen.getByText('Select disc records to reassign them to a different catalog entry.')).toBeInTheDocument();
    expect(screen.getByText('Big Movie Disc')).toBeInTheDocument();
    expect(screen.getByText('big-movie-main.mkv · SATA A1')).toBeInTheDocument();
    expect(screen.getByText('disc-2')).toBeInTheDocument();
    expect(screen.getByText('No video file names were stored on this disc record. · No storage location set')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Big Movie Disc'));
    expect(onToggleDisc).toHaveBeenCalledWith('disc-1');

    const checkboxes = screen.getAllByRole('checkbox');
    expect(checkboxes[0]).toBeChecked();
    expect(checkboxes[1]).not.toBeChecked();
  });

  it('lists associated tapes with their storage summary', () => {
    render(<MediaAssociatedFilesCard {...buildProps({ associatedTapes: [TAPE_A] })} />);

    expect(screen.getByText('Associated tapes.')).toBeInTheDocument();
    expect(screen.getByText('Live Recording')).toBeInTheDocument();
    expect(screen.getByText('recording.mp4 · No storage location set')).toBeInTheDocument();
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
  });

  it('renders dismissible success alerts for both reassign flows', () => {
    const onCloseReassignSuccessMsg = vi.fn();
    const onCloseDiskReassignMsg = vi.fn();
    render(
      <MediaAssociatedFilesCard
        {...buildProps({
          folderPath: null,
          reassignSuccessMsg: 'Reassigned 1 file.',
          diskReassignMsg: 'Folder renamed on disk.',
          onCloseReassignSuccessMsg,
          onCloseDiskReassignMsg,
        })}
      />
    );

    expect(screen.getByText('Reassigned 1 file.')).toBeInTheDocument();
    expect(screen.getByText('Folder renamed on disk.')).toBeInTheDocument();

    const closeButtons = screen.getAllByRole('button', { name: /close/i });
    fireEvent.click(closeButtons[0]);
    fireEvent.click(closeButtons[1]);

    expect(onCloseReassignSuccessMsg).toHaveBeenCalledTimes(1);
    expect(onCloseDiskReassignMsg).toHaveBeenCalledTimes(1);
  });

  it('keeps the empty-state copy hidden while links are still loading', () => {
    render(<MediaAssociatedFilesCard {...buildProps({ folderPath: null, mediaLinksLoading: true })} />);

    expect(screen.queryByText('No associated disc or file records were found.')).not.toBeInTheDocument();
  });
});
