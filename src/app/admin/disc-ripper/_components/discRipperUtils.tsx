import React from 'react';
import { Chip } from '@mui/material';
import type {
  Assignment, DiscStream, DiscTitle, ExtrasCategory, RipJob, RipTitleRecord, StartJobRequest,
  StoredRip, TitleDeclaration, TmdbEpisode,
} from '@/types/disc-ripper/DiscRipper.type';

export const POSTER_BASE = 'https://image.tmdb.org/t/p/w92';

const STATUS_COLORS: Record<string, 'default' | 'info' | 'warning' | 'success' | 'error'> = {
  queued: 'default', ripping: 'info',
  delivering: 'info', done: 'success', failed: 'error', cancelled: 'default',
};

export function StatusChip({ status }: { status: string }) {
  return <Chip label={status} color={STATUS_COLORS[status] ?? 'default'} size="small" />;
}

export function fmtDur(s: number) {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
    : `${m}:${String(sec).padStart(2, '0')}`;
}

export function epCode(season: number, ep: number) {
  return `S${String(season).padStart(2, '0')}E${String(ep).padStart(2, '0')}`;
}

export function previewFilenames(
  mediaType: 'movie' | 'show',
  title: string,
  year: number,
  selectedIndices: number[],
  assignments: Record<number, Assignment>,
  season: number,
): string[] {
  if (!title.trim() || !selectedIndices.length) return [];
  const sorted = [...selectedIndices].sort((a, b) => a - b);
  if (mediaType === 'movie') {
    if (sorted.length === 1) return [`${title} (${year}).mkv`];
    return sorted.map((_, i) => `${title} (${year}) - Version ${i + 1}.mkv`);
  }
  // show
  let specialN = 0;
  return sorted.map((idx, i) => {
    const a = assignments[idx];
    if (!a || a.type === 'episode') {
      const epNum = a?.type === 'episode' ? a.episodeNumber : i + 1;
      const epName = a?.type === 'episode' ? a.episodeName : '';
      const code = epCode(season, epNum);
      return `${title} ${code}${epName ? ` - ${epName}` : ''}.mkv`;
    }
    if (a.type === 'special') {
      specialN++;
      return `${title} SpecialFeature${String(specialN).padStart(3, '0')}.mkv`;
    }
    if (a.type === 'custom') {
      return a.name.trim() ? `${title} ${a.name.trim()}.mkv` : '(custom name pending)';
    }
    return `${title} ${epCode(season, i + 1)}.mkv`;
  });
}

export interface StartJobInput {
  discType: 'dvd' | 'bluray';
  mediaType: 'movie' | 'show';
  title: string;
  year: number;
  imdbId: string;
  /** TMDB movie id or series id of the picked search result, if one was picked. */
  tmdbId: number | null;
  season: number;
  selectedIndices: number[];
  assignments: Record<number, Assignment>;
  contentTypes: Record<number, ExtrasCategory | ''>;
  /** The loaded TMDB episode list for the season (for per-episode TMDB ids). */
  episodes: TmdbEpisode[];
  catalogDiscId: string;
  scanId?: string;
}

/**
 * The start-job request for the ripper.
 *
 * `titles` is the structured record of what each selected title is. The older
 * `episode_map` / `title_content_types` are sent too, unchanged, because they
 * are what the ripper names files from: a title tagged with an extras category
 * is left out of `episode_map` so it is not also given an episode code.
 */
export function buildStartJobRequest(input: StartJobInput): StartJobRequest {
  const sorted = [...input.selectedIndices].sort((a, b) => a - b);
  const isShow = input.mediaType === 'show';
  const mainCount = sorted.filter((idx) => !input.contentTypes[idx]).length;

  const episodeMap: Record<string, string> = {};
  const titleContentTypes: Record<string, string> = {};
  const titles: TitleDeclaration[] = [];
  let specialN = 0;

  for (const idx of sorted) {
    const extras = input.contentTypes[idx];
    if (extras) {
      titleContentTypes[String(idx)] = extras;
      titles.push({ title_index: idx, content_type: extras });
      continue;
    }
    if (!isShow) {
      titles.push({ title_index: idx, content_type: 'main_feature', is_main_feature: mainCount === 1 });
      continue;
    }
    const a = input.assignments[idx];
    if (a?.type === 'episode') {
      const code = epCode(input.season, a.episodeNumber);
      episodeMap[String(idx)] = a.episodeName ? `${code} - ${a.episodeName}` : code;
      const tmdbEpisodeId = input.episodes.find((e) => e.episodeNumber === a.episodeNumber)?.tmdbId;
      titles.push({
        title_index: idx,
        content_type: 'episode',
        season: input.season,
        episode: a.episodeNumber,
        ...(a.episodeName ? { episode_name: a.episodeName } : {}),
        ...(tmdbEpisodeId != null ? { tmdb_episode_id: tmdbEpisodeId } : {}),
      });
    } else if (a?.type === 'special') {
      specialN++;
      const name = `SpecialFeature${String(specialN).padStart(3, '0')}`;
      episodeMap[String(idx)] = name;
      titles.push({ title_index: idx, content_type: 'special_feature', custom_name: name });
    } else if (a?.type === 'custom' && a.name.trim()) {
      episodeMap[String(idx)] = a.name.trim();
      titles.push({ title_index: idx, custom_name: a.name.trim() });
    } else {
      titles.push({ title_index: idx });
    }
  }

  return {
    disc_type: input.discType,
    media_type: input.mediaType,
    title: input.title.trim(),
    year: input.year,
    imdb_id: input.imdbId.trim() || undefined,
    tmdb_id: input.tmdbId ?? undefined,
    season: isShow ? input.season : undefined,
    mkv_title_indices: input.selectedIndices,
    episode_map: isShow && Object.keys(episodeMap).length ? episodeMap : undefined,
    catalog_disc_id: input.catalogDiscId,
    title_content_types: Object.keys(titleContentTypes).length ? titleContentTypes : undefined,
    scan_id: input.scanId,
    titles,
  };
}

