'use client';

import React, { ReactNode, Suspense, useEffect } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Box, Tab, Tabs } from '@mui/material';
import useAdminStore from '@/store/useAdminStore';
import { PageContainer, PageHeader } from '@/components/ui/PageHeader';
import { ADMIN_VIEWS } from '@/components/shell/navConfig';

interface AdminLayoutProps {
  children: ReactNode;
}

/** Record-type tabs on /admin (Catalog Records). `value` is the `?view=` key. */
const RECORD_TABS = [
  { label: 'Movies', value: 'Movie' },
  { label: 'Releases', value: 'Release' },
  { label: 'Shows', value: 'Series' },
  { label: 'Seasons', value: 'Season' },
  { label: 'Episodes', value: 'Episode' },
  { label: 'Discs', value: 'Disc' },
  { label: 'Collections', value: 'Collection' },
] as const;

/** Views that have their own sidebar entry and render without the record tabs. */
const STANDALONE_VIEWS: Record<string, { title: string; subtitle: string }> = {
  [ADMIN_VIEWS.images]: { title: 'Images', subtitle: 'Search, upload and assign posters and artwork.' },
  [ADMIN_VIEWS.compliance]: { title: 'Compliance', subtitle: 'Find and fix library folders that break Jellyfin naming rules.' },
  [ADMIN_VIEWS.extras]: { title: 'Extras Review', subtitle: 'Confirm auto-classified extras so they can be filed into the library.' },
};

const RECORD_VIEWS = new Set<string>(RECORD_TABS.map((t) => t.value));
const DEFAULT_VIEW = 'Movie';

function isValidAdminView(view: string | null | undefined): view is string {
  if (!view) return false;
  return RECORD_VIEWS.has(view) || Object.prototype.hasOwnProperty.call(STANDALONE_VIEWS, view);
}

/**
 * Keeps the admin store in step with `?view=`: a valid view selects that
 * panel; no view (the Catalog Records link) falls back from a standalone panel
 * to the record forms.
 */
function AdminViewSync() {
  const pathname = usePathname();
  const view = useSearchParams()?.get('view') ?? null;
  const { selectedType, setSelectedType } = useAdminStore();

  useEffect(() => {
    if (pathname !== '/admin') return;
    if (isValidAdminView(view)) {
      if (view !== selectedType) setSelectedType(view);
    } else if (!RECORD_VIEWS.has(selectedType)) {
      setSelectedType(DEFAULT_VIEW);
    }
  }, [pathname, view, selectedType, setSelectedType]);

  return null;
}

function CatalogHeader() {
  const router = useRouter();
  const view = useSearchParams()?.get('view') ?? null;
  const { selectedType, setSelectedType } = useAdminStore();
  const current = isValidAdminView(view) ? view : selectedType;
  const standalone = STANDALONE_VIEWS[current];

  if (standalone) return <PageHeader title={standalone.title} subtitle={standalone.subtitle} />;

  return (
    <PageHeader title="Catalog Records" subtitle="Add and edit the movies, shows, discs and collections in your catalog.">
      <Tabs
        value={RECORD_VIEWS.has(current) ? current : DEFAULT_VIEW}
        onChange={(_event: React.SyntheticEvent, next: string) => {
          setSelectedType(next);
          router.replace(`/admin?view=${next}`, { scroll: false });
        }}
        variant="scrollable"
        scrollButtons="auto"
        allowScrollButtonsMobile
        aria-label="Record type"
      >
        {RECORD_TABS.map((tab) => <Tab key={tab.value} label={tab.label} value={tab.value} />)}
      </Tabs>
    </PageHeader>
  );
}

/**
 * /admin/* layout. The sub-pages (disc ripper, tape ingest, library paths)
 * are reached from the sidebar and render as-is; /admin itself gets the
 * Catalog Records header or the header of the standalone view it shows.
 */
const AdminLayout: React.FC<AdminLayoutProps> = ({ children }) => {
  const pathname = usePathname();

  if (pathname !== '/admin') return <>{children}</>;

  return (
    <PageContainer>
      <Suspense fallback={null}>
        <AdminViewSync />
        <CatalogHeader />
      </Suspense>
      <Box>{children}</Box>
    </PageContainer>
  );
};

export default AdminLayout;
