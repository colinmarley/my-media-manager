import { describe, expect, it } from 'vitest';
import {
  assignedEpisodeNumbers, buildStartJobRequest, episodeRangeName, episodeValue, previewFilenames, rangeEnd,
  startJobBlocker, suggestedRangeEnd, type StartJobInput,
} from '@/app/admin/disc-ripper/_components/discRipperUtils';
import { discSavePlan, nextDiscNumber } from '@/app/admin/disc-ripper/_components/DiscCatalogLinkPanel';

const base: StartJobInput = {
  discType: 'dvd',
  mediaType: 'show',
  title: '  Firefly ',
  year: 2002,
  imdbId: ' tt0303461 ',
  tmdbId: 1437,
  season: 1,
  selectedIndices: [],
  assignments: {},
  contentTypes: {},
  episodes: [],
  catalogDiscId: 'disc-1',
  scanId: 'scan-1',
};

describe('buildStartJobRequest', () => {
  it('sends the TMDB id, scan id and disc for a movie', () => {
    const req = buildStartJobRequest({
      ...base, mediaType: 'movie', discType: 'bluray', title: 'Gone Girl', year: 2014,
      imdbId: 'tt2267998', tmdbId: 210577, selectedIndices: [0],
    });
    expect(req).toMatchObject({
      disc_type: 'bluray', media_type: 'movie', title: 'Gone Girl', year: 2014,
      imdb_id: 'tt2267998', tmdb_id: 210577, catalog_disc_id: 'disc-1', scan_id: 'scan-1',
      mkv_title_indices: [0],
    });
    expect(req.season).toBeUndefined();
    expect(req.episode_map).toBeUndefined();
    expect(req.title_content_types).toBeUndefined();
    expect(req.titles).toEqual([{ title_index: 0, content_type: 'main_feature', is_main_feature: true }]);
  });

  it('marks no single main feature when a movie disc has several', () => {
    const req = buildStartJobRequest({
      ...base, mediaType: 'movie', selectedIndices: [0, 1, 4], contentTypes: { 4: 'trailer' },
    });
    expect(req.titles).toEqual([
      { title_index: 0, content_type: 'main_feature', is_main_feature: false },
      { title_index: 1, content_type: 'main_feature', is_main_feature: false },
      { title_index: 4, content_type: 'trailer' },
    ]);
    expect(req.title_content_types).toEqual({ 4: 'trailer' });
  });

  it('one feature plus extras is still the main feature', () => {
    const req = buildStartJobRequest({
      ...base, mediaType: 'movie', selectedIndices: [0, 4], contentTypes: { 4: 'featurette' },
    });
    expect(req.titles?.[0]).toEqual({ title_index: 0, content_type: 'main_feature', is_main_feature: true });
  });

  it('declares episodes with their TMDB episode ids and keeps episode_map', () => {
    const req = buildStartJobRequest({
      ...base,
      selectedIndices: [3, 2],
      assignments: {
        2: { type: 'episode', episodeNumber: 5, episodeName: 'Safe' },
        3: { type: 'episode', episodeNumber: 6, episodeName: '' },
      },
      episodes: [
        { episodeNumber: 5, name: 'Safe', tmdbId: 85399 },
        { episodeNumber: 6, name: 'Our Mrs. Reynolds' },
      ],
    });
    expect(req.title).toBe('Firefly');
    expect(req.imdb_id).toBe('tt0303461');
    expect(req.season).toBe(1);
    expect(req.mkv_title_indices).toEqual([3, 2]);
    expect(req.episode_map).toEqual({ 2: 'S01E05 - Safe', 3: 'S01E06' });
    expect(req.titles).toEqual([
      { title_index: 2, content_type: 'episode', season: 1, episode: 5, episode_name: 'Safe', tmdb_episode_id: 85399 },
      { title_index: 3, content_type: 'episode', season: 1, episode: 6 },
    ]);
  });

  it('declares a two-part episode on one title as a range', () => {
    const req = buildStartJobRequest({
      ...base,
      title: 'Burn Notice',
      selectedIndices: [4, 5],
      assignments: {
        4: { type: 'episode', episodeNumber: 11, episodeName: 'Dead Drop', episodeEndNumber: 12 },
        // An end that is not after the episode is no range.
        5: { type: 'episode', episodeNumber: 10, episodeName: 'False Flag', episodeEndNumber: 10 },
      },
      episodes: [
        { episodeNumber: 10, name: 'False Flag' },
        { episodeNumber: 11, name: 'Dead Drop', tmdbId: 111 },
        { episodeNumber: 12, name: 'Loose Ends', tmdbId: 112 },
      ],
    });
    // episode_map is what the ripper names the file from.
    expect(req.episode_map).toEqual({
      4: 'S01E11-E12 - Dead Drop and Loose Ends',
      5: 'S01E10 - False Flag',
    });
    expect(req.titles).toEqual([
      {
        title_index: 4, content_type: 'episode', season: 1, episode: 11, episode_end: 12,
        episode_name: 'Dead Drop and Loose Ends', tmdb_episode_id: 111,
      },
      { title_index: 5, content_type: 'episode', season: 1, episode: 10, episode_name: 'False Flag' },
    ]);
  });

  it('handles specials, custom names, extras and unassigned titles on a show disc', () => {
    const req = buildStartJobRequest({
      ...base,
      selectedIndices: [0, 1, 2, 3, 4, 5],
      assignments: {
        0: { type: 'special' },
        1: { type: 'custom', name: ' Gag Reel ' },
        2: { type: 'episode', episodeNumber: 1, episodeName: 'Serenity' },
        3: { type: 'special' },
        4: { type: 'custom', name: '   ' },
      },
      contentTypes: { 2: 'deleted_scene', 5: '' },
    });
    // The extras-tagged title gets no episode code even though one was assigned.
    expect(req.episode_map).toEqual({ 0: 'SpecialFeature001', 1: 'Gag Reel', 3: 'SpecialFeature002' });
    expect(req.title_content_types).toEqual({ 2: 'deleted_scene' });
    expect(req.titles).toEqual([
      { title_index: 0, content_type: 'special_feature', custom_name: 'SpecialFeature001' },
      { title_index: 1, custom_name: 'Gag Reel' },
      { title_index: 2, content_type: 'deleted_scene' },
      { title_index: 3, content_type: 'special_feature', custom_name: 'SpecialFeature002' },
      { title_index: 4 },
      { title_index: 5 },
    ]);
  });

  it('omits ids that are not known', () => {
    const req = buildStartJobRequest({ ...base, tmdbId: null, imdbId: '  ', scanId: undefined, selectedIndices: [0] });
    expect(req.tmdb_id).toBeUndefined();
    expect(req.imdb_id).toBeUndefined();
    expect(req.scan_id).toBeUndefined();
  });
});