/** Why Start Rip is not allowed yet, or null when it is. */
export function startJobBlocker(input: {
  title: string; year: number; selectedIndices: number[]; linkedDiscId: string | null | undefined;
}): string | null {
  if (!input.title.trim()) return 'Title is required';
  if (!input.year || input.year < 1888 || input.year > 2100) return 'Enter a valid year';
  if (!input.selectedIndices.length) return 'Select at least one title to rip';
  if (!input.linkedDiscId) return 'Link this rip to a disc in your catalog (or create one) before starting';
  return null;
}

/** "eng 5.1, eng 2.0" for a title's audio streams ("—" when the scan has none). */
export function audioSummary(streams: DiscStream[] | undefined): string {
  const audio = (streams ?? []).filter((s) => s.type === 'audio');
  if (!audio.length) return '—';
  return audio.map((s) => {
    const lang = s.lang_code || '?';
    const layout = s.channels === 6 ? '5.1' : s.channels === 8 ? '7.1' : s.channels ? `${s.channels}.0` : '';
    return layout ? `${lang} ${layout}` : lang;
  }).join(', ');
}

/** "eng, spa, fre (1 forced)" for a title's subtitle streams. */
export function subtitleSummary(streams: DiscStream[] | undefined): string {
  const subs = (streams ?? []).filter((s) => s.type.startsWith('sub'));
  if (!subs.length) return '—';
  const langs = [...new Set(subs.map((s) => s.lang_code || '?'))].join(', ');
  const forced = subs.filter((s) => s.forced).length;
  return forced ? `${langs} (${forced} forced)` : langs;
}

/** One line per title that failed or had disc read errors. */
export function ripTitleProblems(titles: RipTitleRecord[]): string[] {
  const out: string[] = [];
  for (const t of titles) {
    const name = t.dest_path ? t.dest_path.split(/[\\/]/).pop() : `disc title ${t.title_index}`;
    if (t.status === 'failed') {
      out.push(`Disc title ${t.title_index} was not ripped${t.error ? ` (${t.error})` : ''}`);
    } else if (t.read_errors > 0) {
      out.push(`${name}: ${t.read_errors} disc read error${t.read_errors === 1 ? '' : 's'}`);
    }
  }
  return out;
}

/** Whether a finished job's rip record reached the library; null when not applicable. */
export function syncStatus(
  job: Pick<RipJob, 'status' | 'library_sync_state' | 'library_sync_error'>,
): { severity: 'success' | 'warning' | 'info'; label: string; detail?: string } | null {
  if (job.status !== 'done' || !job.library_sync_state) return null;
  if (job.library_sync_state === 'synced') return { severity: 'success', label: 'Rip record is in the library' };
  if (job.library_sync_state === 'pending') {
    return { severity: 'info', label: 'Rip record is waiting to be sent to the library' };
  }
  return {
    severity: 'warning',
    label: 'Rip record has not reached the library yet (the ripper keeps retrying)',
    detail: job.library_sync_error ?? undefined,
  };
}

/** "Firefly (2002), season 1 — ripped 22 Nov 2026" for an earlier rip of the same disc. */
export function describeStoredRip(rip: StoredRip): string {
  const when = rip.deliveredAt ?? rip.ripStartedAt;
  const date = when ? new Date(when) : null;
  const title = rip.title ? `${rip.title}${rip.year ? ` (${rip.year})` : ''}` : 'Untitled rip';
  const season = rip.season != null ? `, season ${rip.season}` : '';
  const dated = date && !Number.isNaN(date.getTime())
    ? ` — ripped ${date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}`
    : '';
  const partial = rip.status === 'partial' ? ' (some titles failed)' : '';
  return `${title}${season}${dated}${partial}`;
}

// ── Reading a scan ──────────────────────────────────────────────────────────

/** Why a scanned title is probably not something to rip as its own file. */
export type TitleHint =
  | { kind: 'duplicate'; of: number }
  | { kind: 'play_all'; of: number[] }
  | { kind: 'short' };

/** Shorter than this, a title is a clip: usually an ad or a preview. */
export const SHORT_CLIP_SECONDS = 300;
/** Shorter than this, a title on a TV disc is not an episode. */
export const MIN_EPISODE_SECONDS = 600;

