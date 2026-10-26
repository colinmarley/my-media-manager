/** Mirrors WishlistItemIn / the stored document in backend/api/wishlist.py. */
export interface WishlistItemInput {
  title: string;
  format?: string;
  year?: string;
  barcode?: string;
  imdbId?: string;
  notes?: string;
}

export interface WishlistItem extends WishlistItemInput {
  id: string;
  createdAt?: string;
}
