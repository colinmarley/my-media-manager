import { describe, expect, it } from 'vitest';
import {
  analyzeTitles, autoAssignEpisodes, buildStartJobRequest, defaultsToExtra, formatEpisodeNumbers,
  heldEpisodeNumbers, isPreselected, plannedOutputNames, previewFilenames, titleHintLabel, titleHintNote,
  type StartJobInput,
} from '@/app/admin/disc-ripper/_components/discRipperUtils';
import { boxesNamed } from '@/app/admin/disc-ripper/_components/DiscCatalogLinkPanel';
import {
  EXTRAS_CATEGORIES, EXTRAS_FILENAME_SUFFIX, type StoredRip, type TmdbEpisode,
} from '@/types/disc-ripper/DiscRipper.type';

const base: StartJobInput = {
  discType: 'dvd', mediaType: 'show', title: 'The Office', year: 2005, imdbId: '', tmdbId: 2316,
  season: 1, selectedIndices: [], assignments: {}, contentTypes: {}, episodes: [], catalogDiscId: 'disc-1',
};

const t = (index: number, duration_seconds: number, file_size_bytes = 0) => ({ index, duration_seconds, file_size_bytes });

const eps = (count: number): TmdbEpisode[] =>
  Array.from({ length: count }, (_, i) => ({ episodeNumber: i + 1, name: `Episode ${i + 1}`, runtime: 22 }));

describe('output preview (the ripper naming rule)', () => {
  it('names extras "Title (Year)-clip.mkv", not as episodes', () => {
    const names = previewFilenames({
      ...base,
      selectedIndices: [0, 1, 5, 6, 7],
      assignments: {
        0: { type: 'episode', episodeNumber: 1, episodeName: 'Pilot' },
        1: { type: 'episode', episodeNumber: 2, episodeName: 'Diversity Day' },
      },
      contentTypes: { 5: 'clip', 6: 'clip', 7: 'deleted_scene' },
    });
    expect(names).toEqual([
      'The Office S01E01 - Pilot.mkv',
      'The Office S01E02 - Diversity Day.mkv',
      'The Office (2005)-clip.mkv',
      'The Office (2005) 2-clip.mkv',
      'The Office (2005)-deletedscene.mkv',
    ]);
  });

  it('numbers unassigned episodes only among the titles that are not extras', () => {
    // Title 0 is an extra, so the first main title is S01E01, not S01E02.
    expect(previewFilenames({ ...base, selectedIndices: [0, 1, 2], contentTypes: { 0: 'trailer' } })).toEqual([
      'The Office (2005)-trailer.mkv',
      'The Office S01E01.mkv',
      'The Office S01E02.mkv',
    ]);
  });

  it('names a movie and its versions, leaving extras out of the count', () => {
    const movie = { ...base, mediaType: 'movie' as const, title: 'Alien', year: 1979 };
    expect(previewFilenames({ ...movie, selectedIndices: [0, 3], contentTypes: { 3: 'featurette' } })).toEqual([
      'Alien (1979).mkv',
      'Alien (1979)-featurette.mkv',
    ]);
    expect(previewFilenames({ ...movie, selectedIndices: [0, 1, 3], contentTypes: { 3: 'featurette' } })).toEqual([
      'Alien (1979) - Version 1.mkv',
      'Alien (1979) - Version 2.mkv',
      'Alien (1979)-featurette.mkv',
    ]);
  });

  it('names special features and custom names, and falls back to the position without a name', () => {
    expect(previewFilenames({
      ...base,
      selectedIndices: [0, 1, 2],
      assignments: { 0: { type: 'special' }, 1: { type: 'custom', name: ' Gag Reel ' }, 2: { type: 'custom', name: '' } },
    })).toEqual([
      'The Office SpecialFeature001.mkv',
      'The Office Gag Reel.mkv',
      'The Office S01E03.mkv',
    ]);
  });

  it('strips what a file name cannot hold from a show title, and marks a repeated name', () => {
    expect(previewFilenames({
      ...base,
      title: 'Who: What?',
      selectedIndices: [0, 1],
      assignments: { 0: { type: 'custom', name: 'Extra' }, 1: { type: 'custom', name: 'Extra' } },
    })).toEqual(['Who What Extra.mkv', 'Who What Extra - Copy 2.mkv']);
  });

  it('is empty without a title or a selection', () => {
    expect(previewFilenames({ ...base, title: ' ', selectedIndices: [0] })).toEqual([]);
    expect(previewFilenames(base)).toEqual([]);
  });

  it('follows the request the page sends, in rip order', () => {
    const req = buildStartJobRequest({ ...base, selectedIndices: [2, 0], contentTypes: { 2: 'clip' } });
    expect(plannedOutputNames(req)).toEqual(['The Office (2005)-clip.mkv', 'The Office S01E01.mkv']);
    // An older request shape: only the legacy map says what is an extra.
    expect(plannedOutputNames({ ...req, titles: undefined })).toEqual(plannedOutputNames(req));
  });

  it('has a file name suffix for every extras category', () => {
    expect(Object.keys(EXTRAS_FILENAME_SUFFIX).sort()).toEqual([...EXTRAS_CATEGORIES].sort());
  });
});

