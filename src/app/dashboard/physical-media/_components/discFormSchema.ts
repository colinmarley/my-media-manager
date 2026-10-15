import { z } from 'zod';
import { CatalogDisc } from '@/types/catalog/Disc.type';
import { DiscCondition, DiscFormat } from '@/types/catalog/Common.type';

export const DISC_FORMATS = ['DVD', 'BLURAY', 'HD_DVD', 'UHD_BLURAY', 'LASERDISC'] as const satisfies readonly DiscFormat[];
export const DISC_CONDITIONS = ['Mint', 'Good', 'Fair', 'Poor'] as const satisfies readonly DiscCondition[];
// DVD regions 0–8, Blu-ray regions A/B/C, and ABC for region-free Blu-ray.
export const DISC_REGIONS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', 'A', 'B', 'C', 'ABC'] as const;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function todayIso(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function isRealDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

const optionalPastDate = (label: string) => z.string()
  .refine((v) => v === '' || isRealDate(v), { error: `${label} must be a valid date` })
  .refine((v) => v === '' || !isRealDate(v) || v <= todayIso(), { error: `${label} cannot be in the future` });

const optionalOneOf = <T extends readonly string[]>(values: T, error: string) => z.string()
  .refine((v) => v === '' || (values as readonly string[]).includes(v), { error });

/** Form values are kept as strings so inputs stay controlled; see toDiscPayload for the API shape. */
export const discFormSchema = z.object({
  title: z.string().trim().min(1, { error: 'Title is required' }),
  format: optionalOneOf(DISC_FORMATS, 'Choose a valid format'),
  condition: optionalOneOf(DISC_CONDITIONS, 'Choose a valid condition'),
  barcode: z.string().trim()
    .refine((v) => v === '' || /^(\d{8}|\d{12}|\d{13})$/.test(v), { error: 'Barcode must be 8, 12 or 13 digits' }),
  regionCode: optionalOneOf(DISC_REGIONS, 'Choose a valid region'),
  discNumber: z.string().trim()
    .refine((v) => v === '' || /^[1-9]\d*$/.test(v), { error: 'Disc number must be a positive whole number' }),
  language: z.string().trim(),
  purchaseDate: optionalPastDate('Purchase date'),
  releaseDate: optionalPastDate('Release date'),
  isPartOfSet: z.boolean(),
  isRentalDisc: z.boolean(),
  containsSpecialFeatures: z.boolean(),
});

export type DiscFormValues = z.input<typeof discFormSchema>;
export type DiscFormOutput = z.output<typeof discFormSchema>;

export function toDiscFormValues(disc?: CatalogDisc | null): DiscFormValues {
  return {
    title: disc?.title ?? '',
    format: disc?.format ?? '',
    condition: disc?.condition ?? '',
    barcode: disc?.barcode ?? '',
    regionCode: disc?.regionCode ?? '',
    discNumber: disc?.discNumber != null ? String(disc.discNumber) : '',
    language: disc?.language ?? '',
    purchaseDate: disc?.purchaseDate ?? '',
    releaseDate: disc?.releaseDate ?? '',
    isPartOfSet: disc?.isPartOfSet ?? false,
    isRentalDisc: disc?.isRentalDisc ?? false,
    containsSpecialFeatures: disc?.containsSpecialFeatures ?? false,
  };
}

/** Empty strings become undefined, matching what the dialog sent before the migration. */
export function toDiscPayload(values: DiscFormOutput): Partial<CatalogDisc> {
  return {
    title: values.title,
    format: (values.format || undefined) as DiscFormat | undefined,
    barcode: values.barcode || undefined,
    condition: (values.condition || undefined) as DiscCondition | undefined,
    regionCode: values.regionCode || undefined,
    discNumber: values.discNumber ? Number(values.discNumber) : undefined,
    language: values.language || undefined,
    purchaseDate: values.purchaseDate || undefined,
    releaseDate: values.releaseDate || undefined,
    isPartOfSet: values.isPartOfSet,
    isRentalDisc: values.isRentalDisc,
    containsSpecialFeatures: values.containsSpecialFeatures,
  };
}