describe('startJobBlocker', () => {
  const ok = { title: 'Firefly', year: 2002, selectedIndices: [0], linkedDiscId: 'disc-1' };

  it('allows a complete request', () => {
    expect(startJobBlocker(ok)).toBeNull();
  });

  it('requires a linked disc', () => {
    expect(startJobBlocker({ ...ok, linkedDiscId: null })).toMatch(/disc/i);
    expect(startJobBlocker({ ...ok, linkedDiscId: undefined })).toMatch(/disc/i);
  });

  it('reports the form problems first', () => {
    expect(startJobBlocker({ ...ok, title: ' ', linkedDiscId: null })).toBe('Title is required');
    expect(startJobBlocker({ ...ok, year: 1700 })).toBe('Enter a valid year');
    expect(startJobBlocker({ ...ok, selectedIndices: [] })).toBe('Select at least one title to rip');
  });
});

describe('discSavePlan', () => {
  const form = {
    releaseTitle: ' Burn Notice: The Complete First Season ', releaseId: null, discNumber: '1',
    discCount: '4', edition: '', format: 'DVD' as const, barcode: ' 024543519317 ',
  };

  it('names a disc of a box after the box and its number', () => {
    expect(discSavePlan(form)).toEqual({
      release: {
        title: 'Burn Notice: The Complete First Season', barcode: '024543519317', edition: undefined,
        packaging: 'box_set', expectedDiscCount: 4,
      },
      disc: {
        title: 'Burn Notice: The Complete First Season - Disc 1', discNumber: 1, edition: undefined,
        format: 'DVD', isPartOfSet: true,
      },
    });
  });

  it('treats a disc with no count as the only disc in its case', () => {
    const plan = discSavePlan({ ...form, releaseTitle: 'Alien (1979)', discNumber: '', discCount: '', edition: " Director's Cut " });
    expect(plan.release).toMatchObject({ packaging: 'case', expectedDiscCount: 1, edition: "Director's Cut" });
    expect(plan.disc).toMatchObject({ title: 'Alien (1979)', discNumber: 1, isPartOfSet: false });
  });

  it('grows the box to hold the disc number typed', () => {
    const plan = discSavePlan({ ...form, discNumber: '3', discCount: '' });
    expect(plan.release.expectedDiscCount).toBe(3);
    expect(plan.disc.title).toBe('Burn Notice: The Complete First Season - Disc 3');
  });

  it('falls back to a placeholder name', () => {
    expect(discSavePlan({ ...form, releaseTitle: ' ', discNumber: '0', discCount: '1' }).disc.title).toBe('Untitled Disc');
  });
});

