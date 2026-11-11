/**
 * Display rules for one inventory file on the title detail page. Pure and null-safe: every
 * technical field may be missing (never probed, or the probe failed), and nothing here throws.
 */
import { formatChannelLayout } from '@/utils/format';
import type { StatusTone } from '@/theme/tokens';
import { MediaFile, MediaFileGroups, SourceKind } from '@/types/library/MediaFile.type';

const clean = (value: string | null | undefined): string | null => {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return trimmed ? trimmed : null;
};

const pad2 = (n: number) => String(n).padStart(2, '0');

/** "4K · HDR10", "1080p", "1920×800" (no category), or null. */
export function qualityLabel(file: MediaFile): string | null {
  const resolution = clean(file.resolutionCategory)
    ?? (file.width && file.height ? `${file.width}×${file.height}` : null);
  const hdr = clean(file.hdrFormat);
  const parts = [resolution, hdr].filter(Boolean);
  return parts.length ? parts.join(' · ') : null;
}

export function videoCodecLabel(file: MediaFile): string | null {
  return clean(file.videoCodec)?.toUpperCase() ?? null;
}

/** "TRUEHD 7.1", "AAC Stereo", "5.1" (no codec), or null. */
export function audioLabel(file: MediaFile): string | null {
  const parts = [clean(file.audioCodec)?.toUpperCase(), formatChannelLayout(file.audioChannels)].filter(Boolean);
  return parts.length ? parts.join(' ') : null;
}

export function fileExtension(fileName: string | null | undefined): string | null {
  const match = /\.([A-Za-z0-9]{1,6})$/.exec(fileName ?? '');
  return match ? match[1].toLowerCase() : null;
}

const CONTAINER_NAMES: Record<string, string> = {
  matroska: 'MKV',
  'matroska,webm': 'MKV',
  'mov,mp4,m4a,3gp,3g2,mj2': 'MP4',
  mpegts: 'MPEG-TS',
  avi: 'AVI',
};

/** "MKV", "MP4 · .m4v" (container and extension disagree), ".iso" (not probed), or null. */
export function typeLabel(file: MediaFile): string | null {
  const rawContainer = clean(file.container)?.toLowerCase() ?? null;
  const container = rawContainer ? (CONTAINER_NAMES[rawContainer] ?? rawContainer.split(',')[0].toUpperCase()) : null;
  const ext = fileExtension(file.fileName);
  if (container && ext) return container.toLowerCase() === ext ? container : `${container} · .${ext}`;
  if (container) return container;
  return ext ? `.${ext}` : null;
}

/** "S01E02", "S01E02–E03", "S01", "E05", or null. */
export function episodeCode(file: MediaFile): string | null {
  const season = typeof file.seasonNumber === 'number' ? file.seasonNumber : null;
  const episode = typeof file.episodeNumber === 'number' ? file.episodeNumber : null;
  const end = typeof file.episodeEndNumber === 'number' && episode !== null && file.episodeEndNumber > episode
    ? `–E${pad2(file.episodeEndNumber)}`
    : '';
  if (season !== null && episode !== null) return `S${pad2(season)}E${pad2(episode)}${end}`;
  if (episode !== null) return `E${pad2(episode)}${end}`;
  return season !== null ? `S${pad2(season)}` : null;
}

const ROLE_LABELS: Record<string, string> = {
  main: 'Main feature',
  version: 'Version',
  extra: 'Extra',
  episode: 'Episode',
  other: 'Other',
};

/** SxxEyy for episodes, the role name otherwise. */
export function roleLabel(file: MediaFile): string {
  if (file.role === 'episode' || (file.role == null && file.episodeNumber != null)) {
    return episodeCode(file) ?? 'Episode';
  }
  return ROLE_LABELS[file.role ?? ''] ?? 'Unclassified';
}

export const isMissing = (file: MediaFile): boolean => file.isAvailable === false;
export const isFlagged = (file: MediaFile): boolean => file.needsReview === true;

export interface FileStatusBadge {
  key: 'missing' | 'probe-failed' | 'not-probed' | 'flagged';
  label: string;
  tone: StatusTone;
  /** Tooltip text (the probe error, the review note, the full timestamp). */
  detail?: string;
}

const shortDate = (iso: string | null | undefined): string | null => {
  if (!iso) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date.toLocaleDateString();
};

