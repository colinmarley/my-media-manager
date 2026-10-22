/**
 * QA probe for the app shell (issue #16 AC2: "/dashboard/stats … linked from nav").
 *
 * The stats page test renders the page component in isolation, so nothing in
 * the suite proved the link exists in the drawer users actually click. This
 * renders the real root layout, opens the drawer and asserts the Stats link
 * points at /dashboard/stats.
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
