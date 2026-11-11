import { describe, expect, it } from 'vitest';
import { formatBytes, formatChannelLayout, formatDuration } from '@/utils/format';
import { formatFileSize } from '@/service/library/mediaFolderFiles';
import { DiscRipperService } from '@/service/disc-ripper/DiscRipperService';

const MB = 1024 ** 2;
const GB = 1024 ** 3;

describe('formatBytes', () => {
  it('defaults to binary units with one decimal', () => {
    expect(formatBytes(512)).toBe('512.0 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(5 * MB)).toBe('5.0 MB');
    expect(formatBytes(2.5 * 1024 * GB)).toBe('2.5 TB');
  });

  it('returns the empty text for zero, missing, negative and non-finite input', () => {
    for (const value of [0, null, undefined, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(formatBytes(value)).toBe('—');
      expect(formatBytes(value, { empty: '' })).toBe('');
    }
  });

  it('adaptive precision drops the decimal at 10 and above, and for bytes', () => {
    expect(formatBytes(512, { precision: 'adaptive' })).toBe('512 B');
    expect(formatBytes(4.25 * GB, { precision: 'adaptive' })).toBe('4.3 GB');
    expect(formatBytes(23.4 * GB, { precision: 'adaptive' })).toBe('23 GB');
    expect(formatBytes(0, { precision: 'adaptive', empty: '0 B' })).toBe('0 B');
  });

  it('video precision shows whole MB below a gigabyte and one-decimal GB above', () => {
    expect(formatBytes(700 * MB, { precision: 'video' })).toBe('700 MB');
    expect(formatBytes(23.44 * GB, { precision: 'video' })).toBe('23.4 GB');
    expect(formatBytes(2048 * GB, { precision: 'video' })).toBe('2048.0 GB');
  });
});

describe('call sites keep their output', () => {
  it('formatFileSize keeps the empty string for zero-byte files', () => {
    expect(formatFileSize(0)).toBe('');
    expect(formatFileSize(1536)).toBe('1.5 KB');
  });

  it('DiscRipperService.formatBytes keeps the em dash the configure step compares against', () => {
    expect(DiscRipperService.formatBytes(0)).toBe('—');
    expect(DiscRipperService.formatBytes(4.7 * GB)).toBe('4.7 GB');
    expect(DiscRipperService.formatBytes(350 * MB)).toBe('350 MB');
  });
});

describe('formatChannelLayout', () => {
  it('names the common speaker layouts', () => {
    expect(formatChannelLayout(1)).toBe('Mono');
    expect(formatChannelLayout(2)).toBe('Stereo');
    expect(formatChannelLayout(3)).toBe('2.1');
    expect(formatChannelLayout(6)).toBe('5.1');
    expect(formatChannelLayout('8')).toBe('7.1');
    expect(formatChannelLayout(7)).toBe('6.1');
    expect(formatChannelLayout(4)).toBe('4 ch');
  });

  it('returns null for missing or empty input and passes unparseable text through', () => {
    for (const value of [null, undefined, '', 0]) expect(formatChannelLayout(value)).toBeNull();
    expect(formatChannelLayout('5.1(side)')).toBe('5.1(side)');
  });
});

describe('formatDuration', () => {
  it('shows hours and minutes, minutes, or seconds', () => {
    expect(formatDuration(8_280_000)).toBe('2h 18m');
    expect(formatDuration(7_200_000)).toBe('2h');
    expect(formatDuration(42 * 60_000)).toBe('42m');
    expect(formatDuration(45_000)).toBe('45s');
  });

  it('returns the empty text for missing, zero, negative or non-finite input', () => {
    for (const value of [null, undefined, 0, -5, Number.NaN]) expect(formatDuration(value)).toBe('—');
    expect(formatDuration(null, '')).toBe('');
  });
});
