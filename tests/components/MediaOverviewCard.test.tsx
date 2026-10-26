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
  countryOfOrigin: ['USA', 'UK'],
  genres: ['Crime', 'Drama'],
  directors: [{ fullName: 'Director One' }],
  topCast: ['Cast One', { actor: 'Cast Two' }],
  writers: ['Writer One'],
} as unknown as LibraryMedia;

const buildProps = (overrides: Partial<CardProps> = {}): CardProps => ({
  media: MOVIE,
  mediaType: 'movie',
  inLibrary: true,
  fileCount: 2,
  folderPath: '/ark/media/jellyfin/Movies/Big Movie',
  externalIds: { imdbId: 'tt0110912', tmdbId: 155 },
  ...overrides,
});

describe('MediaOverviewCard', () => {
  it('shows the title with library chips', () => {
    render(<MediaOverviewCard {...buildProps()} />);

    expect(screen.getByText('Big Movie')).toBeInTheDocument();
    expect(screen.getByText('Movie')).toBeInTheDocument();
    expect(screen.getByText('In Library')).toBeInTheDocument();
    expect(screen.getByText('2 files')).toBeInTheDocument();
  });

  it('labels show types and singular file counts', () => {
    render(
      <MediaOverviewCard
        {...buildProps({
          media: { title: 'Long Running Show', runningDates: '2011 — 2019', seasons: [] } as unknown as LibraryMedia,
          mediaType: 'series',
          inLibrary: false,
          fileCount: 1,
        })}
      />
    );

    expect(screen.getByText('Show')).toBeInTheDocument();
    expect(screen.getByText('Not In Library')).toBeInTheDocument();
    expect(screen.getByText('1 file')).toBeInTheDocument();
    expect(screen.getByText('2011 — 2019')).toBeInTheDocument();
  });

  it('renders the headline metadata grid', () => {
    render(<MediaOverviewCard {...buildProps()} />);

    expect(screen.getByText('1995-04-22')).toBeInTheDocument();
    expect(screen.getByText('178 min')).toBeInTheDocument();
    expect(screen.getByText('USA, UK')).toBeInTheDocument();
    expect(screen.getByText('Crime, Drama')).toBeInTheDocument();
    expect(screen.getByText('Director One')).toBeInTheDocument();
    expect(screen.getByText('Cast One, Cast Two')).toBeInTheDocument();
    expect(screen.getByText('Writer One')).toBeInTheDocument();
    expect(screen.getByText('/ark/media/jellyfin/Movies/Big Movie')).toBeInTheDocument();
    expect(screen.getByText('IMDB: tt0110912 | TMDB: 155')).toBeInTheDocument();
  });

  it('falls back to the legacy IMDB id when there are no external ids', () => {
    render(<MediaOverviewCard {...buildProps({ externalIds: null, legacyImdbId: 'tt0068646' })} />);

    expect(screen.getByText('IMDB: tt0068646')).toBeInTheDocument();
  });

  it('uses placeholders for missing values', () => {
    const { container } = render(
      <MediaOverviewCard
        {...buildProps({
          media: {} as unknown as LibraryMedia,
          inLibrary: false,
          fileCount: 0,
          folderPath: null,
          externalIds: null,
        })}
      />
    );

    expect(container.querySelector('em')).toHaveTextContent('[No Title]');
    expect(screen.getByText('Not In Library')).toBeInTheDocument();
    expect(screen.getByText('0 files')).toBeInTheDocument();
    expect(screen.getAllByText('N/A').length).toBeGreaterThanOrEqual(8);
  });
});
