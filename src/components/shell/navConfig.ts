import type { SvgIconComponent } from '@mui/icons-material';
import {
  AlbumOutlined,
  BarChartOutlined,
  ChecklistOutlined,
  CollectionsOutlined,
  DriveFileRenameOutlineOutlined,
  FactCheckOutlined,
  FolderSpecialOutlined,
  HomeOutlined,
  InboxOutlined,
  LibraryBooksOutlined,
  MovieFilterOutlined,
  SettingsOutlined,
  StorageOutlined,
  TableRowsOutlined,
  VideocamOutlined,
  BookmarkBorderOutlined,
} from '@mui/icons-material';

/**
 * The sidebar's information architecture. Every entry points at a route that
 * already exists; `/admin?view=…` entries use the view keys that
 * src/app/admin/layout.tsx accepts (see ADMIN_VIEWS).
 */

/** `?view=` keys on /admin that have their own sidebar entry. */
export const ADMIN_VIEWS = {
  images: 'ImageManager',
  compliance: 'LibraryCompliance',
  extras: 'ExtrasReview',
} as const;

export interface NavFlags {
  /** /organize/todo ships in a later PR; keep the item hidden until then. */
  organizeTodo: boolean;
}

export const DEFAULT_NAV_FLAGS: NavFlags = {
  organizeTodo: false,
};

export interface NavItem {
  id: string;
  label: string;
  href: string;
  icon: SvgIconComponent;
  /** Required `?view=` value for this item to be active. */
  view?: string;
  /** Other path prefixes that should highlight this item (legacy URLs). */
  alsoMatch?: string[];
  /** Hidden unless this flag is on. */
  flag?: keyof NavFlags;
}

export interface NavGroup {
  id: string;
  /** Omitted for the ungrouped top entry (Home). */
  label?: string;
  items: NavItem[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    id: 'home',
    items: [{ id: 'home', label: 'Home', href: '/dashboard', icon: HomeOutlined }],
  },
  {
    id: 'ingest',
    label: 'Ingest',
    items: [
      { id: 'ingest-queue', label: 'Queue & Review', href: '/ingress-automation', icon: InboxOutlined },
      { id: 'rip-disc', label: 'Rip Disc', href: '/admin/disc-ripper', icon: AlbumOutlined },
      { id: 'tape-capture', label: 'Tape Capture', href: '/admin/tape-ingest', icon: VideocamOutlined },
    ],
  },
  {
    id: 'library',
    label: 'Library',
    items: [
      { id: 'titles', label: 'Titles', href: '/dashboard/my-library', icon: MovieFilterOutlined },
      { id: 'physical-media', label: 'Discs & Tapes', href: '/dashboard/physical-media', icon: LibraryBooksOutlined },
      { id: 'wishlist', label: 'Wishlist', href: '/dashboard/wishlist', icon: BookmarkBorderOutlined },
      { id: 'stats', label: 'Stats', href: '/dashboard/stats', icon: BarChartOutlined },
    ],
  },
  {
    id: 'organize',
    label: 'Organize',
    items: [
      { id: 'todo', label: 'To-Do', href: '/organize/todo', icon: ChecklistOutlined, flag: 'organizeTodo' },
      {
        id: 'rename',
        label: 'Rename & Organize',
        href: '/organize/rename',
        icon: DriveFileRenameOutlineOutlined,
        alsoMatch: ['/dashboard/movie-organization', '/dashboard/show-organization'],
      },
      { id: 'compliance', label: 'Compliance', href: `/admin?view=${ADMIN_VIEWS.compliance}`, view: ADMIN_VIEWS.compliance, icon: FactCheckOutlined },
      { id: 'extras', label: 'Extras Review', href: `/admin?view=${ADMIN_VIEWS.extras}`, view: ADMIN_VIEWS.extras, icon: FolderSpecialOutlined },
    ],
  },
  {
    id: 'manage',
    label: 'Manage',
    items: [
      { id: 'catalog', label: 'Catalog Records', href: '/admin', icon: TableRowsOutlined },
      { id: 'images', label: 'Images', href: `/admin?view=${ADMIN_VIEWS.images}`, view: ADMIN_VIEWS.images, icon: CollectionsOutlined },
      { id: 'library-paths', label: 'Library Paths', href: '/admin/library', icon: StorageOutlined },
      { id: 'settings', label: 'Settings', href: '/settings', icon: SettingsOutlined, alsoMatch: ['/admin/settings'] },
    ],
  },
];

/** The groups with flagged-off items (and then-empty groups) removed. */
export function getNavGroups(flags: NavFlags = DEFAULT_NAV_FLAGS, groups: NavGroup[] = NAV_GROUPS): NavGroup[] {
  return groups
    .map((group) => ({ ...group, items: group.items.filter((item) => !item.flag || flags[item.flag]) }))
    .filter((group) => group.items.length > 0);
}

function pathOf(href: string): string {
  return href.split('?')[0];
}

function pathMatches(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

/**
 * The id of the item to highlight: the longest matching path wins (so
 * /dashboard/stats beats Home), a `view` item only matches its own `?view=`,
 * and a view-less item steps aside when a sibling on the same path claims the
 * current view (Catalog Records vs. Compliance on /admin).
 */
export function findActiveNavItem(groups: NavGroup[], pathname: string | null, view: string | null): string | null {
  if (!pathname) return null;
  const items = groups.flatMap((group) => group.items);
  let best: { id: string; score: number } | null = null;

  for (const item of items) {
    const ownPath = pathOf(item.href);
    if (item.view !== undefined && item.view !== view) continue;
    if (item.view === undefined && view) {
      const claimed = items.some((other) => other !== item && other.view === view && pathOf(other.href) === ownPath);
      if (claimed && pathname === ownPath) continue;
    }
    for (const prefix of [ownPath, ...(item.alsoMatch ?? [])]) {
      if (!pathMatches(pathname, prefix)) continue;
      const score = prefix.length + (item.view !== undefined ? 1000 : 0);
      if (!best || score > best.score) best = { id: item.id, score };
    }
  }
  return best?.id ?? null;
}

/** Title for the top bar: the active item's label, or a fallback. */
export function findNavLabel(groups: NavGroup[], id: string | null): string | null {
  if (!id) return null;
  return groups.flatMap((group) => group.items).find((item) => item.id === id)?.label ?? null;
}

/** Routes that render full-screen, without the sidebar and top bar. */
const SHELL_FREE_PATHS = new Set(['/', '/login', '/signup']);

export function isShellHidden(pathname: string | null): boolean {
  return pathname !== null && SHELL_FREE_PATHS.has(pathname);
}
