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
    expect(screen.getByRole('alert')).toHaveTextContent('network down');
  });

  it('shows field errors under each invalid field and focuses the first one', async () => {
    render(<DiscEditDialog open disc={null} onClose={vi.fn()} onSaved={vi.fn()} />);

    fireEvent.change(screen.getByLabelText('Title', { exact: false }), { target: { value: 'Alien' } });
    fireEvent.change(screen.getByLabelText('Barcode'), { target: { value: '1234' } });
    fireEvent.change(screen.getByLabelText('Disc #'), { target: { value: '0' } });
    fireEvent.change(screen.getByLabelText('Release Date'), { target: { value: '2999-01-01' } });
    fireEvent.click(screen.getByRole('button', { name: /create disc/i }));

    await waitFor(() => {
      expect(screen.getByText('Barcode must be 8, 12 or 13 digits')).toBeInTheDocument();
    });
    expect(screen.getByText('Disc number must be a positive whole number')).toBeInTheDocument();
    expect(screen.getByText('Release date cannot be in the future')).toBeInTheDocument();
    expect(screen.getByLabelText('Barcode')).toHaveAttribute('aria-invalid', 'true');
    await waitFor(() => expect(screen.getByLabelText('Barcode')).toHaveFocus());
    expect(createDiscMock).not.toHaveBeenCalled();
  });

  it('sends a typed payload once the form is valid', async () => {
    render(<DiscEditDialog open disc={null} onClose={vi.fn()} onSaved={vi.fn()} />);

    fireEvent.change(screen.getByLabelText('Title', { exact: false }), { target: { value: '  Alien  ' } });
    fireEvent.change(screen.getByLabelText('Barcode'), { target: { value: '5051892001234' } });
    fireEvent.change(screen.getByLabelText('Disc #'), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('Purchase Date'), { target: { value: '2020-06-01' } });
    fireEvent.click(screen.getByRole('button', { name: /create disc/i }));

    await waitFor(() => expect(createDiscMock).toHaveBeenCalledTimes(1));
    expect(createDiscMock.mock.calls[0][0]).toMatchObject({
      title: 'Alien', barcode: '5051892001234', discNumber: 2, purchaseDate: '2020-06-01', regionCode: undefined,
    });
  });

  it('disables submit and shows progress while saving', async () => {
    let resolve!: (d: unknown) => void;
    createDiscMock.mockReturnValueOnce(new Promise((r) => { resolve = r; }));
    render(<DiscEditDialog open disc={null} onClose={vi.fn()} onSaved={vi.fn()} />);

    fireEvent.change(screen.getByLabelText('Title', { exact: false }), { target: { value: 'Alien' } });
    fireEvent.click(screen.getByRole('button', { name: /create disc/i }));

    const saving = await screen.findByRole('button', { name: /saving/i });
    expect(saving).toBeDisabled();
    expect(screen.getByRole('button', { name: /cancel/i })).toBeDisabled();

    resolve({ id: 'new-disc', title: 'Alien' });
    await waitFor(() => expect(screen.queryByRole('button', { name: /saving/i })).not.toBeInTheDocument());
  });

  it('asks before discarding unsaved changes on cancel', () => {
    const onClose = vi.fn();
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    render(<DiscEditDialog open disc={null} onClose={onClose} onSaved={vi.fn()} />);

    fireEvent.change(screen.getByLabelText('Title', { exact: false }), { target: { value: 'Draft' } });
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
    confirmSpy.mockRestore();
  });

  it('closes without asking when nothing changed', () => {
    const onClose = vi.fn();
    const confirmSpy = vi.spyOn(window, 'confirm');
    render(<DiscEditDialog open disc={EXISTING_DISC} onClose={onClose} onSaved={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
    confirmSpy.mockRestore();
  });

  it('warns before leaving the page while there are unsaved changes', () => {
    render(<DiscEditDialog open disc={null} onClose={vi.fn()} onSaved={vi.fn()} />);
    const before = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(before);
    expect(before.defaultPrevented).toBe(false);

    fireEvent.change(screen.getByLabelText('Title', { exact: false }), { target: { value: 'Draft' } });
    const after = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(after);
    expect(after.defaultPrevented).toBe(true);
  });
});
