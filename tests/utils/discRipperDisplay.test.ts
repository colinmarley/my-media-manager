import { describe, expect, it } from 'vitest';
import {
  audioSummary, describeStoredRip, ripTitleProblems, subtitleSummary, syncStatus,
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
