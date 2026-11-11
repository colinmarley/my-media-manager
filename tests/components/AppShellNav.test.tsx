/**
 * QA probe for the app shell: renders the real root layout and checks that
 * the pages users look for are linked from the permanent sidebar.
 *
 * Issue #16 AC2 ("A `/dashboard/stats` page ... linked from the nav")
 *   -> app shell navigation (QA probe) > links to the stats page from the sidebar
 * Issue #39 (wishlist linked from the nav)
 *   -> app shell navigation (QA probe) > links to the wishlist page from the sidebar
 *
 * Below `md` the sidebar becomes a temporary drawer behind "Open navigation";
 * that path is covered in tests/components/AppShell.test.tsx.
 */

import React from 'react';
import { render, screen, within } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

let mockPathname = '/dashboard';

vi.mock('next/navigation', () => ({
  usePathname: () => mockPathname,
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

vi.mock('next/link', () => ({
  default: React.forwardRef<HTMLAnchorElement, any>(({ href, children, ...rest }, ref) => (
    <a ref={ref} href={typeof href === 'string' ? href : href.pathname} {...rest}>
      {children}
    </a>
  )),
}));

vi.mock('@/theme/fonts', () => ({ fontVariables: '' }));

vi.mock('@/store/useAuthenticationStore', () => ({
  default: () => ({ authenticated: false, checkSession: vi.fn(), logout: vi.fn() }),
}));

vi.mock('@/service/disc-ripper/DiscRipperService', () => ({
  DiscRipperService: { listJobs: () => Promise.resolve([]) },
}));

import RootLayout from '@/app/layout';

function setDesktop(matches: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }),
  });
}

describe('app shell navigation (QA probe)', () => {
  beforeEach(() => {
    mockPathname = '/dashboard';
    setDesktop(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('links to the stats page from the sidebar', () => {
    render(<RootLayout>{null}</RootLayout>);
    const nav = screen.getByRole('navigation', { name: 'Main' });
    expect(within(nav).getByRole('link', { name: /^Stats$/ })).toHaveAttribute('href', '/dashboard/stats');
  });

  it('links to the wishlist page from the sidebar (issue #39)', () => {
    render(<RootLayout>{null}</RootLayout>);
    const nav = screen.getByRole('navigation', { name: 'Main' });
    expect(within(nav).getByRole('link', { name: /^Wishlist$/ })).toHaveAttribute('href', '/dashboard/wishlist');
  });

  it('renders the page without the shell on the login page', () => {
    mockPathname = '/login';
    render(<RootLayout><p>login form</p></RootLayout>);
    expect(screen.getByText('login form')).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Main' })).not.toBeInTheDocument();
  });
});
