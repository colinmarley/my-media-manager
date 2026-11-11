/**
 * Display rules for the To-Do list: what each kind is called, which action fixes an item,
 * where its links go, and how items group by title. No React state and no requests here.
 */
import type { SvgIconComponent } from '@mui/icons-material';
import {
  AlbumOutlined,
  AssignmentIndOutlined,
  DriveFileRenameOutlineOutlined,
  LinkOffOutlined,
  ReportProblemOutlined,
  SearchOffOutlined,
  TroubleshootOutlined,
} from '@mui/icons-material';

import type { StatusTone } from '@/theme/tokens';
import type { AttentionItem, AttentionKind, AttentionSeverity } from '@/types/attention/Attention.type';
import type { MediaFile } from '@/types/library/MediaFile.type';

export interface AttentionKindMeta {
  kind: AttentionKind;
  label: string;
  description: string;
  /** Empty state for the kind's tab. */
  emptyText: string;
  icon: SvgIconComponent;
  tone: StatusTone;
  order: number;
  /** Counted in the sidebar badge (`summary.total`). */
  inBadge: boolean;
}

export const ATTENTION_KINDS: AttentionKindMeta[] = [
  {
    kind: 'needs_assignment',
    label: 'Needs assignment',
    description: 'Files that are not matched to a movie or show yet.',
    emptyText: 'Nothing needs assignment',
    icon: AssignmentIndOutlined,
    tone: 'error',
    order: 0,
    inBadge: true,
  },
  {
    kind: 'needs_rename',
    label: 'Needs renaming',
    description: 'Files or folders whose names do not match the library naming rules.',
    emptyText: 'Nothing needs renaming',
    icon: DriveFileRenameOutlineOutlined,
    tone: 'warning',
    order: 1,
    inBadge: true,
  },
  {
    kind: 'needs_review',
    label: 'Needs a second look',
    description: 'Files that were flagged, matched with low confidence, or look like duplicates.',
    emptyText: 'Nothing needs a second look',
    icon: TroubleshootOutlined,
    tone: 'warning',
    order: 2,
    inBadge: true,
  },
  {
    kind: 'missing_file',
    label: 'Missing files',
    description: 'Files the library knows about that are no longer on disk.',
    emptyText: 'No files are missing',
    icon: ReportProblemOutlined,
    tone: 'error',
    order: 3,
    inBadge: true,
  },
  {
    kind: 'no_disc_link',
    label: 'No source disc',
    description: 'Titles with a disc in the catalog whose files are not linked to it.',
    emptyText: 'Every title is linked to its disc',
    icon: LinkOffOutlined,
    tone: 'info',
    order: 4,
    inBadge: true,
  },
  {
    kind: 'unprobed',
    label: 'No technical details',
    description: 'Files that have not been scanned for resolution, codecs and duration yet.',
    emptyText: 'Every file has its technical details',
    icon: SearchOffOutlined,
    tone: 'neutral',
    order: 5,
    inBadge: false,
  },
  {
    kind: 'unripped_disc',
    label: 'Unripped discs',
    description: 'Discs in the catalog with no files ripped from them yet.',
    emptyText: 'Every disc has been ripped',
    icon: AlbumOutlined,
    tone: 'neutral',
    order: 6,
    inBadge: false,
  },
];

const META_BY_KIND = new Map(ATTENTION_KINDS.map((meta) => [meta.kind, meta]));

export const isAttentionKind = (value: string | null | undefined): value is AttentionKind =>
  Boolean(value) && META_BY_KIND.has(value as AttentionKind);

export function kindMeta(kind: AttentionKind): AttentionKindMeta {
  return META_BY_KIND.get(kind) ?? ATTENTION_KINDS[0];
}

export const SEVERITY_META: Record<AttentionSeverity, { label: string; tone: StatusTone }> = {
  high: { label: 'High', tone: 'error' },
  medium: { label: 'Medium', tone: 'warning' },
  low: { label: 'Low', tone: 'info' },
};

