import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';

import DiscEditDialog from '../../src/app/dashboard/physical-media/_components/DiscEditDialog';
import { CatalogDisc } from '../../src/types/catalog/Disc.type';

const createDiscMock = vi.fn();
const updateDiscMock = vi.fn();

vi.mock('../../src/service/catalog/DiscCatalogService', () => ({
  createDisc: (...args: unknown[]) => createDiscMock(...args),
  updateDisc: (...args: unknown[]) => updateDiscMock(...args),
}));

const EXISTING_DISC: CatalogDisc = {
  id: 'disc-1',
  title: 'The Matrix',
  videoFiles: [],
  imageFiles: [],
  isPartOfSet: false,
  isRentalDisc: false,
  containsSpecialFeatures: true,
  format: 'BLURAY',
  barcode: '085391163923',
  condition: 'Good',
};

describe('DiscEditDialog', () => {
  beforeEach(() => {
    createDiscMock.mockReset().mockResolvedValue({ id: 'new-disc', title: 'New Disc' });
    updateDiscMock.mockReset().mockResolvedValue({ id: 'disc-1', title: 'Updated' });
  });

  it('renders in create mode with empty fields', () => {
    render(<DiscEditDialog open disc={null} onClose={vi.fn()} onSaved={vi.fn()} />);
    expect(screen.getByText('New Disc')).toBeInTheDocument();
    expect(screen.getByLabelText('Title', { exact: false })).toHaveValue('');
  });

  it('pre-fills fields in edit mode', () => {
    render(<DiscEditDialog open disc={EXISTING_DISC} onClose={vi.fn()} onSaved={vi.fn()} />);
    expect(screen.getByText('Edit Disc')).toBeInTheDocument();
    expect(screen.getByLabelText('Title', { exact: false })).toHaveValue('The Matrix');
    expect(screen.getByLabelText('Barcode')).toHaveValue('085391163923');
  });

  it('shows an error and does not save when title is empty', async () => {
    render(<DiscEditDialog open disc={null} onClose={vi.fn()} onSaved={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /create disc/i }));
    await waitFor(() => {
      expect(screen.getByText('Title is required')).toBeInTheDocument();
    });
    expect(createDiscMock).not.toHaveBeenCalled();
  });

  it('calls createDisc with the entered title on save in create mode', async () => {
    const onSaved = vi.fn();
    const onClose = vi.fn();
    render(<DiscEditDialog open disc={null} onClose={onClose} onSaved={onSaved} />);

    fireEvent.change(screen.getByLabelText('Title', { exact: false }), { target: { value: 'Blade Runner' } });
    fireEvent.click(screen.getByRole('button', { name: /create disc/i }));

    await waitFor(() => {
      expect(createDiscMock).toHaveBeenCalledTimes(1);
    });
    expect(createDiscMock.mock.calls[0][0]).toMatchObject({ title: 'Blade Runner' });
    expect(onSaved).toHaveBeenCalledWith({ id: 'new-disc', title: 'New Disc' });
    expect(onClose).toHaveBeenCalled();
  });

  it('calls updateDisc with the disc id on save in edit mode', async () => {
    const onSaved = vi.fn();
    render(<DiscEditDialog open disc={EXISTING_DISC} onClose={vi.fn()} onSaved={onSaved} />);

    fireEvent.change(screen.getByLabelText('Title', { exact: false }), { target: { value: 'The Matrix Reloaded' } });
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => {
      expect(updateDiscMock).toHaveBeenCalledTimes(1);
    });
    expect(updateDiscMock.mock.calls[0][0]).toBe('disc-1');
    expect(updateDiscMock.mock.calls[0][1]).toMatchObject({ title: 'The Matrix Reloaded' });
  });

  it('shows an error message when the save request fails', async () => {
    createDiscMock.mockRejectedValueOnce(new Error('network down'));
    render(<DiscEditDialog open disc={null} onClose={vi.fn()} onSaved={vi.fn()} />);

    fireEvent.change(screen.getByLabelText('Title', { exact: false }), { target: { value: 'Some Disc' } });
    fireEvent.click(screen.getByRole('button', { name: /create disc/i }));

    await waitFor(() => {
      expect(screen.getByText('network down')).toBeInTheDocument();
    });
  });
});
