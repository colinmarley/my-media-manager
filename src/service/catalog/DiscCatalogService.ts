/**
 * Search/create helpers for the physical disc catalog, used by the disc-ripper
 * "link to catalog disc" flow. Complements CatalogService (which handles
 * get/update/delete-by-id) with the search and server-generated-id create
 * endpoints added for cross-service linking (see backend/api/catalog.py).
 */
import { api } from '../api/apiClient';
import { CatalogDisc } from '../../types/catalog/Disc.type';

export async function searchDiscs(params: { title?: string; barcode?: string }): Promise<CatalogDisc[]> {
  if (!params.title && !params.barcode) return [];
  const query = new URLSearchParams();
  if (params.title) query.set('title', params.title);
  if (params.barcode) query.set('barcode', params.barcode);
  try {
    return await api.get<CatalogDisc[]>(`/api/catalog/discs/search?${query.toString()}`);
  } catch (e) {
    console.error('Error searching discs:', e);
    return [];
  }
}

export async function createDisc(data: Partial<CatalogDisc>): Promise<CatalogDisc> {
  return api.post<CatalogDisc>('/api/catalog/discs', data);
}

export async function updateDisc(id: string, data: Partial<CatalogDisc>): Promise<CatalogDisc> {
  return api.put<CatalogDisc>(`/api/catalog/discs/${id}`, { ...data, id });
}

export async function deleteDisc(id: string): Promise<void> {
  await api.delete(`/api/catalog/discs/${id}`);
}
