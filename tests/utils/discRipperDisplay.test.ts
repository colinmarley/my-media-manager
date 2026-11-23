import { describe, expect, it } from 'vitest';
import {
  analyzeTitles, audioSummary, describeCatalogDisc, describeStoredRip, discNumberFromLabel,
  discRecordTitle, discTypeFromScan, ripTitleProblems, subtitleSummary, suggestReleaseTitle,
  syncStatus, titleHintLabel,
} from '@/app/admin/disc-ripper/_components/discRipperUtils';
import type { DiscStream, RipTitleRecord, StoredRip } from '@/types/disc-ripper/DiscRipper.type';

const stream = (over: Partial<DiscStream>): DiscStream => ({
  index: 0, type: 'audio', codec: 'DD', lang_code: 'eng', lang_name: 'English', name: '',
  channels: 6, channel_layout: '5.1(side)', default: false, forced: false, ...over,
});

const title = (over: Partial<RipTitleRecord>): RipTitleRecord => ({
  title_index: 0, file_seq: 0, status: 'delivered', error: null, makemkv_filename: 'B1_t00.mkv',
  dest_path: '/ark/media/ingest/Firefly (2002)/Season 01/Firefly S01E01.mkv', size_bytes: 1, read_errors: 0,
  messages: [], duration_seconds: 2600, ...over,
});

describe('track summaries', () => {
  const streams = [
    stream({ type: 'video', lang_code: '', channels: 0 }),
    stream({ channels: 6 }),
    stream({ channels: 2 }),
    stream({ channels: 8, lang_code: 'fra' }),
    stream({ channels: 0, lang_code: '' }),
    stream({ type: 'subtitles', lang_code: 'eng', channels: 0 }),
    stream({ type: 'subtitles', lang_code: 'spa', channels: 0 }),
    stream({ type: 'subtitles', lang_code: 'eng', channels: 0, forced: true }),
  ];

  it('lists audio languages with their layout', () => {
    expect(audioSummary(streams)).toBe('eng 5.1, eng 2.0, fra 7.1, ?');
  });

  it('lists subtitle languages once and counts forced tracks', () => {
    expect(subtitleSummary(streams)).toBe('eng, spa (1 forced)');
  });

  it('shows a dash when the scan carries no streams', () => {
    expect(audioSummary(undefined)).toBe('—');
    expect(subtitleSummary([])).toBe('—');
    expect(subtitleSummary([stream({})])).toBe('—');
  });
});

describe('ripTitleProblems', () => {
  it('is empty for a clean rip', () => {
    expect(ripTitleProblems([title({}), title({ title_index: 1 })])).toEqual([]);
  });

  it('names failed titles and titles with read errors', () => {
    expect(ripTitleProblems([
      title({}),
      title({ title_index: 3, status: 'failed', error: 'makemkvcon produced no file', dest_path: null }),
      title({ title_index: 4, read_errors: 1 }),
      title({ title_index: 5, read_errors: 12, dest_path: 'C:\\ingest\\Firefly (2002)\\Firefly S01E06.mkv' }),
    ])).toEqual([
      'Disc title 3 was not ripped (makemkvcon produced no file)',
      'Firefly S01E01.mkv: 1 disc read error',
      'Firefly S01E06.mkv: 12 disc read errors',
    ]);
  });
});

describe('syncStatus', () => {
  it('says nothing for an unfinished job or a ripper that does not report it', () => {
    expect(syncStatus({ status: 'ripping', library_sync_state: 'failed' })).toBeNull();
    expect(syncStatus({ status: 'done' })).toBeNull();
    expect(syncStatus({ status: 'done', library_sync_state: null })).toBeNull();
  });

  it('reports synced, pending and failed', () => {
    expect(syncStatus({ status: 'done', library_sync_state: 'synced' })?.severity).toBe('success');
    expect(syncStatus({ status: 'done', library_sync_state: 'pending' })?.severity).toBe('info');
    expect(syncStatus({ status: 'done', library_sync_state: 'failed', library_sync_error: 'HTTP 404' }))
      .toMatchObject({ severity: 'warning', detail: 'HTTP 404' });
  });
});

