import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ComponentProps } from 'react';

import PosterToolsCard from '../../src/app/dashboard/my-library/_components/detail/PosterToolsCard';

type CardProps = ComponentProps<typeof PosterToolsCard>;

const buildProps = (overrides: Partial<CardProps> = {}): CardProps => ({
  posterSourceInput: '',
  onPosterSourceInputChange: vi.fn(),
  posterSourceSaving: false,
  posterSourceStatus: null,
  hasPosterSource: true,
  onSavePosterSource: vi.fn(),
  ...overrides,
});

describe('PosterToolsCard', () => {
  it('explains replacing an existing poster source', () => {
    render(<PosterToolsCard {...buildProps()} />);

    expect(screen.getByText('Paste a new poster URL here to replace the current source and refresh the cache.')).toBeInTheDocument();
  });

  it('explains that no poster source exists yet', () => {
    render(<PosterToolsCard {...buildProps({ hasPosterSource: false })} />);

    expect(screen.getByText('No poster source is set yet. Paste a direct image URL here to fetch and cache one for this title.')).toBeInTheDocument();
  });

  it('forwards typing to the parent', () => {
    const onPosterSourceInputChange = vi.fn();
    render(<PosterToolsCard {...buildProps({ onPosterSourceInputChange })} />);

    fireEvent.change(screen.getByLabelText('Poster image URL'), { target: { value: 'https://cdn.example.com/p.jpg' } });

    expect(onPosterSourceInputChange).toHaveBeenCalledWith('https://cdn.example.com/p.jpg');
  });

  it('disables saving while the input is blank', () => {
    render(<PosterToolsCard {...buildProps({ posterSourceInput: '   ' })} />);

    expect(screen.getByRole('button', { name: 'Save Poster Source' })).toBeDisabled();
  });

  it('saves a poster source and surfaces the result', () => {
    const onSavePosterSource = vi.fn();
    render(
      <PosterToolsCard
        {...buildProps({
          posterSourceInput: 'https://cdn.example.com/p.jpg',
          posterSourceStatus: { type: 'success', message: 'Poster saved from https://cdn.example.com/p.jpg' },
          onSavePosterSource,
        })}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Save Poster Source' }));
    expect(onSavePosterSource).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Poster saved from https://cdn.example.com/p.jpg')).toBeInTheDocument();
  });

  it('locks the editor while the save is in flight', () => {
    render(<PosterToolsCard {...buildProps({ posterSourceInput: 'https://a', posterSourceSaving: true })} />);

    expect(screen.getByLabelText('Poster image URL')).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Save Poster Source' })).not.toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
  });

  it('renders error statuses', () => {
    render(
      <PosterToolsCard
        {...buildProps({ posterSourceStatus: { type: 'error', message: 'Poster URL fetch failed.' } })}
      />
    );

    expect(screen.getByText('Poster URL fetch failed.')).toBeInTheDocument();
  });
});
