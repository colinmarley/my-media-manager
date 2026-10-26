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

  it('does not save a loan returned before it started', async () => {
    render(<DiscEditDialog open disc={EXISTING_DISC} onClose={vi.fn()} onSaved={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Lent to'), { target: { value: 'Ana' } });
    fireEvent.change(screen.getByLabelText('Since'), { target: { value: '2026-01-10' } });
    fireEvent.change(screen.getByLabelText('Returned on'), { target: { value: '2026-01-09' } });
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => {
      expect(screen.getByText(/can't be before/)).toBeInTheDocument();
    });
    expect(updateDiscMock).not.toHaveBeenCalled();
  });

  it('saves who the disc is lent to and since when', async () => {
    render(<DiscEditDialog open disc={EXISTING_DISC} onClose={vi.fn()} onSaved={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Lent to'), { target: { value: 'Ana' } });
    fireEvent.change(screen.getByLabelText('Since'), { target: { value: '2026-01-10' } });
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => {
      expect(updateDiscMock).toHaveBeenCalledTimes(1);
    });
    expect(updateDiscMock.mock.calls[0][1]).toMatchObject({
      loanedTo: 'Ana', loanedAt: '2026-01-10', returnedAt: null,
    });
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

    it('warns instead of filling when the barcode is not a disc', async () => {
      lookupUpcMock.mockResolvedValueOnce({
        found: true, code: '12345678', title: 'Tortilla Chips', rawTitle: 'Tortilla Chips 12oz', format: null, looksLikeMedia: false,
      });
      render(<DiscEditDialog open disc={null} onClose={vi.fn()} onSaved={vi.fn()} />);

      fireEvent.change(screen.getByLabelText('Barcode'), { target: { value: '12345678' } });
      fireEvent.click(screen.getByRole('button', { name: 'Look up' }));

      expect(await screen.findByText(/doesn't look like a disc/)).toBeInTheDocument();
      expect(screen.getByLabelText('Title', { exact: false })).toHaveValue('');
    });

    it('rejects a malformed barcode without calling the service', () => {
      render(<DiscEditDialog open disc={null} onClose={vi.fn()} onSaved={vi.fn()} />);

      fireEvent.change(screen.getByLabelText('Barcode'), { target: { value: 'abc' } });
      fireEvent.click(screen.getByRole('button', { name: 'Look up' }));

      expect(screen.getByText('Enter an 8–14 digit barcode to look up.')).toBeInTheDocument();
      expect(lookupUpcMock).not.toHaveBeenCalled();
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

    it('does not overwrite a typed title, and shows a loading state', async () => {
      let resolve!: (v: unknown) => void;
      scanCoverMock.mockReturnValueOnce(new Promise((r) => { resolve = r; }));
      render(<DiscEditDialog open disc={null} onClose={vi.fn()} onSaved={vi.fn()} />);

      const titleInput = screen.getByLabelText('Title', { exact: false });
      fireEvent.change(titleInput, { target: { value: 'My Jaws' } });
      fireEvent.change(screen.getByLabelText('Cover photo'), { target: { files: [photo] } });
      expect(await screen.findByText('Scanning…')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Look up' })).toBeDisabled();

      resolve({ found: true, verified: true, title: 'Jaws', year: null, format: null, edition: null, confidence: 'high' });
      expect(await screen.findByText(/Lookup suggests different values/)).toBeInTheDocument();
      expect(titleInput).toHaveValue('My Jaws');
      fireEvent.click(screen.getByRole('button', { name: 'Keep mine' }));
      expect(titleInput).toHaveValue('My Jaws');
      expect(screen.queryByText(/Lookup suggests different values/)).not.toBeInTheDocument();
    });

    it('does not overwrite a title typed while the scan is running', async () => {
      let resolve!: (v: unknown) => void;
      scanCoverMock.mockReturnValueOnce(new Promise((r) => { resolve = r; }));
      render(<DiscEditDialog open disc={null} onClose={vi.fn()} onSaved={vi.fn()} />);

      fireEvent.change(screen.getByLabelText('Cover photo'), { target: { files: [photo] } });
      expect(await screen.findByText('Scanning…')).toBeInTheDocument();
      const titleInput = screen.getByLabelText('Title', { exact: false });
      fireEvent.change(titleInput, { target: { value: 'Typed While Waiting' } });

      resolve({ found: true, verified: true, title: 'Jaws', year: null, format: 'DVD', edition: null, confidence: 'high' });
      expect(await screen.findByText(/Lookup suggests different values/)).toBeInTheDocument();
      expect(titleInput).toHaveValue('Typed While Waiting');
      expect(screen.getByText('Cover scan filled: Format.')).toBeInTheDocument();
    });

    it('ignores a scan result that arrives after "Save & add another"', async () => {
      let resolve!: (v: unknown) => void;
      scanCoverMock.mockReturnValueOnce(new Promise((r) => { resolve = r; }));
      createDiscMock.mockResolvedValueOnce({ id: 'd1', title: 'Alien' });
      render(<DiscEditDialog open disc={null} onClose={vi.fn()} onSaved={vi.fn()} />);

      fireEvent.change(screen.getByLabelText('Title', { exact: false }), { target: { value: 'Alien' } });
      fireEvent.change(screen.getByLabelText('Cover photo'), { target: { files: [photo] } });
      expect(await screen.findByText('Scanning…')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: /save & add another/i }));
      await screen.findByText('Saved "Alien". Ready for the next disc.');
      expect(screen.getByText('Scan cover')).toBeInTheDocument();

      resolve({ found: true, verified: true, title: 'Jaws', year: null, format: 'DVD', edition: null, confidence: 'high' });
      await new Promise((r) => setTimeout(r, 0));
      expect(screen.getByLabelText('Title', { exact: false })).toHaveValue('');
      expect(screen.queryByText(/Cover scan filled/)).not.toBeInTheDocument();
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

    it('keeps the chosen condition for the next entry', async () => {
      createDiscMock.mockResolvedValue({ id: 'd1', title: 'Alien' });
      render(<DiscEditDialog open disc={null} onClose={vi.fn()} onSaved={vi.fn()} />);

      fireEvent.change(screen.getByLabelText('Title', { exact: false }), { target: { value: 'Alien' } });
      fireEvent.mouseDown(screen.getAllByRole('combobox')[1]);
      fireEvent.click(await screen.findByRole('option', { name: 'Good' }));
      fireEvent.click(screen.getByRole('button', { name: /save & add another/i }));
      await screen.findByText('Saved "Alien". Ready for the next disc.');
      expect(createDiscMock.mock.calls[0][0]).toMatchObject({ condition: 'Good' });

      fireEvent.change(screen.getByLabelText('Title', { exact: false }), { target: { value: 'Aliens' } });
      fireEvent.click(screen.getByRole('button', { name: /save & add another/i }));
      await waitFor(() => expect(createDiscMock).toHaveBeenCalledTimes(2));
      expect(createDiscMock.mock.calls[1][0]).toMatchObject({ title: 'Aliens', condition: 'Good' });
    });

    it('is not offered when editing an existing disc', () => {
      render(<DiscEditDialog open disc={EXISTING_DISC} onClose={vi.fn()} onSaved={vi.fn()} />);
      expect(screen.queryByRole('button', { name: /save & add another/i })).not.toBeInTheDocument();
    });
  });

  describe('storage location', () => {
    const pickStorage = async (name: string) => {
      fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Storage' }));
      fireEvent.click(await screen.findByRole('option', { name }));
    };

    it('saves a Box location with a normalized MED#### code', async () => {
      render(<DiscEditDialog open disc={null} onClose={vi.fn()} onSaved={vi.fn()} />);
      fireEvent.change(screen.getByLabelText('Title', { exact: false }), { target: { value: 'Alien' } });
      await pickStorage('Box');
      fireEvent.change(screen.getByLabelText('Storage ID'), { target: { value: ' med0012 ' } });
      fireEvent.click(screen.getByRole('button', { name: /create disc/i }));

      await waitFor(() => expect(createDiscMock).toHaveBeenCalledTimes(1));
      expect(createDiscMock.mock.calls[0][0]).toMatchObject({ storageType: 'Box', storageId: 'MED0012' });
    });

    it('blocks saving a malformed code', async () => {
      render(<DiscEditDialog open disc={null} onClose={vi.fn()} onSaved={vi.fn()} />);
      fireEvent.change(screen.getByLabelText('Title', { exact: false }), { target: { value: 'Alien' } });
      await pickStorage('Binder');
      fireEvent.change(screen.getByLabelText('Storage ID'), { target: { value: 'MED12' } });
      fireEvent.click(screen.getByRole('button', { name: /create disc/i }));

      expect(await screen.findByText(/must look like MED0001/)).toBeInTheDocument();
      expect(createDiscMock).not.toHaveBeenCalled();
    });

    it('pre-fills and clears an existing location', async () => {
      const disc: CatalogDisc = { ...EXISTING_DISC, storageType: 'Binder', storageId: 'MED0003' };
      render(<DiscEditDialog open disc={disc} onClose={vi.fn()} onSaved={vi.fn()} />);
      expect(screen.getByLabelText('Storage ID')).toHaveValue('MED0003');

      await pickStorage('None');
      expect(screen.getByLabelText('Storage ID')).toHaveValue('');
      fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

      await waitFor(() => expect(updateDiscMock).toHaveBeenCalledTimes(1));
      expect(updateDiscMock.mock.calls[0][1]).toMatchObject({ storageType: null, storageId: null });
    });

    it('keeps an older non-MED#### ID unchanged when only the title is edited', async () => {
      const disc: CatalogDisc = { ...EXISTING_DISC, storageType: 'Box', storageId: 'Shelf A' };
      render(<DiscEditDialog open disc={disc} onClose={vi.fn()} onSaved={vi.fn()} />);
      fireEvent.change(screen.getByLabelText('Title', { exact: false }), { target: { value: 'Aliens' } });
      fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

      await waitFor(() => expect(updateDiscMock).toHaveBeenCalledTimes(1));
      expect(updateDiscMock.mock.calls[0][1]).toMatchObject({ title: 'Aliens', storageType: 'Box', storageId: 'Shelf A' });
    });
  });
});