describe('describeStoredRip', () => {
  const rip: StoredRip = {
    id: 'r1', status: 'delivered', discId: 'disc-1', title: 'Firefly', year: 2002, season: 1,
    volumeLabel: 'FIREFLY_D1', deliveredAt: '2026-11-22T21:12:00+00:00', ripStartedAt: null,
  };

  it('describes a rip with its title, season and date', () => {
    const text = describeStoredRip(rip);
    expect(text).toMatch(/^Firefly \(2002\), season 1 — ripped /);
    expect(text).toContain('2026');
  });

  it('copes with missing fields and marks a partial rip', () => {
    expect(describeStoredRip({ ...rip, title: null, year: null, season: null, deliveredAt: null }))
      .toBe('Untitled rip');
    expect(describeStoredRip({ ...rip, status: 'partial', deliveredAt: 'not a date' }))
      .toBe('Firefly (2002), season 1 (some titles failed)');
  });
});
describe('analyzeTitles', () => {
  // Burn Notice season 1, disc 1, as MakeMKV listed it.
  const disc = [
    [0, 3974, 3472046080], [1, 2529, 2225668096], [2, 2513, 2204901376], [3, 3974, 3472035840],
    [4, 5042, 4430559232], [5, 147, 115271680], [6, 167, 150294528], [7, 162, 132608000],
    [8, 195, 166565888], [9, 154, 138203136], [10, 140, 118222848], [11, 157, 136898560],
    [12, 147, 115271680], [13, 167, 150294528], [14, 162, 132608000], [15, 195, 166565888],
    [16, 154, 138203136], [17, 140, 118222848], [18, 157, 136898560],
  ].map(([index, duration_seconds, file_size_bytes]) => ({ index, duration_seconds, file_size_bytes }));

  it('leaves only the three episodes without a hint', () => {
    const hints = analyzeTitles(disc);
    expect(disc.filter((t) => !hints[t.index]).map((t) => t.index)).toEqual([0, 1, 2]);
    expect(hints[3]).toEqual({ kind: 'duplicate', of: 0 });
    expect(hints[4]).toEqual({ kind: 'play_all', of: [1, 2] });
    expect(hints[5]).toEqual({ kind: 'short' });
    expect(hints[12]).toEqual({ kind: 'duplicate', of: 5 });
    expect(titleHintLabel(hints[4])).toBe('Play-all of titles 1 + 2');
    expect(titleHintLabel(hints[3])).toBe('Same as title 0');
  });

  it('finds a play-all title listed before its episodes', () => {
    const hints = analyzeTitles([
      { index: 0, duration_seconds: 7800, file_size_bytes: 0 },
      { index: 1, duration_seconds: 2600, file_size_bytes: 0 },
      { index: 2, duration_seconds: 2590, file_size_bytes: 0 },
      { index: 3, duration_seconds: 2611, file_size_bytes: 0 },
    ]);
    expect(hints).toEqual({ 0: { kind: 'play_all', of: [1, 2, 3] } });
  });

  it('does not call two different episodes of the same length duplicates', () => {
    expect(analyzeTitles([
      { index: 0, duration_seconds: 2600, file_size_bytes: 2_000_000_000 },
      { index: 1, duration_seconds: 2600, file_size_bytes: 2_100_000_000 },
    ])).toEqual({});
  });

  it('gives a film and its extras no hints', () => {
    expect(analyzeTitles([
      { index: 0, duration_seconds: 7000, file_size_bytes: 30_000_000_000 },
      { index: 1, duration_seconds: 900, file_size_bytes: 1_000_000_000 },
    ])).toEqual({});
  });
});

describe('disc record naming', () => {
  it('reads the disc type MakeMKV reports', () => {
    expect(discTypeFromScan('DVD disc')).toBe('dvd');
    expect(discTypeFromScan('Blu-ray disc')).toBe('bluray');
    expect(discTypeFromScan(null)).toBeNull();
  });

  it('suggests a box name from the picked title', () => {
    expect(suggestReleaseTitle('show', ' Burn Notice ', 2007, 1)).toBe('Burn Notice: Season 1');
    expect(suggestReleaseTitle('movie', 'Alien', 1979, 1)).toBe('Alien (1979)');
    expect(suggestReleaseTitle('movie', '', 1979, 1)).toBe('');
  });

  it('names every disc of a box after the box', () => {
    expect(discRecordTitle('Firefly')).toBe('Firefly');
    expect(discRecordTitle(' Alien (1979) ')).toBe('Alien (1979)');
    expect(discRecordTitle('  ')).toBe('Untitled Disc');
  });

  it('reads the disc number off a volume label', () => {
    expect(discNumberFromLabel('BURNNOTICE_S1_D1')).toBe(1);
    expect(discNumberFromLabel('FIREFLY_DISC_3')).toBe(3);
    expect(discNumberFromLabel('GONE_GIRL')).toBeNull();
    expect(discNumberFromLabel('DVD')).toBeNull();
  });

  it('describes a catalogued disc on one line', () => {
    expect(describeCatalogDisc({ title: 'Burn Notice Season 1', discNumber: 1, edition: 'The Complete First Season', format: 'DVD' }))
      .toBe('Burn Notice Season 1 · Disc 1 · The Complete First Season · DVD');
    expect(describeCatalogDisc({ title: 'Firefly - Disc 2', discNumber: 2, format: 'BLURAY' }))
      .toBe('Firefly - Disc 2 · Blu-ray');
  });
});