/** The first kind (in display order) with items, else the first kind. */
export function defaultKind(counts: Partial<Record<AttentionKind, number>> | null | undefined): AttentionKind {
  const withItems = ATTENTION_KINDS.find((meta) => (counts?.[meta.kind] ?? 0) > 0);
  return (withItems ?? ATTENTION_KINDS[0]).kind;
}

export function countByKind(items: AttentionItem[]): Record<AttentionKind, number> {
  const counts = Object.fromEntries(ATTENTION_KINDS.map((meta) => [meta.kind, 0])) as Record<AttentionKind, number>;
  for (const item of items) if (item.kind in counts) counts[item.kind] += 1;
  return counts;
}

/** Kinds with at least one item, in display order (Home tiles). */
export function kindsWithItems(counts: Partial<Record<AttentionKind, number>> | null | undefined): Array<AttentionKindMeta & { count: number }> {
  return ATTENTION_KINDS
    .map((meta) => ({ ...meta, count: counts?.[meta.kind] ?? 0 }))
    .filter((entry) => entry.count > 0);
}

// ---------------------------------------------------------------------------
// Links
// ---------------------------------------------------------------------------

export const TODO_PATH = '/organize/todo';
export const RENAME_ORGANIZE_PATH = '/organize/rename';
export const COMPLIANCE_PATH = '/admin?view=LibraryCompliance';
export const EXTRAS_REVIEW_PATH = '/admin?view=ExtrasReview';
export const INGEST_QUEUE_PATH = '/ingress-automation';
export const RIP_DISC_PATH = '/admin/disc-ripper';

export function todoHref(params: { kind?: string | null; mediaType?: string | null; mediaId?: string | null } = {}): string {
  const search = new URLSearchParams();
  if (params.kind) search.set('kind', params.kind);
  if (params.mediaType && params.mediaId) {
    search.set('mediaType', params.mediaType);
    search.set('mediaId', params.mediaId);
  }
  const qs = search.toString();
  return `${TODO_PATH}${qs ? `?${qs}` : ''}`;
}

/** The title detail page of the item's title, on the given tab; null without a title. */
export function titleHref(item: Pick<AttentionItem, 'mediaType' | 'catalogType' | 'mediaId'>, tab: 'files' | 'discs' = 'files'): string | null {
  const type = item.mediaType || item.catalogType;
  if (!type || !item.mediaId) return null;
  return `/dashboard/my-library/${encodeURIComponent(type)}/${encodeURIComponent(item.mediaId)}?tab=${tab}`;
}

