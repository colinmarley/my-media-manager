import React from 'react';
import { Chip } from '@mui/material';
import type { Assignment } from '@/types/disc-ripper/DiscRipper.type';

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

export function buildEpisodeMap(
  selectedIndices: number[],
  assignments: Record<number, Assignment>,
  season: number,
): Record<string, string> {
  const map: Record<string, string> = {};
  let specialN = 0;
  for (const idx of [...selectedIndices].sort((a, b) => a - b)) {
    const a = assignments[idx];
    if (!a) continue;
    if (a.type === 'episode') {
      const code = epCode(season, a.episodeNumber);
      map[String(idx)] = a.episodeName ? `${code} - ${a.episodeName}` : code;
    } else if (a.type === 'special') {
      specialN++;
      map[String(idx)] = `SpecialFeature${String(specialN).padStart(3, '0')}`;
    } else if (a.type === 'custom' && a.name.trim()) {
      map[String(idx)] = a.name.trim();
    }
  }
  return map;
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
