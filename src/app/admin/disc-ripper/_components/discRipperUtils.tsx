import React from 'react';
import { Chip } from '@mui/material';
import type {
  Assignment, ExtrasCategory, StartJobRequest, TitleDeclaration, TmdbEpisode,
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
