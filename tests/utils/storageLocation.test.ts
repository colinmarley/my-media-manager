import { describe, it, expect } from 'vitest';
import {
  filterByStorageLocation, formatStorageLocation, listStorageLocations, NO_LOCATION,
  storageLocationPayload, validateStorageLocation,
} from '../../src/utils/storageLocation';
import { StorageType } from '../../src/types/catalog/Common.type';

describe('validateStorageLocation', () => {
  it('accepts no location at all', () => {
    expect(validateStorageLocation('', '')).toBe('');
  });

  it('accepts a MED#### code, ignoring case and surrounding spaces', () => {
    expect(validateStorageLocation('Box', 'MED0001')).toBe('');
    expect(validateStorageLocation('Binder', ' med0420 ')).toBe('');
  });

  it.each(['MED1', 'MED00001', 'BOX0001', 'MED-0001', 'MED000A'])('rejects %s', (id) => {
    expect(validateStorageLocation('Box', id)).toMatch(/MED0001/);
  });

  it('requires an ID once a type is picked', () => {
    expect(validateStorageLocation('Binder', '  ')).toMatch(/Binder ID/);
  });

  it('requires a type when an ID is given', () => {
    expect(validateStorageLocation('', 'MED0001')).toMatch(/Box or Binder/);
  });

  it('lets an item keep an ID saved before the MED#### rule', () => {
    expect(validateStorageLocation('Box', 'Shelf A', 'Shelf A')).toBe('');
    expect(validateStorageLocation('Box', 'Shelf B', 'Shelf A')).not.toBe('');
  });
});

describe('storageLocationPayload', () => {
  it('normalizes the ID', () => {
    expect(storageLocationPayload('Box', ' med0001 ')).toEqual({ storageType: 'Box', storageId: 'MED0001' });
  });

  it('sends explicit nulls to clear the location', () => {
    expect(storageLocationPayload('', 'MED0001')).toEqual({ storageType: null, storageId: null });
  });
});

describe('location filter', () => {
  const items: { id: string; storageType?: StorageType | null; storageId?: string | null }[] = [
    { id: 'a', storageType: 'Binder', storageId: 'MED0002' },
    { id: 'b', storageType: 'Box', storageId: 'MED0009' },
    { id: 'c' },
    { id: 'd', storageType: 'Box', storageId: 'MED0001' },
    { id: 'e', storageType: 'Box', storageId: 'MED0009' },
    { id: 'f', storageType: 'Box', storageId: null },
  ];

  it('returns everything with no filter', () => {
    expect(filterByStorageLocation(items, '')).toHaveLength(items.length);
  });

  it('matches a single box or binder', () => {
    expect(filterByStorageLocation(items, 'Box:MED0009').map((i) => i.id)).toEqual(['b', 'e']);
    expect(filterByStorageLocation(items, 'Binder:MED0002').map((i) => i.id)).toEqual(['a']);
    expect(filterByStorageLocation(items, 'Binder:MED0009')).toEqual([]);
  });

  it('finds items with no location', () => {
    expect(filterByStorageLocation(items, NO_LOCATION).map((i) => i.id)).toEqual(['c', 'f']);
  });

  it('lists each location once, boxes first', () => {
    expect(listStorageLocations(items)).toEqual([
      { key: 'Box:MED0001', label: 'Box MED0001' },
      { key: 'Box:MED0009', label: 'Box MED0009' },
      { key: 'Binder:MED0002', label: 'Binder MED0002' },
    ]);
  });

  it('formats a location for display', () => {
    expect(formatStorageLocation(items[0])).toBe('Binder MED0002');
    expect(formatStorageLocation(items[2])).toBe('');
  });
});
