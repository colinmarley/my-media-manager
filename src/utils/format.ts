/**
 * The one byte formatter. Units are binary (1 KB = 1024 B), matching what the
 * NAS and Jellyfin report.
 *
 * Call sites historically differed in how they show sizes, so the options
 * reproduce each style rather than forcing one look everywhere:
 *
 *   precision 1 (default)  "512.0 B", "1.5 KB", "4.2 GB"
 *   precision 'adaptive'   no decimal at >= 10 or for bytes: "512 B", "4.2 GB", "23 GB"
 *   precision 'video'      whole MB below 1 GB, one-decimal GB above: "700 MB", "23.4 GB"
 *
 * `empty` is returned for 0, null, undefined, NaN and negative input.
 */
export type FormatBytesPrecision = number | 'adaptive' | 'video';

export interface FormatBytesOptions {
  /** Text for a missing / zero size. Default '—'. */
  empty?: string;
  precision?: FormatBytesPrecision;
}

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const;
const MB = 1024 ** 2;
const GB = 1024 ** 3;

export function formatBytes(bytes: number | null | undefined, options: FormatBytesOptions = {}): string {
  const { empty = '—', precision = 1 } = options;
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes <= 0) return empty;

  if (precision === 'video') {
    return bytes >= GB ? `${(bytes / GB).toFixed(1)} GB` : `${(bytes / MB).toFixed(0)} MB`;
  }

  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const decimals = precision === 'adaptive' ? (value >= 10 || unit === 0 ? 0 : 1) : precision;
  return `${value.toFixed(decimals)} ${UNITS[unit]}`;
}
