import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import CatalogMetadataCard, { NfoMetadataCard } from '../../src/app/dashboard/my-library/_components/detail/MetadataCards';

describe('MetadataCards', () => {
  it('pretty-prints the catalog record', () => {
    render(<CatalogMetadataCard media={{ title: 'Big Movie', year: 1995 }} />);

    expect(screen.getByText('Catalog Metadata')).toBeInTheDocument();
    expect(screen.getByText('{', { exact: false })).toBeInTheDocument();
    expect(screen.getByText(/"title": "Big Movie"/)).toBeInTheDocument();
    expect(screen.getByText(/"year": 1995/)).toBeInTheDocument();
  });

  it('prefers the catalog NFO copy over the disk copy', () => {
    render(<NfoMetadataCard nfoMetadata={{ source: 'catalog' }} diskNfoData={{ source: 'disk' }} />);

    expect(screen.getByText('NFO Metadata')).toBeInTheDocument();
    expect(screen.getByText(/"source": "catalog"/)).toBeInTheDocument();
    expect(screen.queryByText(/"source": "disk"/)).not.toBeInTheDocument();
  });

  it('falls back to the NFO copy read from disk', () => {
    render(<NfoMetadataCard nfoMetadata={null} diskNfoData={{ source: 'disk' }} />);

    expect(screen.getByText(/"source": "disk"/)).toBeInTheDocument();
  });

  it('explains when there is no NFO metadata at all', () => {
    render(<NfoMetadataCard nfoMetadata={null} diskNfoData={null} />);

    expect(screen.getByText('No NFO metadata is currently available for this title.')).toBeInTheDocument();
  });
});
