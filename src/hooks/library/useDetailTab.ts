import { useCallback } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

export const DETAIL_TABS = ['files', 'discs', 'metadata', 'artwork'] as const;
export type DetailTab = (typeof DETAIL_TABS)[number];

export const isDetailTab = (value: string | null | undefined): value is DetailTab =>
  DETAIL_TABS.includes(value as DetailTab);

/** The title detail page's tab, kept in `?tab=` so each tab has its own URL. Files is the default. */
const useDetailTab = () => {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const raw = searchParams?.get('tab') ?? null;
  const tab: DetailTab = isDetailTab(raw) ? raw : 'files';

  const setTab = useCallback(
    (next: DetailTab) => {
      const params = new URLSearchParams(searchParams?.toString() ?? '');
      if (next === 'files') params.delete('tab');
      else params.set('tab', next);
      const query = params.toString();
      router.replace(`${pathname ?? ''}${query ? `?${query}` : ''}`, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  return { tab, setTab };
};

export default useDetailTab;