describe('episode ranges on the rip page', () => {
  const episodes = [
    { episodeNumber: 10, name: 'False Flag', runtime: 43 },
    { episodeNumber: 11, name: 'Dead Drop', runtime: 42 },
    { episodeNumber: 12, name: 'Loose Ends', runtime: 42 },
    { episodeNumber: 13, name: 'Extra', runtime: 44 },
  ];

  it('previews the file name the ripper will give a range', () => {
    expect(previewFilenames('show', 'Burn Notice', 2007, [4, 5, 6], {
      4: { type: 'episode', episodeNumber: 11, episodeName: 'Dead Drop', episodeEndNumber: 12 },
      5: { type: 'episode', episodeNumber: 10, episodeName: 'False Flag' },
    }, 1, episodes)).toEqual([
      'Burn Notice S01E11-E12 - Dead Drop and Loose Ends.mkv',
      'Burn Notice S01E10 - False Flag.mkv',
      'Burn Notice S01E03.mkv',
    ]);
  });

  it('names a range after every episode in it, once each', () => {
    const three = { type: 'episode' as const, episodeNumber: 10, episodeName: 'False Flag', episodeEndNumber: 12 };
    expect(episodeRangeName(three, episodes)).toBe('False Flag, Dead Drop and Loose Ends');
    expect(episodeValue(1, three, episodes)).toBe('S01E10-E12 - False Flag, Dead Drop and Loose Ends');
    // Episodes the list does not know add nothing to the name.
    expect(episodeValue(2, { type: 'episode', episodeNumber: 1, episodeName: '', episodeEndNumber: 2 }, []))
      .toBe('S02E01-E02');
    expect(rangeEnd({ type: 'episode', episodeNumber: 5, episodeName: '', episodeEndNumber: 4 })).toBeNull();
  });

  it('counts every episode of a range as taken', () => {
    expect([...assignedEpisodeNumbers({
      0: { type: 'episode', episodeNumber: 11, episodeName: '', episodeEndNumber: 12 },
      1: { type: 'special' },
      2: { type: 'episode', episodeNumber: 3, episodeName: '' },
    })].sort((a, b) => a - b)).toEqual([3, 11, 12]);
  });

  it('suggests a range only for a title about twice an episode long', () => {
    expect(suggestedRangeEnd(83 * 60, 11, episodes)).toBe(12);
    expect(suggestedRangeEnd(43 * 60, 11, episodes)).toBeNull();
    expect(suggestedRangeEnd(130 * 60, 11, episodes)).toBeNull();
    // Nothing follows the last episode, and without runtimes there is no usual length.
    expect(suggestedRangeEnd(83 * 60, 13, episodes)).toBeNull();
    expect(suggestedRangeEnd(83 * 60, 11, [{ episodeNumber: 11, name: 'a' }, { episodeNumber: 12, name: 'b' }])).toBeNull();
  });
});

describe('nextDiscNumber', () => {
  it('is the lowest number the box does not have', () => {
    expect(nextDiscNumber([])).toBe(1);
    expect(nextDiscNumber([{ discNumber: 1 }, { discNumber: 3 }, { discNumber: null }])).toBe(2);
  });
});
