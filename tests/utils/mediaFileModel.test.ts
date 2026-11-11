import { describe, expect, it } from 'vitest';

import {
  audioLabel,
  episodeCode,
  fileSections,
  fileSource,
  fileStatusBadges,
  qualityLabel,
  roleLabel,
  titleSources,
  typeLabel,
  videoCodecLabel,
} from '@/service/library/mediaFileModel';
import type { MediaFile } from '@/types/library/MediaFile.type';

const file = (overrides: Partial<MediaFile> = {}): MediaFile => ({
  id: 'f1',
  fileName: 'Big Movie (1995).mkv',
  filePath: '/lib/Movies/Big Movie (1995)/Big Movie (1995).mkv',
  fileSize: 1024,
  detectedMediaType: null,
  assignmentStatus: null,
  targetPath: null,
  organizationStatus: null,
  createdAt: null,
  ...overrides,
});

describe('mediaFileModel', () => {
  it('builds the quality label from the resolution category and HDR format', () => {
    expect(qualityLabel(file({ resolutionCategory: '4K', hdrFormat: 'HDR10' }))).toBe('4K · HDR10');
    expect(qualityLabel(file({ resolutionCategory: '1080p' }))).toBe('1080p');
    expect(qualityLabel(file({ width: 1920, height: 800 }))).toBe('1920×800');
    expect(qualityLabel(file())).toBeNull();
  });

  it('formats codecs and the audio channel layout', () => {
    expect(videoCodecLabel(file({ videoCodec: 'hevc' }))).toBe('HEVC');
    expect(audioLabel(file({ audioCodec: 'truehd', audioChannels: 8 }))).toBe('TRUEHD 7.1');
    expect(audioLabel(file({ audioCodec: 'aac', audioChannels: 2 }))).toBe('AAC Stereo');
    expect(audioLabel(file({ audioChannels: 6 }))).toBe('5.1');
    expect(audioLabel(file())).toBeNull();
  });

  it('names the type from the container and the extension', () => {
    expect(typeLabel(file({ container: 'matroska,webm' }))).toBe('MKV');
    expect(typeLabel(file({ container: 'mov,mp4,m4a,3gp,3g2,mj2', fileName: 'a.m4v' }))).toBe('MP4 · .m4v');
    expect(typeLabel(file({ fileName: 'disc.iso' }))).toBe('.iso');
    expect(typeLabel(file({ fileName: 'noext' }))).toBeNull();
  });

  it('labels episodes SxxEyy and everything else by role', () => {
    expect(episodeCode(file({ seasonNumber: 1, episodeNumber: 2 }))).toBe('S01E02');
    expect(episodeCode(file({ seasonNumber: 1, episodeNumber: 2, episodeEndNumber: 3 }))).toBe('S01E02–E03');
    expect(roleLabel(file({ role: 'episode', seasonNumber: 3, episodeNumber: 10 }))).toBe('S03E10');
    expect(roleLabel(file({ role: 'main' }))).toBe('Main feature');
    expect(roleLabel(file({ role: 'extra' }))).toBe('Extra');
    expect(roleLabel(file({ role: null }))).toBe('Unclassified');
  });

  it('reports missing, probe-failed, not-probed and flagged files', () => {
    expect(fileStatusBadges(file({ probedAt: '2026-01-01T00:00:00Z' }))).toEqual([]);

    const missing = fileStatusBadges(file({ isAvailable: false, missingSince: '2026-03-04T00:00:00Z', probedAt: 'x' }));
    expect(missing[0]).toMatchObject({ key: 'missing', tone: 'error' });
    expect(missing[0].label).toMatch(/^Missing since /);

    expect(fileStatusBadges(file({ probeError: 'moov atom not found' }))).toEqual([
      expect.objectContaining({ key: 'probe-failed', detail: 'moov atom not found' }),
    ]);
    expect(fileStatusBadges(file()).map((b) => b.key)).toEqual(['not-probed']);
    expect(fileStatusBadges(file({ probedAt: 'x', needsReview: true, reviewNote: 'check audio' }))).toEqual([
      expect.objectContaining({ key: 'flagged', label: 'Flagged for second look', detail: 'check audio' }),
    ]);
  });

  it('never throws on a file with every technical field null', () => {
    const bare = file({
      container: null, videoCodec: null, resolutionCategory: null, hdrFormat: null, audioCodec: null,
      audioChannels: null, width: null, height: null, durationMs: null, fileSize: null, fileName: '',
    });
    expect(() => [qualityLabel(bare), audioLabel(bare), typeLabel(bare), roleLabel(bare), fileStatusBadges(bare), fileSource(bare)]).not.toThrow();
  });

  it('links a file to its source disc or tape page', () => {
    expect(fileSource(file({ discId: 'd1', disc: { id: 'd1', title: 'Disc One', format: 'Blu-ray' } }))).toMatchObject({
      kind: 'disc', title: 'Disc One', format: 'Blu-ray', href: '/dashboard/physical-media/discs/d1',
    });
    expect(fileSource(file({ tapeId: 't1' }))).toMatchObject({ kind: 'tape', title: 'Tape', href: '/dashboard/physical-media/tapes/t1' });
    expect(fileSource(file())).toBeNull();
  });

  it('orders the sections and drops empty ones', () => {
    const sections = fileSections({
      main: [file({ id: 'm' })],
      versions: [],
      extras: [file({ id: 'x' })],
      other: [file({ id: 'o' })],
      seasons: [
        { seasonNumber: 0, episodes: [file({ id: 's0' })], extras: [], other: [] },
        { seasonNumber: 1, episodes: [file({ id: 'e1' }), file({ id: 'e2' })], extras: [file({ id: 'e1x' })], other: [] },
        { seasonNumber: null, episodes: [file({ id: 'u' })], extras: [], other: [] },
      ],
    });

    expect(sections.map((s) => s.title)).toEqual(['Main feature', 'Extras', 'Specials', 'Season 1', 'Unknown season', 'Other']);
    expect(sections[3].files.map((f) => f.id)).toEqual(['e1', 'e2', 'e1x']);
    expect(sections[3].season).toBe(1);
    expect(sections[0].season).toBeUndefined();
  });

  it('collects the title sources, including discs only a file points at', () => {
    const sources = titleSources(
      [{ id: 'd1', title: 'Disc One', format: 'DVD' } as unknown as { id: string }],
      [],
      [
        file({ id: 'a', discId: 'd1' }),
        file({ id: 'b', discId: 'd2', disc: { id: 'd2', title: 'Bonus Disc', format: null } }),
        file({ id: 'c' }),
      ],
    );

    expect(sources.map((s) => [s.title, s.files.map((f) => f.id), Boolean(s.record)])).toEqual([
      ['Disc One', ['a'], true],
      ['Bonus Disc', ['b'], false],
    ]);
  });
});
