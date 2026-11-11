import { describe, expect, it } from 'vitest';

import {
  ATTENTION_KINDS,
  attentionCountLabel,
  countByKind,
  defaultKind,
  filterItems,
  groupByTitle,
  isRenamableFile,
  itemActions,
  itemFile,
  kindMeta,
  kindsWithItems,
  summarizeItems,
  titleHref,
  todoHref,
} from '@/service/attention/attentionModel';
import { attentionItem } from './attentionFixtures';

describe('attention kind metadata', () => {
  it('lists the seven kinds in order with plain labels', () => {
    expect(ATTENTION_KINDS.map((k) => k.label)).toEqual([
      'Needs assignment',
      'Needs renaming',
      'Needs a second look',
      'Missing files',
      'No source disc',
      'No technical details',
      'Unripped discs',
    ]);
    expect(ATTENTION_KINDS.map((k) => k.order)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(kindMeta('needs_rename').emptyText).toBe('Nothing needs renaming');
    expect(ATTENTION_KINDS.filter((k) => !k.inBadge).map((k) => k.kind)).toEqual(['unprobed', 'unripped_disc']);
    for (const meta of ATTENTION_KINDS) expect(meta.icon).toBeTruthy();
  });

  it('picks the first kind with items as the default and counts items', () => {
    expect(defaultKind({ needs_assignment: 0, needs_rename: 0, needs_review: 3 })).toBe('needs_review');
    expect(defaultKind({})).toBe('needs_assignment');
    expect(defaultKind(null)).toBe('needs_assignment');
    const counts = countByKind([attentionItem(), attentionItem({ id: 'x', kind: 'missing_file' })]);
    expect(counts.needs_rename).toBe(1);
    expect(counts.missing_file).toBe(1);
    expect(counts.needs_review).toBe(0);
    expect(kindsWithItems({ needs_rename: 2, unprobed: 4 }).map((k) => [k.kind, k.count])).toEqual([['needs_rename', 2], ['unprobed', 4]]);
  });

  it('builds links and the badge label', () => {
    expect(todoHref({ kind: 'needs_rename' })).toBe('/organize/todo?kind=needs_rename');
    expect(todoHref({ mediaType: 'movie', mediaId: 'm 1' })).toBe('/organize/todo?mediaType=movie&mediaId=m+1');
    expect(todoHref({ mediaType: 'movie' })).toBe('/organize/todo');
    expect(titleHref(attentionItem())).toBe('/dashboard/my-library/movie/m1?tab=files');
    expect(titleHref(attentionItem(), 'discs')).toBe('/dashboard/my-library/movie/m1?tab=discs');
    expect(titleHref(attentionItem({ mediaId: null }))).toBeNull();
    expect(attentionCountLabel(6)).toBe('6 items need attention');
    expect(attentionCountLabel(1)).toBe('1 item needs attention');
  });
});

describe('itemActions', () => {
  it('assigns a queue item through the ingest dialog', () => {
    const actions = itemActions(attentionItem({
      kind: 'needs_assignment', subjectType: 'queue_item', subjectId: 'q1', queueItemId: 'q1', mediaId: null,
      queue: { status: 'needs_review', reviewReason: null, lastError: null, confidence: 40, bestMatchTitle: null, bestMatchYear: null, bestMatchMediaType: null, proposedPath: null },
    }));
    expect(actions.primary).toEqual({ type: 'assign-queue', label: 'Assign…', queueItemId: 'q1', queueStatus: 'needs_review' });
    expect(actions.secondary[0]).toMatchObject({ type: 'link', href: '/ingress-automation' });
  });

  it('reassigns a library file with no title', () => {
    const actions = itemActions(attentionItem({ kind: 'needs_assignment', mediaId: null, filePath: '/lib/x/a.mkv' }));
    expect(actions.primary).toMatchObject({ type: 'reassign-file', filePath: '/lib/x/a.mkv', fileName: 'a.mkv' });
  });

  it('renames files, and links title folders and findings with a note', () => {
    expect(itemActions(attentionItem()).primary).toEqual({ type: 'rename', label: 'Rename…', fileId: 'f1' });
    const folder = itemActions(attentionItem({ subjectType: 'title', subjectId: 'm1', catalogType: 'series' }));
    expect(folder.primary).toMatchObject({ type: 'link', href: '/organize/rename?type=shows' });
    expect(folder.note).toMatch(/no automatic fix/);
    const finding = itemActions(attentionItem({ subjectType: 'finding' }));
    expect(finding.primary).toMatchObject({ type: 'link', href: '/admin?view=LibraryCompliance' });
    expect(finding.note).toMatch(/no automatic fix/);
  });

  it('clears hand flags, sends unconfirmed extras to Extras Review, else opens the files', () => {
    const flagged = itemActions(attentionItem({ kind: 'needs_review', reasons: ['flagged'], dismissible: false }));
    expect(flagged.primary).toEqual({ type: 'clear-flag', label: 'Clear flag', fileId: 'f1' });
    expect(itemActions(attentionItem({ kind: 'needs_review', reasons: ['extra_unconfirmed'] })).primary)
      .toMatchObject({ type: 'link', href: '/admin?view=ExtrasReview' });
    expect(itemActions(attentionItem({ kind: 'needs_review', reasons: ['low_confidence'] })).primary)
      .toMatchObject({ type: 'link', href: '/dashboard/my-library/movie/m1?tab=files' });
  });

  it('opens the title for missing and unprobed files, with a rescan', () => {
    for (const kind of ['missing_file', 'unprobed'] as const) {
      const actions = itemActions(attentionItem({ kind }));
      expect(actions.primary).toMatchObject({ type: 'link', href: '/dashboard/my-library/movie/m1?tab=files' });
      expect(actions.secondary).toEqual([{ type: 'rescan', label: 'Rescan library' }]);
    }
  });

  it('links a disc from no_disc_link, and opens disc pages for unripped discs', () => {
    const link = itemActions(attentionItem({ kind: 'no_disc_link', subjectType: 'title', subjectId: 'm1', discId: 'd1', expected: 'Inception Blu-ray' }));
    expect(link.primary).toEqual({ type: 'link-disc', label: 'Link files…', discId: 'd1', discTitle: 'Inception Blu-ray', mediaType: 'movie', mediaId: 'm1' });
    expect(link.secondary[0]).toMatchObject({ href: '/dashboard/my-library/movie/m1?tab=discs' });
    const disc = itemActions(attentionItem({ kind: 'unripped_disc', subjectType: 'disc', subjectId: 'd9', discId: 'd9', mediaId: null }));
    expect(disc.primary).toMatchObject({ type: 'link', href: '/dashboard/physical-media/discs/d9' });
    expect(disc.secondary[0]).toMatchObject({ href: '/admin/disc-ripper' });
  });

  it('builds a MediaFile from the item when the FileDTO is absent', () => {
    expect(itemFile(attentionItem())).toMatchObject({ id: 'f1', fileName: 'inception.mkv' });
    expect(itemFile(attentionItem({ subjectType: 'title' }))).toBeNull();
    expect(isRenamableFile(attentionItem())).toBe(true);
    expect(isRenamableFile(attentionItem({ subjectType: 'title' }))).toBe(false);
  });
});

describe('filtering, grouping and summaries', () => {
  const items = [
    attentionItem(),
    attentionItem({ id: 'b', subjectId: 'f2', title: 'Rename heat.mkv', mediaId: 'm2', mediaTitle: 'Heat', filePath: '/lib/heat.mkv', relativePath: null, current: null, expected: null }),
    attentionItem({ id: 'c', subjectId: 'f3', kind: 'needs_review', reasons: ['flagged'], title: 'Check extra.mkv' }),
    attentionItem({ id: 'd', kind: 'needs_assignment', subjectType: 'queue_item', mediaId: null, mediaTitle: null, title: 'Assign orphan.mkv', filePath: null, relativePath: null, current: null, expected: null }),
  ];

  it('filters by title, title name and file name', () => {
    expect(filterItems(items, 'heat').map((i) => i.id)).toEqual(['b']);
    expect(filterItems(items, 'INCEPTION').map((i) => i.id)).toEqual(['needs_rename:media_file:f1', 'c']);
    expect(filterItems(items, 'orphan').map((i) => i.id)).toEqual(['d']);
    expect(filterItems(items, '  ')).toHaveLength(4);
  });

  it('groups by title in first-appearance order with untitled last', () => {
    const groups = groupByTitle(items);
    expect(groups.map((g) => [g.mediaTitle, g.items.length])).toEqual([['Inception', 2], ['Heat', 1], ['No title yet', 1]]);
  });

  it('summarizes a title in plain words', () => {
    expect(summarizeItems([items[0], items[1], items[2]])).toBe('2 files need renaming · 1 flagged for a second look');
    expect(summarizeItems([attentionItem({ subjectType: 'title' })])).toBe('The folder needs renaming');
    expect(summarizeItems([attentionItem({ kind: 'missing_file' })])).toBe('1 file missing');
    expect(summarizeItems([])).toBe('');
  });
});
