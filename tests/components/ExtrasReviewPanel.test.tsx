import React from 'react';
import { act, render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';

import ExtrasReviewPanel from '../../src/app/admin/_components/ExtrasReviewPanel';
import useExtrasReviewStore from '../../src/store/useExtrasReviewStore';
import { PendingExtra } from '../../src/types/library/ExtrasReview.type';

const listPendingMock = vi.fn();
const listCategoriesMock = vi.fn();
const updateMock = vi.fn();
const playbackInfoMock = vi.fn();

vi.mock('../../src/service/library/ExtrasReviewService', () => ({
  default: {
    listPending: (...args: unknown[]) => listPendingMock(...args),
    listCategories: (...args: unknown[]) => listCategoriesMock(...args),
    update: (...args: unknown[]) => updateMock(...args),
    contactSheetUrl: (id: string) => `/sheet/${id}`,
    playbackInfo: (...args: unknown[]) => playbackInfoMock(...args),
    previewUrl: (id: string, start = 0, audio = 0) => `/preview/${id}?start=${start}&audio=${audio}`,
  },
}));

const HELD: PendingExtra = {
  id: 'q1',
  assignmentId: null,
  mediaFileId: null,
  queueItemId: 'q1',
  category: 'clip',
  source: 'rip',
  confirmed: false,
  createdAt: null,
  fileName: 'Burn Notice (2007)-clip.mkv',
  filePath: '/ingest/Burn Notice (2007)/Season 01/Burn Notice (2007)-clip.mkv',
  fileSize: 100_000_000,
  durationMs: 189_000,
  title: 'Burn Notice',
  year: 2007,
  proposedPath: 'TV Shows/Burn Notice (2007)/Season 01/Burn Notice (2007)-clip.mkv',
  discTitleIndex: 9,
  hasContactSheet: true,
};

const LEGACY: PendingExtra = {
  id: 'x1',
  assignmentId: 'a1',
  mediaFileId: 'f1',
  category: null,
  source: 'inferred',
  confirmed: false,
  createdAt: null,
  fileName: 'Making Of.mkv',
  filePath: '/lib/Movie/Making Of.mkv',
  fileSize: 5,
};

const pickCategory = async (row: HTMLElement, label: string) => {
  fireEvent.mouseDown(within(row).getByRole('combobox'));
  fireEvent.click(await screen.findByRole('option', { name: label }));
};

describe('ExtrasReviewPanel', () => {
  beforeEach(() => {
    useExtrasReviewStore.setState({ items: [], categories: [], loading: false, error: null, savingIds: new Set() });
    listCategoriesMock.mockReset().mockResolvedValue(['clip', 'blooper', 'featurette']);
    listPendingMock.mockReset().mockResolvedValue([HELD, LEGACY]);
    updateMock.mockReset();
    playbackInfoMock.mockReset().mockResolvedValue({ durationSeconds: 189, audioTracks: [] });
    // jsdom has no media playback; the player pauses and reloads its <video> to let go of a stream.
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
  });

  // The name can show twice in a row: as the file, and as the name it will be filed under.
  const rowOf = async (fileName: string) =>
    (await screen.findAllByText(fileName))[0].closest('.MuiPaper-root') as HTMLElement;

  it('shows a held ripped extra with its frames, length and the name it will get', async () => {
    render(<ExtrasReviewPanel />);
    const row = await rowOf('Burn Notice (2007)-clip.mkv');

    expect(within(row).getByAltText('Twelve frames from Burn Notice (2007)-clip.mkv')).toHaveAttribute('src', '/sheet/q1');
    expect(within(row).getByText(/Burn Notice \(2007\) · disc title 9 · 3:09/)).toBeInTheDocument();
    expect(within(row).getByText('Burn Notice (2007)-clip.mkv', { selector: 'strong' })).toBeInTheDocument();
    expect(within(row).getByRole('button', { name: 'Confirm and file' })).toBeEnabled();

    const legacy = await rowOf('Making Of.mkv');
    expect(within(legacy).queryByRole('img')).not.toBeInTheDocument();
    expect(within(legacy).getByRole('button', { name: 'Confirm' })).toBeDisabled();
  });

  it('saves a new type at once and shows the new file name', async () => {
    updateMock.mockResolvedValue({ ...HELD, category: 'blooper', proposedPath: 'TV Shows/X/Season 01/Burn Notice (2007)-blooper.mkv' });
    render(<ExtrasReviewPanel />);
    const row = await rowOf('Burn Notice (2007)-clip.mkv');

    await pickCategory(row, 'Blooper');
    expect(updateMock).toHaveBeenCalledWith('q1', { category: 'blooper' });
    expect(await within(row).findByText('Burn Notice (2007)-blooper.mkv', { selector: 'strong' })).toBeInTheDocument();
  });

  it('does not save a type for an older-style row until it is confirmed', async () => {
    render(<ExtrasReviewPanel />);
    const legacy = await rowOf('Making Of.mkv');
    await pickCategory(legacy, 'Featurette');
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('confirms with the chosen type and drops the row', async () => {
    updateMock.mockResolvedValue({ ...HELD, confirmed: true, queueStatus: 'completed' });
    render(<ExtrasReviewPanel />);
    const row = await rowOf('Burn Notice (2007)-clip.mkv');

    fireEvent.click(within(row).getByRole('button', { name: 'Confirm and file' }));
    await waitFor(() => expect(screen.queryByText('Burn Notice (2007)-clip.mkv')).not.toBeInTheDocument());
    expect(updateMock).toHaveBeenCalledWith('q1', { category: 'clip', confirmed: true });
  });

  it('says so when a confirmed extra could not be filed', async () => {
    updateMock.mockResolvedValue({ ...HELD, confirmed: true, queueStatus: 'failed', error: 'target exists' });
    render(<ExtrasReviewPanel />);
    const row = await rowOf('Burn Notice (2007)-clip.mkv');

    fireEvent.click(within(row).getByRole('button', { name: 'Confirm and file' }));
    expect(await screen.findByText(/could not be filed: target exists/)).toBeInTheDocument();
  });

  it('plays a held extra from the start and closes the player', async () => {
    render(<ExtrasReviewPanel />);
    const row = await rowOf('Burn Notice (2007)-clip.mkv');

    fireEvent.click(within(row).getByRole('button', { name: 'Play' }));
    await act(async () => {}); // the player's track lookup
    const video = within(row).getByLabelText('Playing Burn Notice (2007)-clip.mkv');
    expect(video).toHaveAttribute('src', '/preview/q1?start=0&audio=0');
    expect(playbackInfoMock).toHaveBeenCalledWith('q1');
    expect(within(row).getByRole('slider', { name: 'Jump to' })).toBeInTheDocument();

    fireEvent.click(within(row).getByRole('button', { name: 'Close player' }));
    expect(within(row).queryByLabelText('Playing Burn Notice (2007)-clip.mkv')).not.toBeInTheDocument();
    // The older-style row has no file to stream.
    expect(within(await rowOf('Making Of.mkv')).queryByRole('button', { name: 'Play' })).not.toBeInTheDocument();
  });

  it('plays from the moment of a frame clicked on the contact sheet', async () => {
    render(<ExtrasReviewPanel />);
    const row = await rowOf('Burn Notice (2007)-clip.mkv');
    fireEvent.load(within(row).getByAltText('Twelve frames from Burn Notice (2007)-clip.mkv'));

    // 189 s over twelve frames is one every 15.75 s: the fifth is at 63 s.
    fireEvent.click(within(row).getByRole('button', { name: 'Play from 1:03' }));
    await act(async () => {});
    expect(within(row).getByLabelText('Playing Burn Notice (2007)-clip.mkv')).toHaveAttribute('src', '/preview/q1?start=63&audio=0');
  });

  it('switches to another audio track, such as a commentary', async () => {
    playbackInfoMock.mockResolvedValue({
      durationSeconds: 189,
      audioTracks: [
        { index: 0, codec: 'ac3', channels: 6, language: 'eng', title: null, default: true, commentary: false },
        { index: 1, codec: 'ac3', channels: 2, language: 'eng', title: 'Director', default: false, commentary: true },
      ],
    });
    render(<ExtrasReviewPanel />);
    const row = await rowOf('Burn Notice (2007)-clip.mkv');
    fireEvent.click(within(row).getByRole('button', { name: 'Play' }));

    fireEvent.mouseDown(await within(row).findByRole('combobox', { name: 'Audio' }));
    fireEvent.click(await screen.findByRole('option', { name: 'Track 2 · Director · Commentary · eng · 2ch · ac3' }));
    expect(within(row).getByLabelText('Playing Burn Notice (2007)-clip.mkv')).toHaveAttribute('src', '/preview/q1?start=0&audio=1');
  });
});
