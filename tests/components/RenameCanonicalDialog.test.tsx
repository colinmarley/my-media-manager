import React from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import RenameCanonicalDialog from '../../src/app/dashboard/my-library/_components/detail/RenameCanonicalDialog';
import type { MediaFile } from '../../src/types/library/MediaFile.type';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const file = (id: string, fileName: string): MediaFile => ({
  id,
  fileName,
  filePath: `/lib/${fileName}`,
  fileSize: 1,
  detectedMediaType: null,
  assignmentStatus: null,
  targetPath: null,
  organizationStatus: null,
  createdAt: null,
});

const FILES = [file('a', 'big.movie.1995.mkv'), file('b', 'Big Movie (1995) - Trailer.mkv'), file('c', 'taken.mkv')];

const preview = (id: string, current: string, canonical: string, changed: boolean, conflict = false) => ({
  fileId: id,
  currentPath: `/lib/${current}`,
  canonicalPath: `/lib/${canonical}`,
  currentRelativePath: current,
  canonicalRelativePath: canonical,
  changed,
  applied: false,
  conflict,
  file: null,
});

const PREVIEWS: Record<string, unknown> = {
  a: preview('a', 'Movies/big.movie.1995.mkv', 'Movies/Big Movie (1995)/Big Movie (1995).mkv', true),
  b: preview('b', 'Movies/Big Movie (1995)/Big Movie (1995) - Trailer.mkv', 'Movies/Big Movie (1995)/Big Movie (1995) - Trailer.mkv', false),
  c: preview('c', 'Movies/taken.mkv', 'Movies/Big Movie (1995)/Big Movie (1995).mkv', true, true),
};

const stubRename = (status = 200) => {
  const fetchMock = vi.fn(async (input: unknown) => {
    const url = String(input);
    if (status !== 200) return json({ detail: 'Not Found' }, status);
    const id = /media-files\/([^/]+)\/rename-canonical/.exec(url)?.[1] ?? '';
    return json(PREVIEWS[id]);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
};

describe('RenameCanonicalDialog', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('previews current → canonical with a dry run, then applies only the clean renames', async () => {
    const fetchMock = stubRename();
    const onApplied = vi.fn();
    const onClose = vi.fn();
    render(<RenameCanonicalDialog open files={FILES} onClose={onClose} onApplied={onApplied} onUnavailable={vi.fn()} />);

    expect(await screen.findByText('Will rename')).toBeInTheDocument();
    expect(fetchMock.mock.calls.map(([u]) => String(u))).toEqual([
      '/api/backend/api/catalog/media-files/a/rename-canonical?dryRun=true',
      '/api/backend/api/catalog/media-files/b/rename-canonical?dryRun=true',
      '/api/backend/api/catalog/media-files/c/rename-canonical?dryRun=true',
    ]);

    const first = screen.getByLabelText('Rename preview for big.movie.1995.mkv');
    expect(within(first).getByText('Movies/big.movie.1995.mkv')).toBeInTheDocument();
    expect(within(first).getByText('Movies/Big Movie (1995)/Big Movie (1995).mkv')).toBeInTheDocument();
    expect(screen.getByText('Already canonical')).toBeInTheDocument();
    expect(screen.getByText('Target exists')).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Apply 1 rename' }));
    });

    expect(fetchMock.mock.calls.at(-1)?.[0]).toBe('/api/backend/api/catalog/media-files/a/rename-canonical?dryRun=false');
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(onApplied).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it.each([404, 405])('says "not available yet" when the endpoint answers %i', async (status) => {
    stubRename(status);
    const onUnavailable = vi.fn();
    render(<RenameCanonicalDialog open files={FILES} onClose={vi.fn()} onApplied={vi.fn()} onUnavailable={onUnavailable} />);

    expect(await screen.findByText('Renaming to the canonical name is not available on this server yet.')).toBeInTheDocument();
    expect(onUnavailable).toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /Apply/ })).not.toBeInTheDocument();
  });
});