describe('repeats and near matches', () => {
  it('does not call two sketches of nearly the same length and size the same', () => {
    // 2:12 / 108 MB and 2:13 / 109 MB: different video.
    const hints = analyzeTitles([t(7, 132, 108_000_000), t(8, 133, 109_000_000)]);
    expect(hints[7]).toEqual({ kind: 'short' });
    expect(hints[8]).toEqual({ kind: 'possible_duplicate', of: 7, short: true });
    expect(titleHintLabel(hints[8])).toBe('Short clip, possibly the same as title 7');
    expect(titleHintNote(hints[8])).toMatch(/not identical/);
    expect(titleHintNote(hints[7])).toBeNull();
  });

  it('does not call the same length with a different size the same', () => {
    const hints = analyzeTitles([t(0, 132, 108_000_000), t(1, 132, 108_500_000)]);
    expect(hints[1]).toEqual({ kind: 'possible_duplicate', of: 0, short: true });
  });

  it('calls identical length and size the same', () => {
    expect(analyzeTitles([t(6, 158, 126_507_008), t(11, 158, 126_507_008)])[11]).toEqual({ kind: 'duplicate', of: 6 });
  });

  it('still calls a repeat that differs by a few disc sectors the same', () => {
    // Burn Notice S1 D1 lists the pilot twice, 10 KB apart.
    expect(analyzeTitles([t(0, 3974, 3_472_046_080), t(3, 3974, 3_472_035_840)])[3]).toEqual({ kind: 'duplicate', of: 0 });
  });

  it('does not flag episodes of one play-all as possibly the same', () => {
    // Everybody Loves Raymond S6 D1: five episodes within nine seconds of each other.
    const hints = analyzeTitles([
      t(0, 6721, 5_600_000_000),
      t(1, 1347, 1_100_000_000), t(2, 1343, 1_098_000_000), t(3, 1346, 1_101_000_000),
      t(4, 1347, 1_102_000_000), t(5, 1338, 1_095_000_000),
    ]);
    expect(hints[0]).toEqual({ kind: 'play_all', of: [1, 2, 3, 4, 5] });
    expect([1, 2, 3, 4, 5].map((i) => hints[i])).toEqual([undefined, undefined, undefined, undefined, undefined]);
  });

  it('keeps a long near match selected, with a note, and a real repeat unselected', () => {
    const hints = analyzeTitles([t(0, 1320, 1_200_000_000), t(1, 1321, 1_205_000_000), t(2, 1320, 1_200_000_000)]);
    expect(hints[1]).toEqual({ kind: 'possible_duplicate', of: 0, short: false });
    expect(titleHintLabel(hints[1])).toBe('Possibly the same as title 0');
    expect(isPreselected(hints[0])).toBe(true);
    expect(isPreselected(hints[1])).toBe(true);
    expect(isPreselected(hints[2])).toBe(false);
    expect(isPreselected({ kind: 'short' })).toBe(false);
    expect(isPreselected({ kind: 'possible_duplicate', of: 7, short: true })).toBe(false);
  });

  it('without sizes, equal lengths are only possibly the same', () => {
    expect(analyzeTitles([t(0, 1320), t(1, 1320)])[1]).toEqual({ kind: 'possible_duplicate', of: 0, short: false });
    expect(analyzeTitles([t(0, 1320), t(1, 1321)])).toEqual({});
  });
});