type ScannedTitle = Pick<DiscTitle, 'index' | 'duration_seconds' | 'file_size_bytes'>;

function sameContent(a: ScannedTitle, b: ScannedTitle): boolean {
  if (Math.abs(a.duration_seconds - b.duration_seconds) > 1) return false;
  if (!a.file_size_bytes || !b.file_size_bytes) return true;
  const larger = Math.max(a.file_size_bytes, b.file_size_bytes);
  return Math.abs(a.file_size_bytes - b.file_size_bytes) / larger < 0.01;
}

/** The fewest titles (two or more) whose lengths add up to `target`, or null. */
function partsSummingTo(target: ScannedTitle, parts: ScannedTitle[]): number[] | null {
  if (parts.length < 2 || parts.length > 16) return null;
  let best: number[] | null = null;
  for (let mask = 3; mask < 1 << parts.length; mask++) {
    const chosen = parts.filter((_, i) => mask & (1 << i));
    if (chosen.length < 2 || (best && chosen.length >= best.length)) continue;
    const total = chosen.reduce((sum, t) => sum + t.duration_seconds, 0);
    if (Math.abs(total - target.duration_seconds) <= chosen.length) best = chosen.map((t) => t.index);
  }
  return best;
}

/**
 * Hints for a disc's titles, keyed by title index. A DVD lists the same
 * programme several ways: each episode on its own, the same episode again
 * from the "play all" menu, and one long title that is all of them joined.
 * Titles without a hint are the ones worth ripping.
 */
export function analyzeTitles(titles: ScannedTitle[]): Record<number, TitleHint> {
  const hints: Record<number, TitleHint> = {};
  const sorted = [...titles].sort((a, b) => a.index - b.index);

  const originals: ScannedTitle[] = [];
  for (const t of sorted) {
    const twin = originals.find((o) => sameContent(o, t));
    if (twin) hints[t.index] = { kind: 'duplicate', of: twin.index };
    else originals.push(t);
  }

  const long = originals.filter((t) => t.duration_seconds >= MIN_EPISODE_SECONDS);
  for (const t of long) {
    const shorter = long.filter((o) => o.index !== t.index && o.duration_seconds < t.duration_seconds);
    const parts = partsSummingTo(t, shorter);
    if (parts) hints[t.index] = { kind: 'play_all', of: parts };
  }

  for (const t of originals) {
    if (!hints[t.index] && t.duration_seconds < SHORT_CLIP_SECONDS) hints[t.index] = { kind: 'short' };
  }
  return hints;
}

export function titleHintLabel(hint: TitleHint): string {
  if (hint.kind === 'duplicate') return `Same as title ${hint.of}`;
  if (hint.kind === 'play_all') return `Play-all of titles ${hint.of.join(' + ')}`;
  return 'Short clip: likely an ad or preview';
}

/** "dvd" or "bluray" from MakeMKV's own name for the disc ("DVD disc"), else null. */
export function discTypeFromScan(reported: string | null | undefined): 'dvd' | 'bluray' | null {
  const text = (reported ?? '').toLowerCase();
  if (text.includes('blu')) return 'bluray';
  if (text.includes('dvd')) return 'dvd';
  return null;
}

// ── Naming a disc record ────────────────────────────────────────────────────

/** A starting name for the box: "Burn Notice: Season 1", "Alien (1979)". */
export function suggestReleaseTitle(
  mediaType: 'movie' | 'show', title: string, year: number, season: number,
): string {
  const name = title.trim();
  if (!name) return '';
  if (mediaType === 'show') return `${name}: Season ${season}`;
  return year ? `${name} (${year})` : name;
}

/** The disc record's own title: the box name, plus the disc number in a multi-disc box. */
export function discRecordTitle(releaseTitle: string, discNumber: number | null, discCount: number | null): string {
  const name = releaseTitle.trim() || 'Untitled Disc';
  if (discNumber && (discCount ?? 0) > 1) return `${name} - Disc ${discNumber}`;
  return name;
}

/** The disc number a volume label ends with: "BURNNOTICE_S1_D1" → 1. */
export function discNumberFromLabel(label: string | null | undefined): number | null {
  const match = /(?:^|[_\s-])D(?:ISC)?[_\s-]?(\d{1,2})$/i.exec((label ?? '').trim());
  if (!match) return null;
  const n = parseInt(match[1], 10);
  return n > 0 ? n : null;
}

/** One line for a catalogued disc in a pick list. */
export function describeCatalogDisc(disc: {
  title: string; discNumber?: number | null; edition?: string | null; format?: string | null;
}): string {
  const parts = [disc.title];
  if (disc.discNumber != null && !new RegExp(`disc\\s*${disc.discNumber}\\b`, 'i').test(disc.title)) {
    parts.push(`Disc ${disc.discNumber}`);
  }
  if (disc.edition) parts.push(disc.edition);
  if (disc.format) {
    parts.push(disc.format === 'BLURAY' ? 'Blu-ray' : disc.format === 'UHD_BLURAY' ? '4K UHD' : disc.format);
  }
  return parts.join(' · ');
}
