import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import PosterGalleryCard from '../../src/app/dashboard/my-library/_components/detail/PosterGalleryCard';
import { PLACEHOLDER_POSTER } from '../../src/service/library/mediaDetailModel';

const GalleryHarness = ({ initialIndex = 0, posterCount = 3 }: { initialIndex?: number; posterCount?: number }) => {
  const [posterIndex, setPosterIndex] = React.useState(initialIndex);

  return (
    <PosterGalleryCard
      mediaTypeFromRoute="series"
      mediaIdFromRoute="tt0475784"
      title="Westworld"
      posterIndex={posterIndex}
      posterCount={posterCount}
      posterLoadFailed={false}
      posterCacheBust={17}
      setPosterIndex={setPosterIndex}
      onPosterLoadError={vi.fn()}
    />
  );
};

describe('PosterGalleryCard', () => {
  it('requests the cached poster for the current index and cache-bust value', () => {
    render(
      <PosterGalleryCard
        mediaTypeFromRoute="movie"
        mediaIdFromRoute="tt0110912"
        title="Big Movie"
        posterIndex={1}
        posterCount={4}
        posterLoadFailed={false}
        posterCacheBust={42}
        setPosterIndex={vi.fn()}
        onPosterLoadError={vi.fn()}
      />
    );

    expect(screen.getByRole('img', { name: 'Big Movie' })).toHaveAttribute(
      'src',
      '/api/backend/api/posters/movie/tt0110912?index=1&v=42'
    );
    expect(screen.getByText('2 / 4')).toBeInTheDocument();
  });

  it('falls back to the placeholder poster once loading has failed', () => {
    render(
      <PosterGalleryCard
        mediaTypeFromRoute="movie"
        mediaIdFromRoute="tt0110912"
        title="Big Movie"
        posterIndex={0}
        posterCount={1}
        posterLoadFailed
        posterCacheBust={1}
        setPosterIndex={vi.fn()}
        onPosterLoadError={vi.fn()}
      />
    );

    expect(screen.getByRole('img', { name: 'Big Movie' })).toHaveAttribute('src', PLACEHOLDER_POSTER);
  });

  it('reports load errors with the failing image element', () => {
    const onPosterLoadError = vi.fn();
    render(
      <PosterGalleryCard
        mediaTypeFromRoute="movie"
        mediaIdFromRoute="tt0110912"
        title="Big Movie"
        posterIndex={0}
        posterCount={1}
        posterLoadFailed={false}
        posterCacheBust={1}
        setPosterIndex={vi.fn()}
        onPosterLoadError={onPosterLoadError}
      />
    );

    const img = screen.getByRole('img', { name: 'Big Movie' });
    fireEvent.error(img);

    expect(onPosterLoadError).toHaveBeenCalledTimes(1);
    expect(onPosterLoadError).toHaveBeenCalledWith(img);
  });

  it('pages through posters and stops at both ends', () => {
    render(<GalleryHarness />);

    expect(screen.getByLabelText('previous poster')).toBeDisabled();
    expect(screen.getByRole('img', { name: 'Westworld' })).toHaveAttribute(
      'src',
      '/api/backend/api/posters/series/tt0475784?index=0&v=17'
    );

    fireEvent.click(screen.getByLabelText('next poster'));
    expect(screen.getByText('2 / 3')).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('next poster'));
    expect(screen.getByText('3 / 3')).toBeInTheDocument();
    expect(screen.getByLabelText('next poster')).toBeDisabled();

    fireEvent.click(screen.getByLabelText('previous poster'));
    expect(screen.getByText('2 / 3')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Westworld' })).toHaveAttribute(
      'src',
      '/api/backend/api/posters/series/tt0475784?index=1&v=17'
    );
  });

  it('hides the pager when there is nothing to page through', () => {
    render(<GalleryHarness posterCount={1} />);

    expect(screen.queryByLabelText('previous poster')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('next poster')).not.toBeInTheDocument();
    expect(screen.queryByText('1 / 1')).not.toBeInTheDocument();
  });

  it('uses the fallback alt text when the title is empty', () => {
    render(
      <PosterGalleryCard
        mediaTypeFromRoute="movie"
        mediaIdFromRoute="tt0110912"
        title=""
        posterIndex={0}
        posterCount={1}
        posterLoadFailed={false}
        posterCacheBust={1}
        setPosterIndex={vi.fn()}
        onPosterLoadError={vi.fn()}
      />
    );

    expect(screen.getByRole('img', { name: 'Media poster' })).toBeInTheDocument();
  });
});
