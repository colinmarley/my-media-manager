import React from 'react';
import { Chip } from '@mui/material';
import { EXTRAS_FILENAME_SUFFIX } from '@/types/disc-ripper/DiscRipper.type';
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

type EpisodeAssignment = Extract<Assignment, { type: 'episode' }>;

/** The last episode of a title that holds several, or null for a single episode. */
export function rangeEnd(a: EpisodeAssignment): number | null {
  return a.episodeEndNumber != null && a.episodeEndNumber > a.episodeNumber ? a.episodeEndNumber : null;
}

/** "Dead Drop and Loose Ends": the names of every episode a title holds. */
export function episodeRangeName(a: EpisodeAssignment, episodes: TmdbEpisode[]): string {
  const end = rangeEnd(a);
  if (end == null) return a.episodeName;
  const names = [a.episodeName];
  for (let n = a.episodeNumber + 1; n <= end; n++) {
    const name = episodes.find((e) => e.episodeNumber === n)?.name ?? '';
    if (name && !names.includes(name)) names.push(name);
  }
  const named = names.filter(Boolean);
  if (named.length < 2) return named[0] ?? '';
  return `${named.slice(0, -1).join(', ')} and ${named[named.length - 1]}`;
}

/**
 * The episode string the ripper names a file from: "S01E11 - Dead Drop", or
 * "S01E11-E12 - Dead Drop and Loose Ends" for a title that holds a range.
 */
export function episodeValue(season: number, a: EpisodeAssignment, episodes: TmdbEpisode[]): string {
  const end = rangeEnd(a);
  const code = epCode(season, a.episodeNumber) + (end != null ? `-E${String(end).padStart(2, '0')}` : '');
  const name = episodeRangeName(a, episodes);
  return name ? `${code} - ${name}` : code;
}

/** Every episode number the assignments already cover, ranges included. */
export function assignedEpisodeNumbers(assignments: Record<number, Assignment>): Set<number> {
  const used = new Set<number>();
  for (const a of Object.values(assignments)) {
    if (a.type !== 'episode') continue;
    for (let n = a.episodeNumber; n <= (rangeEnd(a) ?? a.episodeNumber); n++) used.add(n);
  }
  return used;
}

/**
 * The episode to offer as "through" when a title runs about twice as long as
 * an episode of the season usually does: probably a two-part episode on one
 * title. Null when the length is ordinary or nothing follows the episode.
 */
