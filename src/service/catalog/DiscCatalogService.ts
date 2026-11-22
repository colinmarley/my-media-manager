/**
 * Search/create helpers for the physical disc catalog, used by the disc-ripper
 * "link to catalog disc" flow. Complements CatalogService (which handles
 * get/update/delete-by-id) with the search and server-generated-id create
 * endpoints added for cross-service linking (see backend/api/catalog.py).
 */
import { api } from '../api/apiClient';
import { CatalogDisc, CatalogRelease } from '../../types/catalog/Disc.type';
import type { StoredRip } from '../../types/disc-ripper/DiscRipper.type';

/** Earlier rips of the disc with this fingerprint; empty when none or the lookup fails. */
export async function findRipsByFingerprint(fingerprint: string): Promise<StoredRip[]> {
  if (!fingerprint) return [];
  try {
    return await api.get<StoredRip[]>(`/api/rips?fingerprint=${encodeURIComponent(fingerprint)}`);
  } catch {
    return [];
  }
}

export async function getDisc(id: string): Promise<CatalogDisc | null> {
  try {
    return await api.get<CatalogDisc>(`/api/catalog/discs/${encodeURIComponent(id)}`);
  } catch {
    return null;
  }
}

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

/** Change only the fields given; everything else on the record is kept. */
export async function mergeDisc(id: string, data: Partial<CatalogDisc>): Promise<CatalogDisc> {
  return api.put<CatalogDisc>(`/api/catalog/discs/${encodeURIComponent(id)}?merge=true`, data);
}

// ── Releases (the box or case a disc came in) ───────────────────────────────

/** Boxes and cases by name, for a disc from a box that is already catalogued. */
export async function searchReleases(title: string): Promise<Pick<CatalogRelease, 'id' | 'title'>[]> {
  if (!title.trim()) return [];
  try {
    return await api.get<Pick<CatalogRelease, 'id' | 'title'>[]>(
      `/api/catalog/disc-sets?title=${encodeURIComponent(title.trim())}`,
    );
  } catch {
    return [];
  }
}

export async function getRelease(id: string): Promise<CatalogRelease | null> {
  try {
    return await api.get<CatalogRelease>(`/api/catalog/releases/${encodeURIComponent(id)}`);
  } catch {
    return null;
  }
}

/** Create a release together with its first disc(s). */
export async function createRelease(
  data: Omit<Partial<CatalogRelease>, 'discs'> & { discs: Partial<CatalogDisc>[] },
): Promise<CatalogRelease> {
  return api.post<CatalogRelease>('/api/catalog/releases', data);
}

export async function updateRelease(id: string, data: Partial<CatalogRelease>): Promise<CatalogRelease> {
  return api.put<CatalogRelease>(`/api/catalog/releases/${encodeURIComponent(id)}`, data);
}