export function discHref(discId: string): string {
  return `/dashboard/physical-media/discs/${encodeURIComponent(discId)}`;
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export type AttentionAction =
  | { type: 'assign-queue'; label: string; queueItemId: string; queueStatus: string | null }
  | { type: 'reassign-file'; label: string; filePath: string; fileName: string }
  | { type: 'rename'; label: string; fileId: string }
  | { type: 'clear-flag'; label: string; fileId: string }
  | { type: 'rescan'; label: string }
  | { type: 'link-disc'; label: string; discId: string; discTitle: string; mediaType: string; mediaId: string }
  | { type: 'link'; label: string; href: string };

export interface ItemActions {
  primary: AttentionAction | null;
  secondary: AttentionAction[];
  /** Shown under the row when there is no automatic fix. */
  note?: string;
}

const baseName = (path: string | null | undefined): string => (path ?? '').split(/[\\/]/).filter(Boolean).pop() ?? '';

/** The MediaFile the file dialogs need, from the item's FileDTO or its path. */
export function itemFile(item: AttentionItem): MediaFile | null {
  if (item.subjectType !== 'media_file') return null;
  if (item.file) return item.file;
  const filePath = item.filePath ?? '';
  return {
    id: item.subjectId,
    fileName: baseName(filePath) || item.title,
    filePath,
    fileSize: null,
    detectedMediaType: null,
    assignmentStatus: null,
    targetPath: null,
    organizationStatus: null,
    createdAt: item.createdAt,
    relativePath: item.relativePath,
  };
}

export const isHandFlagged = (item: AttentionItem): boolean =>
  item.kind === 'needs_review' && (item.reasons.includes('flagged') || !item.dismissible);

const openTitle = (item: AttentionItem, label = 'Open title', tab: 'files' | 'discs' = 'files'): AttentionAction | null => {
  const href = titleHref(item, tab);
  return href ? { type: 'link', label, href } : null;
};

const compact = (actions: Array<AttentionAction | null>): AttentionAction[] => actions.filter((a): a is AttentionAction => a !== null);

const renameTitleFolderHref = (item: AttentionItem) =>
  `${RENAME_ORGANIZE_PATH}?type=${item.catalogType === 'series' ? 'shows' : 'movies'}`;

/** The action that fixes an item, plus the other useful links. */
export function itemActions(item: AttentionItem): ItemActions {
  switch (item.kind) {
    case 'needs_assignment': {
      if (item.subjectType === 'queue_item' && (item.queueItemId || item.subjectId)) {
        return {
          primary: { type: 'assign-queue', label: 'Assign…', queueItemId: item.queueItemId || item.subjectId, queueStatus: item.queue?.status ?? null },
          secondary: [{ type: 'link', label: 'Open in Queue & Review', href: INGEST_QUEUE_PATH }],
        };
      }
      if (item.subjectType === 'media_file' && item.filePath) {
        return {
          primary: { type: 'reassign-file', label: 'Assign…', filePath: item.filePath, fileName: itemFile(item)?.fileName ?? item.title },
          secondary: compact([openTitle(item)]),
        };
      }
      return { primary: { type: 'link', label: 'Open Queue & Review', href: INGEST_QUEUE_PATH }, secondary: [] };
    }
    case 'needs_rename': {
      if (item.subjectType === 'media_file') {
        return { primary: { type: 'rename', label: 'Rename…', fileId: item.subjectId }, secondary: compact([openTitle(item)]) };
      }
      if (item.subjectType === 'finding') {
        return {
          primary: { type: 'link', label: 'Open Compliance', href: COMPLIANCE_PATH },
          secondary: compact([openTitle(item)]),
          note: 'There is no automatic fix for this one. Review it in Compliance.',
        };
      }
      return {
        primary: { type: 'link', label: 'Open Rename & Organize', href: renameTitleFolderHref(item) },
        secondary: compact([openTitle(item)]),
        note: 'Only the title folder name differs. There is no automatic fix here; rename it in Rename & Organize.',
      };
    }
    case 'needs_review': {
      const open = openTitle(item, 'Open title files');
      if (isHandFlagged(item) && item.subjectType === 'media_file') {
        return { primary: { type: 'clear-flag', label: 'Clear flag', fileId: item.subjectId }, secondary: compact([open]) };
      }
      if (item.reasons.includes('extra_unconfirmed')) {
        return { primary: { type: 'link', label: 'Open Extras Review', href: EXTRAS_REVIEW_PATH }, secondary: compact([open]) };
      }
      return { primary: open, secondary: [] };
    }
    case 'missing_file':
      return { primary: openTitle(item, 'Open title files'), secondary: [{ type: 'rescan', label: 'Rescan library' }] };
    case 'no_disc_link': {
      const type = item.mediaType || item.catalogType;
      const discs = openTitle(item, 'Open Discs & Tapes', 'discs');
      if (item.discId && type && item.mediaId) {
        return {
          primary: { type: 'link-disc', label: 'Link files…', discId: item.discId, discTitle: item.expected || 'Disc', mediaType: type, mediaId: item.mediaId },
          secondary: compact([discs]),
        };
      }
      return { primary: discs, secondary: [] };
    }
    case 'unprobed':
      return { primary: openTitle(item, 'Open title files'), secondary: [{ type: 'rescan', label: 'Rescan library' }] };
    case 'unripped_disc': {
      const discId = item.discId || item.subjectId;
      return {
        primary: { type: 'link', label: 'Open disc', href: discHref(discId) },
        secondary: [{ type: 'link', label: 'Rip Disc', href: RIP_DISC_PATH }],
      };
    }
    default:
      return { primary: openTitle(item), secondary: [] };
  }
}

/** Files that can go through the rename dialog (bulk "Rename selected"). */
export const isRenamableFile = (item: AttentionItem): boolean => item.kind === 'needs_rename' && item.subjectType === 'media_file';

// ---------------------------------------------------------------------------
// Filtering and grouping
// ---------------------------------------------------------------------------

/** Case-insensitive match on the item title, its title's name and the file name / paths. */
export function filterItems(items: AttentionItem[], query: string): AttentionItem[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return items;
  return items.filter((item) =>
    [item.title, item.mediaTitle, item.file?.fileName, item.filePath, item.relativePath, item.current, item.expected]
      .some((value) => (value ?? '').toLowerCase().includes(needle)),
  );
}

export interface AttentionTitleGroup {
  key: string;
  mediaType: string | null;
  mediaId: string | null;
  mediaTitle: string;
  items: AttentionItem[];
}

export const NO_TITLE_GROUP = 'No title yet';

/** Items grouped by the title they belong to, in first-appearance order; items without a title go last. */
export function groupByTitle(items: AttentionItem[]): AttentionTitleGroup[] {
  const groups = new Map<string, AttentionTitleGroup>();
  let untitled: AttentionTitleGroup | null = null;
  for (const item of items) {
    if (!item.mediaId) {
      untitled ??= { key: 'none', mediaType: null, mediaId: null, mediaTitle: NO_TITLE_GROUP, items: [] };
      untitled.items.push(item);
      continue;
    }
    const key = `${item.catalogType ?? item.mediaType}:${item.mediaId}`;
    let group = groups.get(key);
    if (!group) {
      group = { key, mediaType: item.mediaType || item.catalogType, mediaId: item.mediaId, mediaTitle: item.mediaTitle || 'Untitled', items: [] };
      groups.set(key, group);
    }
    group.items.push(item);
  }
  return [...groups.values(), ...(untitled ? [untitled] : [])];
}

// ---------------------------------------------------------------------------
// Summary phrases (title banner)
// ---------------------------------------------------------------------------

const s = (n: number) => (n === 1 ? '' : 's');

function phrase(kind: AttentionKind, items: AttentionItem[]): string {
  const n = items.length;
  const files = items.every((item) => item.subjectType === 'media_file');
  switch (kind) {
    case 'needs_assignment':
      return `${n} file${s(n)} need${n === 1 ? 's' : ''} assignment`;
    case 'needs_rename':
      if (!files && n === 1 && items[0].subjectType === 'title') return 'the folder needs renaming';
      return `${n} ${files ? 'file' : 'item'}${s(n)} need${n === 1 ? 's' : ''} renaming`;
    case 'needs_review':
      return items.every(isHandFlagged) ? `${n} flagged for a second look` : `${n} need${n === 1 ? 's' : ''} a second look`;
    case 'missing_file':
      return `${n} file${s(n)} missing`;
    case 'no_disc_link':
      return 'no files linked to its disc';
    case 'unprobed':
      return `${n} file${s(n)} without technical details`;
    case 'unripped_disc':
      return `${n} disc${s(n)} not ripped`;
    default:
      return `${n} item${s(n)}`;
  }
}

/** "2 files need renaming · 1 flagged for a second look", in kind order. Empty for no items. */
export function summarizeItems(items: AttentionItem[]): string {
  const parts = ATTENTION_KINDS
    .map((meta) => ({ kind: meta.kind, items: items.filter((item) => item.kind === meta.kind) }))
    .filter((entry) => entry.items.length > 0)
    .map((entry) => phrase(entry.kind, entry.items));
  if (parts.length === 0) return '';
  const text = parts.join(' · ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** "6 items need attention" (badge label). */
export const attentionCountLabel = (total: number): string => `${total} item${s(total)} need${total === 1 ? 's' : ''} attention`;