/** The status badges a file row shows, most serious first. Empty for a healthy file. */
export function fileStatusBadges(file: MediaFile): FileStatusBadge[] {
  const badges: FileStatusBadge[] = [];
  if (isMissing(file)) {
    const since = shortDate(file.missingSince);
    badges.push({
      key: 'missing',
      label: since ? `Missing since ${since}` : 'Missing',
      tone: 'error',
      detail: file.missingSince ? `Not found on disk since ${file.missingSince}` : 'Not found on disk at the last scan',
    });
  }
  if (clean(file.probeError)) {
    badges.push({ key: 'probe-failed', label: 'Probe failed', tone: 'error', detail: clean(file.probeError) ?? undefined });
  } else if (!file.probedAt) {
    badges.push({ key: 'not-probed', label: 'Not probed', tone: 'neutral', detail: 'Technical details have not been read from this file yet' });
  }
  if (isFlagged(file)) {
    badges.push({ key: 'flagged', label: 'Flagged for second look', tone: 'warning', detail: clean(file.reviewNote) ?? undefined });
  }
  return badges;
}

export interface FileSource {
  kind: SourceKind;
  id: string;
  title: string;
  format: string | null;
  href: string;
}

/** The disc or tape a file was ripped / digitized from, or null. */
export function fileSource(file: MediaFile): FileSource | null {
  if (file.discId) {
    return {
      kind: 'disc',
      id: file.discId,
      title: clean(file.disc?.title) ?? 'Disc',
      format: clean(file.disc?.format),
      href: `/dashboard/physical-media/discs/${encodeURIComponent(file.discId)}`,
    };
  }
  if (file.tapeId) {
    return {
      kind: 'tape',
      id: file.tapeId,
      title: clean(file.tape?.title) ?? 'Tape',
      format: clean(file.tape?.format),
      href: `/dashboard/physical-media/tapes/${encodeURIComponent(file.tapeId)}`,
    };
  }
  return null;
}

/** The path the file sits at now, for path-based tools (reassign, episode assignment). */
export const currentFilePath = (file: MediaFile): string => file.filePath || file.targetPath || '';

/** Relative path, shown as the second line of the file name cell. */
export const displayRelativePath = (file: MediaFile): string | null =>
  clean(file.relativePath) ?? clean(file.targetPath) ?? clean(file.filePath);

export interface FileSection {
  key: string;
  title: string;
  files: MediaFile[];
  /** Season sections are collapsible. */
  season?: number | null;
}

/** The sections the Files tab renders, in order, without empty ones. Seasons expand to their parts. */
export function fileSections(groups: MediaFileGroups): FileSection[] {
  const sections: FileSection[] = [
    { key: 'main', title: 'Main feature', files: groups.main ?? [] },
    { key: 'versions', title: 'Versions', files: groups.versions ?? [] },
    { key: 'extras', title: 'Extras', files: groups.extras ?? [] },
  ];
  for (const season of groups.seasons ?? []) {
    const n = season.seasonNumber;
    sections.push({
      key: `season-${n ?? 'unknown'}`,
      title: n === null || n === undefined ? 'Unknown season' : n === 0 ? 'Specials' : `Season ${n}`,
      season: n ?? null,
      files: [...(season.episodes ?? []), ...(season.extras ?? []), ...(season.other ?? [])],
    });
  }
  sections.push({ key: 'other', title: 'Other', files: groups.other ?? [] });
  return sections.filter((section) => section.files.length > 0);
}

export interface TitleSource {
  kind: SourceKind;
  id: string;
  title: string;
  format: string | null;
  href: string;
  /** The disc / tape record when the title links it (absent when only a file points at it). */
  record: Record<string, unknown> | null;
  /** This title's files on it. */
  files: MediaFile[];
}

const recordString = (record: Record<string, unknown>, key: string): string | null => {
  const value = record[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
};

/**
 * Every disc and tape of a title: the ones it is linked to, plus any a file of it was ripped
 * from without the title link existing. Each carries the title's files on it.
 */
export function titleSources(
  discs: { id: string }[],
  tapes: { id: string }[],
  files: MediaFile[],
): TitleSource[] {
  const byKey = new Map<string, TitleSource>();
  const add = (kind: SourceKind, record: Record<string, unknown>) => {
    const id = String(record.id);
    byKey.set(`${kind}:${id}`, {
      kind,
      id,
      title: recordString(record, 'title') ?? (kind === 'disc' ? 'Untitled disc' : 'Untitled tape'),
      format: kind === 'disc' ? recordString(record, 'format') : recordString(record, 'tapeType')?.toUpperCase() ?? null,
      href: `/dashboard/physical-media/${kind === 'disc' ? 'discs' : 'tapes'}/${encodeURIComponent(id)}`,
      record,
      files: [],
    });
  };
  discs.forEach((disc) => add('disc', disc as unknown as Record<string, unknown>));
  tapes.forEach((tape) => add('tape', tape as unknown as Record<string, unknown>));

  for (const file of files) {
    const source = fileSource(file);
    if (!source) continue;
    const k = `${source.kind}:${source.id}`;
    if (!byKey.has(k)) {
      byKey.set(k, { ...source, record: null, files: [] });
    }
    byKey.get(k)!.files.push(file);
  }
  return Array.from(byKey.values());
}
