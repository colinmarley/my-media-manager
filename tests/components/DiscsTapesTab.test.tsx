/**
 * The Discs & Tapes tab (successor of MediaAssociatedFilesCard): one card per disc / tape with
 * this title's files on it, the files with no source, and LinkFileToDiscDialog in both
 * directions.
 */
import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import DiscsTapesTab from '../../src/app/dashboard/my-library/_components/detail/DiscsTapesTab';
import LinkFileToDiscDialog from '../../src/app/dashboard/my-library/_components/detail/LinkFileToDiscDialog';
import type { FileActionHandlers } from '../../src/app/dashboard/my-library/_components/detail/fileActionTypes';
import { titleSources } from '../../src/service/library/mediaFileModel';
import type { MediaFile } from '../../src/types/library/MediaFile.type';

const file = (overrides: Partial<MediaFile>): MediaFile => ({
  id: 'f',
  fileName: 'file.mkv',
  filePath: '/lib/file.mkv',
  fileSize: 700 * 1024 ** 2,
  detectedMediaType: null,
  assignmentStatus: null,
  targetPath: null,
  organizationStatus: null,
  createdAt: null,
  probedAt: '2026-01-01T00:00:00Z',
  ...overrides,
});

const ON_DISC = file({ id: 'on-disc', fileName: 'Big Movie.mkv', role: 'main', resolutionCategory: '1080p', videoCodec: 'h264', discId: 'disc-1' });
const LOOSE = file({ id: 'loose', fileName: 'Featurette.mkv', role: 'extra' });

const DISC = { id: 'disc-1', title: 'Disc One', format: 'Blu-ray', storageType: 'Box', storageId: 'MED0012', linkedFileCount: 1 };
const TAPE = { id: 'tape-1', title: 'Home Tape', tapeType: 'vhs', linkedFileCount: 0 };

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

const files = [ON_DISC, LOOSE];
const sources = titleSources([DISC as never], [TAPE as never], files);

describe('DiscsTapesTab', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('renders a card per disc and tape with what it is, where it is kept and its rip state', () => {
    render(<DiscsTapesTab sources={sources} allFiles={files} actions={handlers()} onLinkFilesTo={vi.fn()} />);

    const disc = screen.getByRole('article', { name: 'Disc One' });
    expect(within(disc).getByRole('link', { name: 'Disc One' })).toHaveAttribute('href', '/dashboard/physical-media/discs/disc-1');
    expect(within(disc).getByText(/Disc · Blu-ray · Kept in/)).toBeInTheDocument();
    expect(within(disc).getByText('Ripped · 1 file')).toBeInTheDocument();
    expect(within(disc).getByText('Big Movie.mkv')).toBeInTheDocument();
    expect(within(disc).getByText('1080p')).toBeInTheDocument();

    const tape = screen.getByRole('article', { name: 'Home Tape' });
    expect(within(tape).getByRole('link', { name: 'Home Tape' })).toHaveAttribute('href', '/dashboard/physical-media/tapes/tape-1');
    expect(within(tape).getByText(/Tape · VHS · No storage location/)).toBeInTheDocument();
    expect(within(tape).getByText('Not digitized')).toBeInTheDocument();
  });

  it('opens the link dialog for a card and unlinks a single file', () => {
    const actions = handlers();
    const onLinkFilesTo = vi.fn();
    render(<DiscsTapesTab sources={sources} allFiles={files} actions={actions} onLinkFilesTo={onLinkFilesTo} />);

    const disc = screen.getByRole('article', { name: 'Disc One' });
    fireEvent.click(within(disc).getByRole('button', { name: 'Link files…' }));
    expect(onLinkFilesTo).toHaveBeenCalledWith(expect.objectContaining({ kind: 'disc', id: 'disc-1' }));

    fireEvent.click(within(disc).getByRole('button', { name: 'Unlink Big Movie.mkv from Disc One' }));
    expect(actions.onUnlink).toHaveBeenCalledWith([ON_DISC]);
  });

  it('lists the files with no source disc and links a selection of them', () => {
    const actions = handlers();
    render(<DiscsTapesTab sources={sources} allFiles={files} actions={actions} onLinkFilesTo={vi.fn()} />);

    expect(screen.getByRole('heading', { name: 'Files with no source disc' })).toBeInTheDocument();
    const linkSelected = screen.getByRole('button', { name: 'Link to…' });
    expect(linkSelected).toBeDisabled();

    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Featurette.mkv' }));
    fireEvent.click(screen.getByRole('button', { name: 'Link 1 to…' }));
    expect(actions.onLink).toHaveBeenCalledWith([LOOSE]);
  });

  it('points to Discs & Tapes when the title has no discs or tapes', () => {
    render(<DiscsTapesTab sources={[]} allFiles={[LOOSE]} actions={handlers()} onLinkFilesTo={vi.fn()} />);

    expect(screen.getByText('No discs or tapes linked')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to Discs & Tapes' })).toHaveAttribute('href', '/dashboard/physical-media');
  });
});

describe('LinkFileToDiscDialog', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('links the chosen files to a fixed disc', async () => {
    const onLink = vi.fn(async () => undefined);
    const onClose = vi.fn();
    const extra = file({ id: 'x2', fileName: 'Deleted Scenes.mkv' });
    render(
      <LinkFileToDiscDialog
        open
        onClose={onClose}
        files={[LOOSE, extra]}
        target={{ kind: 'disc', id: 'disc-1', title: 'Disc One' }}
        sources={[]}
        onLink={onLink}
      />,
    );

    expect(screen.getByRole('dialog', { name: 'Link files to "Disc One"' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Link files' })).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Deleted Scenes.mkv' }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Link 1 file' }));
    });

    expect(onLink).toHaveBeenCalledWith(['x2'], { kind: 'disc', id: 'disc-1', title: 'Disc One' });
    expect(onClose).toHaveBeenCalled();
  });

  it('picks a disc for the given files, from the title or from a search of all discs and tapes', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: unknown) => {
      const url = String(input);
      const body = url.includes('/discs/search') ? [{ id: 'disc-9', title: 'Other Disc', format: 'DVD' }] : [];
      return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }));
    const onLink = vi.fn(async () => undefined);
    render(
      <LinkFileToDiscDialog
        open
        onClose={vi.fn()}
        files={[LOOSE]}
        sources={[{ kind: 'disc', id: 'disc-1', title: 'Disc One', format: 'Blu-ray' }, { kind: 'tape', id: 'tape-1', title: 'Home Tape' }]}
        onLink={onLink}
      />,
    );

    expect(screen.getByText("This title's discs and tapes")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Search all discs and tapes'), { target: { value: 'other' } });
    fireEvent.click(await screen.findByText('Other Disc', {}, { timeout: 2000 }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Link 1 file' }));
    });

    await waitFor(() => expect(onLink).toHaveBeenCalledWith(['loose'], expect.objectContaining({ kind: 'disc', id: 'disc-9' })));
  });
});