describe('titles a play-all leaves out', () => {
  // Five ~22 minute episodes, their play-all, and a 25 minute featurette.
  const disc = [
    t(0, 1320, 1_000_000_000), t(1, 1325, 1_010_000_000), t(2, 1310, 990_000_000),
    t(3, 1330, 1_020_000_000), t(4, 1318, 1_005_000_000),
    t(5, 6603, 5_025_000_000), t(6, 1500, 1_100_000_000),
  ];
  const hints = analyzeTitles(disc);

  it('defaults the title outside the play-all to an extra', () => {
    expect(hints[5]).toEqual({ kind: 'play_all', of: [0, 1, 2, 3, 4] });
    expect(defaultsToExtra(6, disc, hints)).toBe(true);
    expect([0, 1, 2, 3, 4].some((i) => defaultsToExtra(i, disc, hints))).toBe(false);
    expect(defaultsToExtra(5, disc, hints)).toBe(false);
  });

  it('gives the extra no episode number', () => {
    const assigned = autoAssignEpisodes({
      selectedIndices: [0, 1, 2, 3, 4, 6], titles: disc, episodes: eps(6), contentTypes: { 6: 'clip' },
    });
    expect(Object.keys(assigned)).toEqual(['0', '1', '2', '3', '4']);
    expect(assigned[4]).toMatchObject({ type: 'episode', episodeNumber: 5 });
  });

  it('keeps today\'s behaviour on a disc without a play-all', () => {
    const plain = [t(0, 1320, 1e9), t(1, 1325, 1.01e9), t(2, 1500, 1.1e9)];
    const plainHints = analyzeTitles(plain);
    expect(plain.some((x) => defaultsToExtra(x.index, plain, plainHints))).toBe(false);
    const assigned = autoAssignEpisodes({ selectedIndices: [0, 1, 2], titles: plain, episodes: eps(6) });
    expect(assigned[2]).toMatchObject({ type: 'episode', episodeNumber: 3 });
  });

  it('keeps a double-length episode the play-all leaves out as an episode', () => {
    // Burn Notice S1 D1: the play-all joins titles 1 and 2; title 0 is the 66 minute pilot.
    const burn = [t(0, 3974, 3_472_046_080), t(1, 2529, 2_225_668_096), t(2, 2513, 2_204_901_376), t(4, 5042, 4_430_559_232)];
    const burnHints = analyzeTitles(burn);
    expect(burnHints[4]).toEqual({ kind: 'play_all', of: [1, 2] });
    expect(defaultsToExtra(0, burn, burnHints)).toBe(false);
  });

  it('treats an exact repeat of an episode as an episode, and a short clip as an extra', () => {
    const more = [...disc, t(7, 1320, 1_000_000_000), t(8, 120, 90_000_000)];
    const moreHints = analyzeTitles(more);
    expect(moreHints[7]).toEqual({ kind: 'duplicate', of: 0 });
    expect(defaultsToExtra(7, more, moreHints)).toBe(false);
    expect(defaultsToExtra(8, more, moreHints)).toBe(true);
  });
});

