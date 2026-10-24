/**
 * QA probe for the app shell (issue #16 AC2: "A `/dashboard/stats` page with
 * summary tiles and simple charts (MUI or a light chart library already in
 * use), linked from the nav").
 *
 * The stats page test renders the page component in isolation, so nothing in
 * the suite proved the link exists in the drawer users actually click. This
 * renders the real root layout, opens the drawer and asserts the Stats link
 * points at /dashboard/stats.
 *
 * Issue #16 acceptance criteria -> the test here:
 *
 *   AC2 "... linked from the nav."
 *     -> tests/components/AppShellNav.test.tsx::app shell navigation (QA probe) > links to the stats page from the drawer
 *        (the tiles-and-charts half of AC2 is traced in
 *         tests/components/CatalogStatsPage.test.tsx::StatsPage > AC2 the page
 *         renders the summary tiles and the simple charts the criterion asks for)
 *
 *   AC1 (GET /api/catalog/stats) -> backend/tests/test_catalog_stats.py::test_ac1_endpoint_returns_every_breakdown_the_criterion_names
 *   AC3 (mocked-DB endpoint test, page render test)
 *     -> backend/tests/test_catalog_stats.py::test_ac3_the_endpoint_unit_tests_build_no_real_session
 *     -> tests/components/CatalogStatsPage.test.tsx::StatsPage > AC3 the render test needs no backend: one mocked service call draws the whole page
 */

import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

vi.mock('next/navigation', () => ({
  usePathname: () => '/dashboard',
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: any) => (
    <a href={typeof href === 'string' ? href : href.pathname} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock('@/store/useAuthenticationStore', () => ({
  default: () => ({ authenticated: false, checkSession: vi.fn(), logout: vi.fn() }),
}));

import RootLayout from '@/app/layout';

describe('app shell navigation (QA probe)', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      configurable: true,
      value: (query: string) => ({
        matches: true,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('links to the stats page from the drawer', () => {
    render(<RootLayout>{null}</RootLayout>);

    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Open navigation' }));
    });

    const stats = screen.getByRole('link', { name: /Stats/i });
    expect(stats).toHaveAttribute('href', '/dashboard/stats');
  });
});
