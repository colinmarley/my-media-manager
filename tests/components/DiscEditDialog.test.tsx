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

const lookupUpcMock = vi.fn();
const scanCoverMock = vi.fn();

vi.mock('../../src/service/catalog/DiscLookupService', () => ({
  lookupUpc: (...args: unknown[]) => lookupUpcMock(...args),
  scanCover: (...args: unknown[]) => scanCoverMock(...args),
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
    lookupUpcMock.mockReset();
    scanCoverMock.mockReset();
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

  describe('barcode lookup', () => {
    it('fills empty title and format from the UPC result', async () => {
      lookupUpcMock.mockResolvedValueOnce({
        found: true, code: '085391163923', title: 'The Matrix', rawTitle: 'The Matrix [Blu-ray]',
        format: 'BLURAY', looksLikeMedia: true, releaseDate: '1999-03-31',
      });
      render(<DiscEditDialog open disc={null} onClose={vi.fn()} onSaved={vi.fn()} />);

      fireEvent.change(screen.getByLabelText('Barcode'), { target: { value: '085391163923' } });
      fireEvent.click(screen.getByRole('button', { name: 'Look up' }));

      await waitFor(() => {
        expect(screen.getByLabelText('Title', { exact: false })).toHaveValue('The Matrix');
      });
      expect(lookupUpcMock).toHaveBeenCalledWith('085391163923');
      expect(screen.getByLabelText('Release Date')).toHaveValue('1999-03-31');
      expect(screen.getByText('BLURAY')).toBeInTheDocument();
      expect(screen.getByText('Barcode lookup filled: Title, Format, Release date.')).toBeInTheDocument();
    });

    it('does not overwrite a typed title without asking', async () => {
      lookupUpcMock.mockResolvedValueOnce({
        found: true, code: '085391163923', title: 'The Matrix', format: 'DVD', looksLikeMedia: true,
      });
      render(<DiscEditDialog open disc={null} onClose={vi.fn()} onSaved={vi.fn()} />);

      const titleInput = screen.getByLabelText('Title', { exact: false });
      fireEvent.change(titleInput, { target: { value: 'My Title' } });
      fireEvent.change(screen.getByLabelText('Barcode'), { target: { value: '085391163923' } });
      fireEvent.click(screen.getByRole('button', { name: 'Look up' }));

      await waitFor(() => {
        expect(screen.getByText(/Lookup suggests different values/)).toBeInTheDocument();
      });
      expect(titleInput).toHaveValue('My Title');
      expect(screen.getByText('Barcode lookup filled: Format.')).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: 'Replace' }));
      expect(titleInput).toHaveValue('The Matrix');
    });

    it('shows a loading state, then an inline error when the lookup fails', async () => {
      let reject!: (e: Error) => void;
      lookupUpcMock.mockReturnValueOnce(new Promise((_, r) => { reject = r; }));
      render(<DiscEditDialog open disc={null} onClose={vi.fn()} onSaved={vi.fn()} />);

      fireEvent.change(screen.getByLabelText('Barcode'), { target: { value: '085391163923' } });
      fireEvent.click(screen.getByRole('button', { name: 'Look up' }));

      expect(await screen.findByRole('button', { name: 'Looking up…' })).toBeDisabled();
      reject(new Error('UPC lookup daily limit reached'));
      expect(await screen.findByText('UPC lookup daily limit reached')).toBeInTheDocument();
    });

    it('reports when the barcode has no match', async () => {
      lookupUpcMock.mockResolvedValueOnce({ found: false, code: '12345678' });
      render(<DiscEditDialog open disc={null} onClose={vi.fn()} onSaved={vi.fn()} />);

      fireEvent.change(screen.getByLabelText('Barcode'), { target: { value: '12345678' } });
      fireEvent.click(screen.getByRole('button', { name: 'Look up' }));

      expect(await screen.findByText('No match found for barcode 12345678.')).toBeInTheDocument();
    });
  });

  describe('cover scan', () => {
    const photo = new File(['img'], 'cover.jpg', { type: 'image/jpeg' });

    it('uploads the photo and shows which fields it filled', async () => {
      scanCoverMock.mockResolvedValueOnce({
        found: true, verified: true, title: 'Jaws', year: '1975', format: 'DVD', edition: null, confidence: 'high',
      });
      render(<DiscEditDialog open disc={null} onClose={vi.fn()} onSaved={vi.fn()} />);

      fireEvent.change(screen.getByLabelText('Cover photo'), { target: { files: [photo] } });

      expect(await screen.findByText('Cover scan filled: Title, Format. Year on cover: 1975.')).toBeInTheDocument();
      expect(scanCoverMock).toHaveBeenCalledWith(photo);
      expect(screen.getByLabelText('Title', { exact: false })).toHaveValue('Jaws');
    });

    it('shows an inline error when the scan fails', async () => {
      scanCoverMock.mockRejectedValueOnce(new Error('Cover scan timed out. Try again.'));
      render(<DiscEditDialog open disc={null} onClose={vi.fn()} onSaved={vi.fn()} />);

      fireEvent.change(screen.getByLabelText('Cover photo'), { target: { files: [photo] } });

      expect(await screen.findByText('Cover scan timed out. Try again.')).toBeInTheDocument();
    });
  });

  describe('save & add another', () => {
    it('saves, stays open, clears per-disc fields and keeps format/condition', async () => {
      const onSaved = vi.fn();
      const onClose = vi.fn();
      createDiscMock.mockResolvedValueOnce({ id: 'd1', title: 'Alien' });
      lookupUpcMock.mockResolvedValueOnce({ found: true, code: '12345678', title: 'Alien', format: 'DVD', looksLikeMedia: true });
      render(<DiscEditDialog open disc={null} onClose={onClose} onSaved={onSaved} />);

      fireEvent.change(screen.getByLabelText('Barcode'), { target: { value: '12345678' } });
      fireEvent.click(screen.getByRole('button', { name: 'Look up' }));
      await waitFor(() => {
        expect(screen.getByLabelText('Title', { exact: false })).toHaveValue('Alien');
      });
      fireEvent.click(screen.getByRole('button', { name: /save & add another/i }));

      expect(await screen.findByText('Saved "Alien". Ready for the next disc.')).toBeInTheDocument();
      expect(createDiscMock.mock.calls[0][0]).toMatchObject({ title: 'Alien', format: 'DVD', barcode: '12345678' });
      expect(onSaved).toHaveBeenCalled();
      expect(onClose).not.toHaveBeenCalled();
      expect(screen.getByLabelText('Title', { exact: false })).toHaveValue('');
      expect(screen.getByLabelText('Barcode')).toHaveValue('');
      expect(screen.getByText('DVD')).toBeInTheDocument();
    });

    it('is not offered when editing an existing disc', () => {
      render(<DiscEditDialog open disc={EXISTING_DISC} onClose={vi.fn()} onSaved={vi.fn()} />);
      expect(screen.queryByRole('button', { name: /save & add another/i })).not.toBeInTheDocument();
    });
  });
});
