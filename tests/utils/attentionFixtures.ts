/** Shared To-Do item fixtures for the attention tests. */
import type { AttentionItem, AttentionSummary } from '@/types/attention/Attention.type';

export const attentionItem = (overrides: Partial<AttentionItem> = {}): AttentionItem => ({
  id: 'needs_rename:media_file:f1',
  kind: 'needs_rename',
  subjectType: 'media_file',
  subjectId: 'f1',
  title: 'Rename inception.mkv',
  detail: 'The file name does not match the library naming rules; rename it to fix this.',
  severity: 'medium',
  mediaType: 'movie',
  mediaId: 'm1',
  mediaTitle: 'Inception',
  catalogType: 'movie',
  filePath: '/lib/Movies/Inception (2010)/inception.mkv',
  relativePath: 'Movies/Inception (2010)/inception.mkv',
  current: 'Movies/Inception (2010)/inception.mkv',
  expected: 'Movies/Inception (2010)/Inception (2010).mkv',
  queueItemId: null,
  discId: null,
  file: null,
  createdAt: null,
  dismissible: true,
  fingerprint: 'fp',
  reasons: ['file_name'],
  queue: null,
  ...overrides,
});

export const attentionSummary = (counts: Partial<AttentionSummary['counts']> = {}): AttentionSummary => {
  const full = {
    needs_assignment: 0, needs_rename: 0, needs_review: 0, missing_file: 0, no_disc_link: 0, unprobed: 0, unripped_disc: 0, ...counts,
  };
  const total = full.needs_assignment + full.needs_rename + full.needs_review + full.missing_file + full.no_disc_link;
  return { counts: full, total, generatedAt: '2026-11-11T12:00:00Z' };
};
