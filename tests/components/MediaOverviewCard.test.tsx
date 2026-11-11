import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { ComponentProps } from 'react';

import MediaOverviewCard from '../../src/app/dashboard/my-library/_components/detail/MediaOverviewCard';
import type { LibraryMedia } from '../../src/app/dashboard/my-library/_components/libraryHelpers';

type CardProps = ComponentProps<typeof MediaOverviewCard>;

const MOVIE = {
  title: 'Big Movie',
  releaseDate: '1995-04-22',
  runtime: '178 min',
  plot: 'Two hitmen have a long day.',
  countryOfOrigin: ['USA', 'UK'],
  genres: ['Crime', 'Drama'],
  directors: [{ fullName: 'Director One' }],
  topCast: ['Cast One', { actor: 'Cast Two' }],
  writers: ['Writer One'],
} as unknown as LibraryMedia;

const buildProps = (overrides: Partial<CardProps> = {}): CardProps => ({
  media: MOVIE,
  catalogType: 'movie',
  folderPath: '/ark/media/jellyfin/Movies/Big Movie',
  externalIds: { imdbId: 'tt0110912', tmdbId: 155 },
  ...overrides,
});

/** The dd that belongs to a dt label. */
const valueOf = (label: string) => screen.getByText(label, { selector: 'dt' }).nextElementSibling as HTMLElement;

describe('MediaOverviewCard (Metadata tab fields)', () => {
  it('shows the overview and the labelled fields', () => {
    render(<MediaOverviewCard {...buildProps()} />);

    expect(screen.getByText('Two hitmen have a long day.')).toBeInTheDocument();
    expect(valueOf('Release date')).toHaveTextContent('1995-04-22');
    expect(valueOf('Runtime')).toHaveTextContent('178 min');
    expect(valueOf('Country')).toHaveTextContent('USA, UK');
    expect(valueOf('Genres')).toHaveTextContent('Crime, Drama');
    expect(valueOf('Directors')).toHaveTextContent('Director One');
    expect(valueOf('Cast')).toHaveTextContent('Cast One, Cast Two');
    expect(valueOf('Writers')).toHaveTextContent('Writer One');
    expect(valueOf('Folder path')).toHaveTextContent('/ark/media/jellyfin/Movies/Big Movie');
  });

  it('links the external ids out to IMDb and TMDB', () => {
    render(<MediaOverviewCard {...buildProps()} />);

    expect(screen.getByRole('link', { name: /IMDb tt0110912/ })).toHaveAttribute('href', 'https://www.imdb.com/title/tt0110912/');
    expect(screen.getByRole('link', { name: /TMDB 155/ })).toHaveAttribute('href', 'https://www.themoviedb.org/movie/155');
  });

  it('links a show to TMDB TV and labels its running dates', () => {
    const show = { ...MOVIE, seasons: [], runningDates: '2008–2013' } as unknown as LibraryMedia;
    render(<MediaOverviewCard {...buildProps({ media: show, catalogType: 'series', externalIds: { tmdbId: 1396 } })} />);

    expect(screen.getByRole('link', { name: /TMDB 1396/ })).toHaveAttribute('href', 'https://www.themoviedb.org/tv/1396');
    expect(valueOf('Running dates')).toHaveTextContent('2008–2013');
  });

  it('falls back to the legacy IMDB id when there are no external ids', () => {
    render(<MediaOverviewCard {...buildProps({ externalIds: null, legacyImdbId: 'tt7654321' })} />);

    expect(screen.getByRole('link', { name: /IMDb tt7654321/ })).toBeInTheDocument();
  });

  it('uses placeholders for missing values', () => {
    render(
      <MediaOverviewCard
        {...buildProps({
          media: { title: 'Bare' } as unknown as LibraryMedia,
          folderPath: null,
          externalIds: null,
        })}
      />,
    );

    for (const label of ['Release date', 'Runtime', 'Country', 'Genres', 'Directors', 'Cast', 'Writers', 'External IDs', 'Folder path']) {
      expect(valueOf(label)).toHaveTextContent('N/A');
    }
  });
});
