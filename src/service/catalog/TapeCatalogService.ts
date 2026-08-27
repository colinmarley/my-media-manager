/**
 * CRUD helpers for the physical tape catalog — mirrors DiscCatalogService.ts.
 * 'tapes' isn't in CatalogService's CATALOG_COLLECTIONS set, so that
 * generic class would route tape requests to /api/data/tapes instead of
 * /api/catalog/tapes; this dedicated service avoids that trap entirely.
 */
import { api } from '../api/apiClient';
import { CatalogTape } from '../../types/catalog/Tape.type';

export async function searchTapes(params: { title?: string; tapeLabel?: string }): Promise<CatalogTape[]> {
  if (!params.title && !params.tapeLabel) return [];
  const query = new URLSearchParams();
  if (params.title) query.set('title', params.title);
  if (params.tapeLabel) query.set('tape_label', params.tapeLabel);
  try {
    return await api.get<CatalogTape[]>(`/api/catalog/tapes/search?${query.toString()}`);
  } catch (e) {
    console.error('Error searching tapes:', e);
    return [];
  }
}

export async function createTape(data: Partial<CatalogTape>): Promise<CatalogTape> {
  return api.post<CatalogTape>('/api/catalog/tapes', data);
}

export async function updateTape(id: string, data: Partial<CatalogTape>): Promise<CatalogTape> {
  return api.put<CatalogTape>(`/api/catalog/tapes/${id}`, { ...data, id });
}

export async function deleteTape(id: string): Promise<void> {
  await api.delete(`/api/catalog/tapes/${id}`);
}
