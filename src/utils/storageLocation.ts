/**
 * Box/Binder storage locations ("where does this disc/tape live"), shared by
 * the physical-media edit dialogs, detail page and list filter. IDs follow
 * the MED#### convention the mobile app uses (see COLLECTION_CATALOGUING_WORKFLOW.md).
 */
import { StorageType } from '@/types/catalog/Common.type';

export const STORAGE_TYPES: StorageType[] = ['Box', 'Binder'];
export const STORAGE_ID_PATTERN = /^MED\d{4}$/;

type Located = { storageType?: StorageType | null; storageId?: string | null };

export function normalizeStorageId(value: string): string {
  return value.trim().toUpperCase();
}

/** Error message for a type/id pair, or '' when it can be saved. `previousId`
 * lets an item keep an ID saved before the MED#### rule existed. */
export function validateStorageLocation(
  storageType: StorageType | '',
  storageId: string,
  previousId?: string | null,
): string {
  const id = normalizeStorageId(storageId);
  if (!storageType) return id ? 'Pick Box or Binder for the storage ID, or clear the ID.' : '';
  if (!id) return `Enter the ${storageType} ID (e.g. MED0001).`;
  if (STORAGE_ID_PATTERN.test(id) || (previousId && id === previousId.trim().toUpperCase())) return '';
  return 'Storage ID must look like MED0001 (MED followed by 4 digits).';
}

/** The payload fields for a location; both null clears it. An unchanged
 * `previousId` is sent exactly as stored: the backend compares IDs
 * case-sensitively, so re-casing it would move the item to another location. */
export function storageLocationPayload(
  storageType: StorageType | '',
  storageId: string,
  previousId?: string | null,
) {
  if (!storageType) return { storageType: null, storageId: null };
  const id = normalizeStorageId(storageId);
  const keep = previousId && id === normalizeStorageId(previousId);
  return { storageType, storageId: keep ? previousId : id };
}

export function formatStorageLocation(item: Located): string {
  return item.storageType && item.storageId ? `${item.storageType} ${item.storageId}` : '';
}

/** Filter values: '' = everything, 'none' = no location, otherwise "Box:MED0001". */
export const NO_LOCATION = 'none';

export function storageLocationKey(item: Located): string {
  return item.storageType && item.storageId ? `${item.storageType}:${item.storageId}` : '';
}

export function filterByStorageLocation<T extends Located>(items: T[], filter: string): T[] {
  if (!filter) return items;
  if (filter === NO_LOCATION) return items.filter((i) => !storageLocationKey(i));
  return items.filter((i) => storageLocationKey(i) === filter);
}

/** Distinct locations across the given items, Boxes first, then by ID. */
export function listStorageLocations(items: Located[]): { key: string; label: string }[] {
  const seen = new Map<string, Located>();
  items.forEach((i) => {
    const key = storageLocationKey(i);
    if (key && !seen.has(key)) seen.set(key, i);
  });
  return [...seen.entries()]
    .sort(([, a], [, b]) =>
      (a.storageType === 'Box' ? 0 : 1) - (b.storageType === 'Box' ? 0 : 1)
      || (a.storageId ?? '').localeCompare(b.storageId ?? ''))
    .map(([key, i]) => ({ key, label: formatStorageLocation(i) }));
}