export function suggestedRangeEnd(
  durationSeconds: number, episodeNumber: number, episodes: TmdbEpisode[],
): number | null {
  const runtimes = episodes.map((e) => e.runtime ?? 0).filter((r) => r > 0).sort((x, y) => x - y);
  if (!runtimes.length || durationSeconds <= 0) return null;
  const typical = runtimes[Math.floor((runtimes.length - 1) / 2)] * 60;
  const ratio = durationSeconds / typical;
  if (ratio < 1.7 || ratio > 2.3) return null;
  const next = episodes
    .map((e) => e.episodeNumber)
    .filter((n) => n > episodeNumber)
    .sort((x, y) => x - y)[0];
  return next ?? null;
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
 * is left out of `episode_map` so it is not also given an episode code. A title
 * that holds several episodes carries `episode_end` and a ranged name.
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
      // The range is in both: episode_map names the file ("S01E11-E12 - ..."),
      // episode_end is what the rip record tells the library.
      episodeMap[String(idx)] = episodeValue(input.season, a, input.episodes);
      const end = rangeEnd(a);
      const episodeName = episodeRangeName(a, input.episodes);
      const tmdbEpisodeId = input.episodes.find((e) => e.episodeNumber === a.episodeNumber)?.tmdbId;
      titles.push({
        title_index: idx,
        content_type: 'episode',
        season: input.season,
        episode: a.episodeNumber,
        ...(end != null ? { episode_end: end } : {}),
        ...(episodeName ? { episode_name: episodeName } : {}),
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

/** The ripper's `_safe_title`: a show title with the characters a filename cannot hold removed. */
function safeTitle(text: string): string {
  return [...text]
    .filter((ch) => ch.charCodeAt(0) > 0x1f && !'/\\:*?"<>|'.includes(ch))
    .join('')
    .trim();
}

/** The ripper's `_unique_dest_name` within one job: a repeated name gets " - Copy N" before any extras suffix. */
function uniqueName(name: string, taken: Set<string>): string {
  if (!taken.has(name.toLowerCase())) return name;
  let stem = name.toLowerCase().endsWith('.mkv') ? name.slice(0, -4) : name;
  let tail = '';
  for (const suffix of Object.values(EXTRAS_FILENAME_SUFFIX)) {
    if (stem.endsWith(`-${suffix}`)) {
      stem = stem.slice(0, -(suffix.length + 1));
      tail = `-${suffix}`;
      break;
    }
  }
  for (let n = 2; ; n++) {
    const candidate = `${stem} - Copy ${n}${tail}.mkv`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
}

/**
 * The file names the ripper gives a job's titles, in rip order. This is the
 * ripper's own rule (job_manager.py: `_plan_destinations`, `_build_dest_name`):
 *
 * - a title tagged with an extras category is "Title (Year)-clip.mkv", then
 *   "Title (Year) 2-clip.mkv", counted per category;
 * - every other title is a main title, numbered only among the main titles:
 *   a movie is "Title (Year).mkv" (or "- Version N" when there are several),
 *   an episode is "Title <its episode_map entry>.mkv", or "Title S01E0N.mkv"
 *   by its place among the main titles when it has no entry.
 *
 * A name already on disk gets " - Copy N" at delivery; that cannot be known here.
 */
export function plannedOutputNames(req: StartJobRequest): string[] {
  const declared: Record<string, string | undefined> = { ...(req.title_content_types ?? {}) };
  for (const t of req.titles ?? []) {
    if (t.content_type) declared[String(t.title_index)] = t.content_type;
  }
  const suffixOf = (idx: number): string | undefined =>
    (EXTRAS_FILENAME_SUFFIX as Record<string, string>)[declared[String(idx)] ?? ''];

  const mainIndices = req.mkv_title_indices.filter((idx) => !suffixOf(idx));
  const episodeMap = req.episode_map ?? {};
  const counts: Record<string, number> = {};
  const taken = new Set<string>();

  return req.mkv_title_indices.map((idx) => {
    const suffix = suffixOf(idx);
    let name: string;
    if (suffix) {
      const n = (counts[suffix] ?? 0) + 1;
      counts[suffix] = n;
      name = `${req.title} (${req.year})${n > 1 ? ` ${n}` : ''}-${suffix}.mkv`;
    } else if (req.media_type === 'movie') {
      name = mainIndices.length > 1
        ? `${req.title} (${req.year}) - Version ${mainIndices.indexOf(idx) + 1}.mkv`
        : `${req.title} (${req.year}).mkv`;
    } else {
      const code = episodeMap[String(idx)] ?? epCode(req.season || 1, mainIndices.indexOf(idx) + 1);
      name = `${safeTitle(req.title)} ${code}.mkv`;
    }
    name = uniqueName(name, taken);
    taken.add(name.toLowerCase());
    return name;
  });
}

/** The output file names for the Configure step as it stands, one per selected title. */
export function previewFilenames(input: Omit<StartJobInput, 'catalogDiscId'>): string[] {
  if (!input.title.trim() || !input.selectedIndices.length) return [];
  return plannedOutputNames(buildStartJobRequest({ ...input, catalogDiscId: '' }));
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

/** What the scan suggests about a title: a repeat, a play-all, a clip. */
export type TitleHint =
  | { kind: 'duplicate'; of: number }
  // Close to another title in length and size, but not shown to be the same video.
  | { kind: 'possible_duplicate'; of: number; short: boolean }
  | { kind: 'play_all'; of: number[] }
  | { kind: 'short' };

/** Shorter than this, a title is a clip: a short extra, an ad or a preview. */
export const SHORT_CLIP_SECONDS = 300;
/** Shorter than this, a title on a TV disc is not an episode. */
export const MIN_EPISODE_SECONDS = 600;

type ScannedTitle = Pick<DiscTitle, 'index' | 'duration_seconds' | 'file_size_bytes'>;

/**
 * A repeat of a title points at the same video on the disc, so the scan gives
 * it the same length to the second and the same size. The size may differ by
 * a few disc sectors (a real disc listed one episode twice 10 KB apart in
 * 3.4 GB), never by megabytes.
 */
const SAME_SIZE_BYTES = 64 * 1024;
const SAME_SIZE_RATIO = 0.0001;

/**
 * "same": the scan shows the two titles to be the same video. "near": close
 * enough in length and size that they may be, but they may just as well be
 * two different clips of about the same length.
 */
function contentMatch(a: ScannedTitle, b: ScannedTitle): 'same' | 'near' | null {
  const seconds = Math.abs(a.duration_seconds - b.duration_seconds);
  if (seconds > 1) return null;
  if (!a.file_size_bytes || !b.file_size_bytes) return seconds === 0 ? 'near' : null;
  const larger = Math.max(a.file_size_bytes, b.file_size_bytes);
  const bytes = Math.abs(a.file_size_bytes - b.file_size_bytes);
  if (seconds === 0 && bytes <= Math.max(SAME_SIZE_BYTES, larger * SAME_SIZE_RATIO)) return 'same';
  return bytes / larger < 0.01 ? 'near' : null;
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
 *
 * Only a title the scan shows to be the same video as an earlier one is
 * called a duplicate. A near match is a `possible_duplicate`: it is treated
 * as a title of its own (see `isPreselected`) and only carries a note.
 */
export function analyzeTitles(titles: ScannedTitle[]): Record<number, TitleHint> {
  const hints: Record<number, TitleHint> = {};
  const sorted = [...titles].sort((a, b) => a.index - b.index);

  const originals: ScannedTitle[] = [];
  for (const t of sorted) {
    const twin = originals.find((o) => contentMatch(o, t) === 'same');
    if (twin) hints[t.index] = { kind: 'duplicate', of: twin.index };
    else originals.push(t);
  }

  const long = originals.filter((t) => t.duration_seconds >= MIN_EPISODE_SECONDS);
  for (const t of long) {
    const shorter = long.filter((o) => o.index !== t.index && o.duration_seconds < t.duration_seconds);
    const parts = partsSummingTo(t, shorter);
    if (parts) hints[t.index] = { kind: 'play_all', of: parts };
  }

  // A play-all joins each of its parts once, so two parts of one play-all are different
  // video however alike their length and size (sitcom episodes all run about 22 minutes).
  const playAlls = Object.values(hints).flatMap((h) => (h.kind === 'play_all' ? [h.of] : []));
  const partsOfOnePlayAll = (a: number, b: number) =>
    playAlls.some((parts) => parts.includes(a) && parts.includes(b));

  for (const t of originals) {
    if (hints[t.index]) continue;
    const short = t.duration_seconds < SHORT_CLIP_SECONDS;
    const near = originals.find(
      (o) => o.index < t.index && contentMatch(o, t) === 'near' && !partsOfOnePlayAll(o.index, t.index),
    );
    if (near) hints[t.index] = { kind: 'possible_duplicate', of: near.index, short };
    else if (short) hints[t.index] = { kind: 'short' };
  }
  return hints;
}

/**
 * Whether a title starts out selected. Repeats, play-all titles and short
 * clips do not. A possible duplicate is not known to be a repeat, so it is
 * selected like any other title of its length.
 */
export function isPreselected(hint: TitleHint | undefined): boolean {
  if (!hint) return true;
  return hint.kind === 'possible_duplicate' && !hint.short;
}

export function titleHintLabel(hint: TitleHint): string {
  if (hint.kind === 'duplicate') return `Same as title ${hint.of}`;
  if (hint.kind === 'play_all') return `Play-all of titles ${hint.of.join(' + ')}`;
  if (hint.kind === 'possible_duplicate') {
    return hint.short
      ? `Short clip, possibly the same as title ${hint.of}`
      : `Possibly the same as title ${hint.of}`;
  }
  return 'Short clip: an extra, ad or preview';
}

/** A sentence for a hint that needs explaining, or null. */
export function titleHintNote(hint: TitleHint | undefined): string | null {
  if (hint?.kind !== 'possible_duplicate') return null;
  return `Close to title ${hint.of} in length and size, but not identical, so it may be different video. `
    + (hint.short ? 'Select it to rip it as well.' : 'Deselect it if it is a repeat.');
}

/**
 * How much longer than a typical episode of the disc a title must be to be
 * taken for a double-length episode rather than a bonus feature.
 */
const DOUBLE_EPISODE_RATIO = 1.5;

/**
 * Whether a title on a TV disc should start out as an extra, not an episode.
 *
 * When the disc has a play-all title, the titles it joins are the episodes.
 * A title that is not one of them (nor an exact repeat of one) is something
 * else on the disc: a featurette, a gag reel. The exception is a title much
 * longer than those episodes, which is more likely a double-length episode
 * the play-all left out. Without a play-all title nothing is known, and
 * the answer is always no.
 */
export function defaultsToExtra(
  index: number, titles: ScannedTitle[], hints: Record<number, TitleHint>,
): boolean {
  const members = new Set<number>();
  for (const hint of Object.values(hints)) {
    if (hint.kind === 'play_all') hint.of.forEach((i) => members.add(i));
  }
  if (!members.size) return false;
  const hint = hints[index];
  if (members.has(index) || hint?.kind === 'play_all') return false;
  if (hint?.kind === 'duplicate' && members.has(hint.of)) return false;
  const title = titles.find((t) => t.index === index);
  if (!title) return false;
  const lengths = titles
    .filter((t) => members.has(t.index))
    .map((t) => t.duration_seconds)
    .sort((a, b) => a - b);
  const typical = lengths[Math.floor((lengths.length - 1) / 2)] ?? 0;
  return !(typical > 0 && title.duration_seconds >= typical * DOUBLE_EPISODE_RATIO);
}

/** The extras category a title that is not an episode starts out with. */
export const DEFAULT_EXTRA_TYPE: ExtrasCategory = 'clip';

// ── Default episode numbering ───────────────────────────────────────────────

/**
 * The first assignment of the selected titles on a TV disc, in title order.
 * A title tagged as an extra takes no episode. A title long enough to be an
 * episode takes the next episode that is not in `held` (episodes already in
 * the library or on another disc's rip); when every episode of the season is
 * held, `held` says nothing useful and numbering starts at the first episode.
 */
export function autoAssignEpisodes(input: {
  selectedIndices: number[];
  titles: ScannedTitle[];
  episodes: TmdbEpisode[];
  contentTypes?: Record<number, ExtrasCategory | ''>;
  held?: Set<number>;
}): Record<number, Assignment> {
  const held = input.held ?? new Set<number>();
  const free = input.episodes.filter((e) => !held.has(e.episodeNumber));
  const pool = free.length ? free : input.episodes;
  const assignments: Record<number, Assignment> = {};
  let next = 0;
  for (const idx of [...input.selectedIndices].sort((a, b) => a - b)) {
    if (input.contentTypes?.[idx]) continue;
    const length = input.titles.find((t) => t.index === idx)?.duration_seconds ?? 0;
    const ep = length >= MIN_EPISODE_SECONDS && next < pool.length ? pool[next++] : null;
    assignments[idx] = ep
      ? { type: 'episode', episodeNumber: ep.episodeNumber, episodeName: ep.name }
      : { type: 'special' };
  }
  return assignments;
}

/** One file of a series as the library lists it (GET /api/catalog/media/series/{id}/files). */
type HeldFile = { episodeNumber?: number | null; episodeEndNumber?: number | null; isAvailable?: boolean | null };

/**
 * The episodes of a season that already exist: files in the library, and
 * titles other discs' rips declared as episodes. Episodes that an earlier rip
 * of the disc now in the drive (same fingerprint) produced are left out, so
 * ripping a disc again numbers it the way it was numbered before.
 */
export function heldEpisodeNumbers(input: {
  season: number;
  librarySeasons?: { seasonNumber: number | null; episodes: HeldFile[] }[] | null;
  rips?: StoredRip[];
  /** Fingerprint of the disc in the drive. */
  fingerprint?: string | null;
}): Set<number> {
  const held = new Set<number>();
  const add = (set: Set<number>, first?: number | null, last?: number | null) => {
    if (first == null || first < 1) return;
    for (let n = first; n <= Math.max(first, last ?? first); n++) set.add(n);
  };
  for (const group of input.librarySeasons ?? []) {
    if (group.seasonNumber !== input.season) continue;
    for (const file of group.episodes) {
      if (file.isAvailable !== false) add(held, file.episodeNumber, file.episodeEndNumber);
    }
  }
  const own = new Set<number>();
  for (const rip of input.rips ?? []) {
    if (rip.status === 'failed' || rip.status === 'cancelled') continue;
    const sameDisc = !!input.fingerprint && rip.fingerprint === input.fingerprint;
    for (const title of rip.titles ?? []) {
      if (title.status === 'failed' || title.episode == null) continue;
      if ((title.season ?? rip.season) !== input.season) continue;
      add(sameDisc ? own : held, title.episode, title.episodeEnd);
    }
  }
  own.forEach((n) => held.delete(n));
  return held;
}

/** "1–5, 7" for a set of episode numbers. */
export function formatEpisodeNumbers(numbers: Iterable<number>): string {
  const sorted = [...new Set(numbers)].sort((a, b) => a - b);
  const parts: string[] = [];
  for (let i = 0; i < sorted.length; i++) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++;
    parts.push(j > i ? `${sorted[i]}–${sorted[j]}` : String(sorted[i]));
    i = j;
  }
  return parts.join(', ');
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
