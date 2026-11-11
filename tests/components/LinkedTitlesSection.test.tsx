import React from 'react';
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import LinkedTitlesSection from '../../src/app/dashboard/physical-media/_components/LinkedTitlesSection';

const stub = (body: unknown, status = 200) => {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
};

describe('LinkedTitlesSection', () => {
  afterEach(() => vi.unstubAllGlobals());

  it("links each of a disc's titles to its detail page", async () => {
    const fetchMock = stub([
      { mediaType: 'movie', mediaId: 'movie-1', title: 'Big Movie' },
      { mediaType: 'series', mediaId: 'series-1', title: 'Big Show' },
    ]);
    render(<LinkedTitlesSection kind="disc" id="disc-1" />);

    expect(await screen.findByRole('link', { name: /Big Movie/ })).toHaveAttribute('href', '/dashboard/my-library/movie/movie-1');
    expect(screen.getByRole('link', { name: /Big Show/ })).toHaveAttribute('href', '/dashboard/my-library/series/series-1');
    expect(screen.getByText('Show')).toBeInTheDocument();
    expect(String(fetchMock.mock.calls[0][0])).toBe('/api/backend/api/catalog/discs/disc-1/links');
  });

  it('says when a tape has no titles, and shows load errors inline', async () => {
    stub([]);
    const { unmount } = render(<LinkedTitlesSection kind="tape" id="tape-1" />);
    expect(await screen.findByText('This tape is not linked to any movie or show yet.')).toBeInTheDocument();
    unmount();

    stub({ detail: 'boom' }, 500);
    render(<LinkedTitlesSection kind="disc" id="disc-1" />);
    expect(await screen.findByText(/Could not load the linked titles/)).toBeInTheDocument();
  });
});
