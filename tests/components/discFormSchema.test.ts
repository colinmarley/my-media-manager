import { describe, it, expect } from 'vitest';

import {
  discFormSchema, toDiscFormValues, toDiscPayload, DiscFormValues,
} from '../../src/app/dashboard/physical-media/_components/discFormSchema';

const valid = (overrides: Partial<DiscFormValues> = {}): DiscFormValues => ({
  ...toDiscFormValues(null),
  title: 'Alien',
  ...overrides,
});

function errorFor(values: DiscFormValues, field: keyof DiscFormValues): string | undefined {
  const result = discFormSchema.safeParse(values);
  if (result.success) return undefined;
  return result.error.issues.find((i) => i.path[0] === field)?.message;
}

describe('discFormSchema', () => {
  it('accepts a minimal disc with only a title', () => {
    expect(discFormSchema.safeParse(valid()).success).toBe(true);
  });

  it('requires a non-blank title and trims it', () => {
    expect(errorFor(valid({ title: '' }), 'title')).toBe('Title is required');
    expect(errorFor(valid({ title: '   ' }), 'title')).toBe('Title is required');
    expect(discFormSchema.parse(valid({ title: '  Alien  ' })).title).toBe('Alien');
  });

  it.each(['12345678', '085391163923', '5051892001234', ''])('accepts barcode %j', (barcode) => {
    expect(errorFor(valid({ barcode }), 'barcode')).toBeUndefined();
  });

  it.each(['1234567', '1234567890', '12345678901234', '08539116392X', '0853 91163923'])('rejects barcode %j', (barcode) => {
    expect(errorFor(valid({ barcode }), 'barcode')).toBe('Barcode must be 8, 12 or 13 digits');
  });

  it.each(['1', '2', '12'])('accepts disc number %j', (discNumber) => {
    expect(errorFor(valid({ discNumber }), 'discNumber')).toBeUndefined();
  });

  it.each(['0', '-1', '1.5', 'abc'])('rejects disc number %j', (discNumber) => {
    expect(errorFor(valid({ discNumber }), 'discNumber')).toBe('Disc number must be a positive whole number');
  });

  it('only allows regions from the allowed list', () => {
    expect(errorFor(valid({ regionCode: '1' }), 'regionCode')).toBeUndefined();
    expect(errorFor(valid({ regionCode: 'B' }), 'regionCode')).toBeUndefined();
    expect(errorFor(valid({ regionCode: '9' }), 'regionCode')).toBe('Choose a valid region');
    expect(errorFor(valid({ regionCode: 'Region 1' }), 'regionCode')).toBe('Choose a valid region');
  });

  it('rejects invalid and future dates', () => {
    expect(errorFor(valid({ purchaseDate: '2020-01-15' }), 'purchaseDate')).toBeUndefined();
    expect(errorFor(valid({ purchaseDate: '2021-02-30' }), 'purchaseDate')).toBe('Purchase date must be a valid date');
    expect(errorFor(valid({ purchaseDate: 'yesterday' }), 'purchaseDate')).toBe('Purchase date must be a valid date');
    expect(errorFor(valid({ releaseDate: '2999-01-01' }), 'releaseDate')).toBe('Release date cannot be in the future');
  });

  it('accepts today as a date', () => {
    const d = new Date();
    const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    expect(errorFor(valid({ releaseDate: today }), 'releaseDate')).toBeUndefined();
  });

  it('maps parsed values to an API payload, dropping empty fields', () => {
    const parsed = discFormSchema.parse(valid({ discNumber: '2', barcode: ' 12345678 ', isRentalDisc: true }));
    expect(toDiscPayload(parsed)).toEqual({
      title: 'Alien',
      format: undefined,
      barcode: '12345678',
      condition: undefined,
      regionCode: undefined,
      discNumber: 2,
      language: undefined,
      purchaseDate: undefined,
      releaseDate: undefined,
      isPartOfSet: false,
      isRentalDisc: true,
      containsSpecialFeatures: false,
    });
  });
});
