/**
 * Wishlist helpers — backed by backend/api/wishlist.py (GET list oldest
 * first, POST add, DELETE /{id}), the same endpoints the mobile app uses.
 */
import { api } from '../api/apiClient';
import { WishlistItem, WishlistItemInput } from '../../types/catalog/Wishlist.type';

export const WISHLIST_LIMITS = {
  title: 300,
  format: 40,
  year: 10,
  notes: 1000,
} as const;

/**
 * Client-side copy of the backend's WishlistItemIn rules. Returns field ->
 * message for every rule broken; an empty object means the input is valid.
 */
export function validateWishlistItem(input: WishlistItemInput): Partial<Record<keyof WishlistItemInput, string>> {
  const errors: Partial<Record<keyof WishlistItemInput, string>> = {};
  const title = input.title.trim();
  if (!title) errors.title = 'Title is required';
  else if (title.length > WISHLIST_LIMITS.title) errors.title = `Title must be at most ${WISHLIST_LIMITS.title} characters`;
  if (input.barcode && !/^\d{8,14}$/.test(input.barcode)) errors.barcode = 'Barcode must be 8–14 digits';
  if (input.imdbId && !/^tt\d+$/.test(input.imdbId)) errors.imdbId = 'IMDb ID must be "tt" followed by digits';
  if (input.format && input.format.length > WISHLIST_LIMITS.format) errors.format = `Format must be at most ${WISHLIST_LIMITS.format} characters`;
  if (input.year && input.year.length > WISHLIST_LIMITS.year) errors.year = `Year must be at most ${WISHLIST_LIMITS.year} characters`;
  if (input.notes && input.notes.length > WISHLIST_LIMITS.notes) errors.notes = `Notes must be at most ${WISHLIST_LIMITS.notes} characters`;
  return errors;
}

export async function listWishlist(): Promise<WishlistItem[]> {
  return api.get<WishlistItem[]>('/api/wishlist');
}

export async function addWishlistItem(data: WishlistItemInput): Promise<WishlistItem> {
  return api.post<WishlistItem>('/api/wishlist', data);
}

export async function deleteWishlistItem(id: string): Promise<void> {
  await api.delete(`/api/wishlist/${encodeURIComponent(id)}`);
}