describe('episode numbering after what already exists', () => {
  const titles = [t(0, 1320), t(1, 1325), t(2, 1310), t(3, 1330), t(4, 1318), t(5, 90)];

  it('starts after the episodes already held', () => {
    const assigned = autoAssignEpisodes({
      selectedIndices: [4, 0, 1, 2, 3, 5], titles, episodes: eps(22), held: new Set([1, 2, 3, 4, 5]),
    });
    expect([0, 1, 2, 3, 4].map((i) => (assigned[i] as { episodeNumber: number }).episodeNumber)).toEqual([6, 7, 8, 9, 10]);
    expect(assigned[5]).toEqual({ type: 'special' });
  });

  it('skips a held episode in the middle and runs out into special features', () => {
    const assigned = autoAssignEpisodes({
      selectedIndices: [0, 1, 2], titles, episodes: eps(4), held: new Set([1, 3]),
    });
    expect(assigned[0]).toMatchObject({ episodeNumber: 2 });
    expect(assigned[1]).toMatchObject({ episodeNumber: 4 });
    expect(assigned[2]).toEqual({ type: 'special' });
  });

  it('numbers from the first episode when nothing is held, or everything is', () => {
    expect(autoAssignEpisodes({ selectedIndices: [0, 1], titles, episodes: eps(3) })[0]).toMatchObject({ episodeNumber: 1 });
    expect(autoAssignEpisodes({ selectedIndices: [0, 1], titles, episodes: eps(3), held: new Set([1, 2, 3]) })[1])
      .toMatchObject({ episodeNumber: 2 });
  });

  const rip = (over: Partial<StoredRip>): StoredRip => ({
    id: 'r1', status: 'delivered', discId: 'disc-1', title: 'The Office', year: 2005, season: 1,
    volumeLabel: null, deliveredAt: null, ripStartedAt: null, fingerprint: 'aaa', ...over,
  });

  it('collects episodes from library files and other discs\' rips, ranges included', () => {
    const held = heldEpisodeNumbers({
      season: 1,
      librarySeasons: [
        { seasonNumber: 1, episodes: [{ episodeNumber: 1 }, { episodeNumber: 2, episodeEndNumber: 3 }, { episodeNumber: 9, isAvailable: false }, { episodeNumber: null }] },
        { seasonNumber: 2, episodes: [{ episodeNumber: 7 }] },
      ],
      rips: [rip({
        titles: [
          { titleIndex: 0, status: 'delivered', season: 1, episode: 4, episodeEnd: 5 },
          { titleIndex: 1, status: 'failed', season: 1, episode: 6 },
          { titleIndex: 2, status: 'delivered', contentType: 'clip' },
          { titleIndex: 3, status: 'delivered', season: 2, episode: 8 },
        ],
      })],
      fingerprint: 'bbb',
    });
    expect([...held].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
  });

  it('does not count what an earlier rip of the disc in the drive produced', () => {
    const held = heldEpisodeNumbers({
      season: 1,
      librarySeasons: [{ seasonNumber: 1, episodes: [1, 2, 3, 4, 5, 6].map((n) => ({ episodeNumber: n })) }],
      rips: [
        rip({ id: 'disc1', fingerprint: 'aaa', titles: [1, 2, 3].map((n) => ({ titleIndex: n, status: 'delivered', episode: n })) }),
        rip({ id: 'disc2', fingerprint: 'bbb', titles: [4, 5, 6].map((n) => ({ titleIndex: n, status: 'delivered', episode: n })) }),
        rip({ id: 'dead', status: 'failed', fingerprint: 'ccc', titles: [{ titleIndex: 0, status: 'ripped', episode: 7 }] }),
      ],
      fingerprint: 'bbb',
    });
    expect([...held].sort((a, b) => a - b)).toEqual([1, 2, 3]);
  });

  it('is empty when nothing is known', () => {
    expect(heldEpisodeNumbers({ season: 1 }).size).toBe(0);
    expect(heldEpisodeNumbers({ season: 1, librarySeasons: null, rips: [] }).size).toBe(0);
  });

  it('writes episode numbers as ranges', () => {
    expect(formatEpisodeNumbers([5, 1, 2, 3, 7])).toBe('1–3, 5, 7');
    expect(formatEpisodeNumbers(new Set([4]))).toBe('4');
  });
});

describe('boxesNamed', () => {
  const boxes = [
    { id: 'a', title: 'Burn Notice: Season 1' },
    { id: 'b', title: 'Burn Notice: Season 1 (Blu-ray)' },
    { id: 'c', title: ' burn notice: season 1 ' },
  ];

  it('keeps only boxes with exactly the name, ignoring case and outer spaces', () => {
    expect(boxesNamed('  BURN NOTICE: Season 1', boxes).map((b) => b.id)).toEqual(['a', 'c']);
    expect(boxesNamed('Burn Notice', boxes)).toEqual([]);
    expect(boxesNamed('  ', boxes)).toEqual([]);
  });
});
