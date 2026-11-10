import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';

import WishlistPage from '../../src/app/dashboard/wishlist/page';
import WishlistAddDialog from '../../src/app/dashboard/wishlist/_components/WishlistAddDialog';
import { NotificationProvider } from '../../src/context/NotificationContext';

const listWishlistMock = vi.fn();
const addWishlistItemMock = vi.fn();
const deleteWishlistItemMock = vi.fn();

vi.mock('../../src/service/catalog/WishlistService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/service/catalog/WishlistService')>();
  return {
    ...actual,
    listWishlist: (...args: unknown[]) => listWishlistMock(...args),
    addWishlistItem: (...args: unknown[]) => addWishlistItemMock(...args),
    deleteWishlistItem: (...args: unknown[]) => deleteWishlistItemMock(...args),
  };
});

const ITEMS = [
  { id: 'a', title: 'Oldest Film', format: 'DVD', year: '1999' },
  { id: 'b', title: 'Newer Film', barcode: '12345678' },
];

const renderPage = () => render(<NotificationProvider><WishlistPage /></NotificationProvider>);

describe('WishlistPage', () => {
  beforeEach(() => {
    listWishlistMock.mockReset().mockResolvedValue(ITEMS);
    addWishlistItemMock.mockReset();
    deleteWishlistItemMock.mockReset().mockResolvedValue(undefined);
  });

  it('lists wishlist items oldest first, in the order the service returns', async () => {
    renderPage();
    const list = await screen.findByRole('list', { name: 'Wishlist items' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows[0]).toHaveTextContent('Oldest Film');
    expect(rows[1]).toHaveTextContent('Newer Film');
    expect(listWishlistMock).toHaveBeenCalledTimes(1);
  });

  it('asks for confirmation before removing, and does nothing on cancel', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Remove Oldest Film' }));
    expect(await screen.findByText('Remove from wishlist?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByText('Remove from wishlist?')).not.toBeInTheDocument());
    expect(deleteWishlistItemMock).not.toHaveBeenCalled();
    expect(screen.getByText('Oldest Film')).toBeInTheDocument();
  });

  it('removes the item after confirmation', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Remove Oldest Film' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(deleteWishlistItemMock).toHaveBeenCalledWith('a'));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Remove Oldest Film' })).not.toBeInTheDocument());
  });

  it('shows a failed removal in the snackbar and keeps the item', async () => {
    deleteWishlistItemMock.mockRejectedValue(new Error('API error 404: not found'));
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Remove Oldest Film' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Remove' }));
    const alert = await screen.findByText('API error 404: not found');
    expect(alert.closest('.MuiSnackbar-root')).not.toBeNull();
    expect(screen.getByText('Oldest Film')).toBeInTheDocument();
  });

  it('appends a newly added item to the end of the list', async () => {
    addWishlistItemMock.mockResolvedValue({ id: 'c', title: 'Brand New' });
    renderPage();
    await screen.findByText('Oldest Film');
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    fireEvent.change(screen.getByLabelText('Title', { exact: false }), { target: { value: 'Brand New' } });
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Add' }));
    await waitFor(() => {
      const rows = within(screen.getByRole('list', { name: 'Wishlist items' })).getAllByRole('listitem');
      expect(rows[2]).toHaveTextContent('Brand New');
    });
  });
});

describe('WishlistAddDialog', () => {
  beforeEach(() => {
    addWishlistItemMock.mockReset().mockResolvedValue({ id: 'n', title: 'Heat' });
  });

  const fill = (label: string, value: string) =>
    fireEvent.change(screen.getByLabelText(label, { exact: false }), { target: { value } });

  it('does not save without a title', async () => {
    render(<WishlistAddDialog open onClose={vi.fn()} onSaved={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(await screen.findByText('Title is required')).toBeInTheDocument();
    expect(addWishlistItemMock).not.toHaveBeenCalled();
  });

  it('blocks an invalid barcode and imdbId', async () => {
    render(<WishlistAddDialog open onClose={vi.fn()} onSaved={vi.fn()} />);
    fill('Title', 'Heat');
    fill('Barcode', '1234');
    fill('IMDb ID', 'nm0000158');
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(await screen.findByText('Barcode must be 8–14 digits')).toBeInTheDocument();
    expect(screen.getByText('IMDb ID must be "tt" followed by digits')).toBeInTheDocument();
    expect(addWishlistItemMock).not.toHaveBeenCalled();
  });

  it('blocks a title over 300 characters', async () => {
    render(<WishlistAddDialog open onClose={vi.fn()} onSaved={vi.fn()} />);
    fill('Title', 'a'.repeat(301));
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(await screen.findByText(/at most 300/)).toBeInTheDocument();
    expect(addWishlistItemMock).not.toHaveBeenCalled();
  });

  it('sends the trimmed fields and omits empty optional ones', async () => {
    const onSaved = vi.fn();
    const onClose = vi.fn();
    render(<WishlistAddDialog open onClose={onClose} onSaved={onSaved} />);
    fill('Title', '  Heat  ');
    fill('Format', 'Blu-ray');
    fill('Year', '1995');
    fill('Barcode', '012345678905');
    fill('IMDb ID', 'tt0113277');
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(addWishlistItemMock).toHaveBeenCalledWith({
      title: 'Heat', format: 'Blu-ray', year: '1995', barcode: '012345678905', imdbId: 'tt0113277',
      notes: undefined,
    }));
    expect(onSaved).toHaveBeenCalledWith({ id: 'n', title: 'Heat' });
    expect(onClose).toHaveBeenCalled();
  });

  it('shows a backend error inline and stays open', async () => {
    addWishlistItemMock.mockRejectedValue(new Error('API error 422: bad'));
    const onClose = vi.fn();
    render(<WishlistAddDialog open onClose={onClose} onSaved={vi.fn()} />);
    fill('Title', 'Heat');
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(await screen.findByText('API error 422: bad')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });
});
