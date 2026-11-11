import React from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ThemeProvider } from '@mui/material/styles';
import theme from '@/app/theme';

let mockPathname = '/dashboard';
let mockSearch = '';

vi.mock('next/navigation', () => ({
  usePathname: () => mockPathname,
  useSearchParams: () => new URLSearchParams(mockSearch),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

vi.mock('next/link', () => ({
  default: React.forwardRef<HTMLAnchorElement, any>(({ href, children, ...rest }, ref) => (
    <a ref={ref} href={typeof href === 'string' ? href : href.pathname} {...rest}>
      {children}
    </a>
  )),
}));

vi.mock('@/store/useAuthenticationStore', () => ({
  default: () => ({ authenticated: false, checkSession: vi.fn(), logout: vi.fn() }),
}));

const listJobs = vi.fn();
vi.mock('@/service/disc-ripper/DiscRipperService', () => ({
  DiscRipperService: { listJobs: (...args: unknown[]) => listJobs(...args) },
}));

import AppShell from '@/components/shell/AppShell';
import useShellStore, { SHELL_COLLAPSED_STORAGE_KEY } from '@/store/useShellStore';
import { ADMIN_VIEWS, findActiveNavItem, getNavGroups, NAV_GROUPS } from '@/components/shell/navConfig';

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

function renderShell(props: Partial<React.ComponentProps<typeof AppShell>> = {}) {
  return render(
    <ThemeProvider theme={theme}>
      <AppShell {...props}><p>page body</p></AppShell>
    </ThemeProvider>,
  );
}

const nav = () => screen.getByRole('navigation', { name: 'Main' });

describe('AppShell', () => {
  beforeEach(() => {
    mockPathname = '/dashboard';
    mockSearch = '';
    setDesktop(true);
    window.localStorage.clear();
    useShellStore.setState({ collapsed: false, mobileOpen: false, hydrated: false });
    listJobs.mockReset().mockResolvedValue([]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders every workflow group and the page content', () => {
    renderShell();
    for (const name of ['Ingest', 'Library', 'Organize', 'Manage']) {
      expect(within(nav()).getByRole('heading', { name })).toBeInTheDocument();
    }
    expect(within(nav()).getByRole('link', { name: /^Home$/ })).toHaveAttribute('href', '/dashboard');
    expect(within(nav()).getByRole('link', { name: /Queue & Review/ })).toHaveAttribute('href', '/ingress-automation');
    expect(within(nav()).getByRole('link', { name: /^Compliance$/ })).toHaveAttribute('href', `/admin?view=${ADMIN_VIEWS.compliance}`);
    expect(screen.getByText('page body')).toBeInTheDocument();
  });

  it('hides the flagged To-Do item by default and shows it with its badge when enabled', () => {
    const { unmount } = renderShell();
    expect(within(nav()).queryByRole('link', { name: /To-Do/ })).not.toBeInTheDocument();
    unmount();

    renderShell({ flags: { organizeTodo: true }, badges: { todo: 4 } });
    const todo = within(nav()).getByRole('link', { name: /To-Do/ });
    expect(todo).toHaveAttribute('href', '/organize/todo');
    expect(within(todo).getByText('4')).toBeInTheDocument();
  });

  it('marks the active item for nested routes and shows its title in the top bar', () => {
    mockPathname = '/dashboard/my-library/movie/abc';
    renderShell();
    expect(within(nav()).getByRole('link', { name: /^Titles$/ })).toHaveAttribute('aria-current', 'page');
    expect(within(nav()).getByRole('link', { name: /^Home$/ })).not.toHaveAttribute('aria-current');
    expect(screen.getByTestId('shell-page-title')).toHaveTextContent('Titles');
  });

  it('matches ?view= items on /admin instead of Catalog Records', () => {
    mockPathname = '/admin';
    mockSearch = `view=${ADMIN_VIEWS.extras}`;
    renderShell();
    expect(within(nav()).getByRole('link', { name: /Extras Review/ })).toHaveAttribute('aria-current', 'page');
    expect(within(nav()).getByRole('link', { name: /Catalog Records/ })).not.toHaveAttribute('aria-current');
  });

  it('collapses to an icon rail from the keyboard-operable toggle and remembers it', () => {
    renderShell();
    const toggle = screen.getByRole('button', { name: 'Collapse sidebar' });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    act(() => { fireEvent.click(toggle); });

    expect(screen.getByRole('button', { name: 'Expand sidebar' })).toHaveAttribute('aria-expanded', 'false');
    expect(within(nav()).queryByText('Wishlist')).not.toBeInTheDocument();
    expect(within(nav()).getByRole('link', { name: 'Wishlist' })).toHaveAttribute('href', '/dashboard/wishlist');
    expect(window.localStorage.getItem(SHELL_COLLAPSED_STORAGE_KEY)).toBe('1');
  });

  it('restores the collapsed state from localStorage', () => {
    window.localStorage.setItem(SHELL_COLLAPSED_STORAGE_KEY, '1');
    renderShell();
    expect(screen.getByRole('button', { name: 'Expand sidebar' })).toBeInTheDocument();
  });

  it('uses a temporary drawer behind a menu button below md', () => {
    setDesktop(false);
    renderShell();
    expect(screen.queryByRole('navigation', { name: 'Main' })).not.toBeInTheDocument();
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Open navigation' })); });
    expect(within(nav()).getByRole('link', { name: /^Stats$/ })).toHaveAttribute('href', '/dashboard/stats');
  });

  it('shows the ripper status dot on Rip Disc', async () => {
    listJobs.mockResolvedValue([{ status: 'ripping' }]);
    renderShell();
    expect(await within(nav()).findByRole('img', { name: 'Ripping' })).toHaveAttribute('data-tone', 'warning');
  });
});

describe('findActiveNavItem', () => {
  const groups = getNavGroups();

  it.each([
    ['/dashboard', null, 'home'],
    ['/dashboard/stats', null, 'stats'],
    ['/dashboard/physical-media/discs/1', null, 'physical-media'],
    ['/dashboard/movie-organization', null, 'rename'],
    ['/admin', null, 'catalog'],
    ['/admin', 'Series', 'catalog'],
    ['/admin', ADMIN_VIEWS.images, 'images'],
    ['/admin/disc-ripper', null, 'rip-disc'],
    ['/admin/settings', null, 'settings'],
    ['/nowhere', null, null],
  ])('%s ?view=%s -> %s', (pathname, view, expected) => {
    expect(findActiveNavItem(groups, pathname, view)).toBe(expected);
  });

  it('only includes flagged items when the flag is on', () => {
    const ids = (flags: { organizeTodo: boolean }) => getNavGroups(flags, NAV_GROUPS).flatMap((g) => g.items.map((i) => i.id));
    expect(ids({ organizeTodo: false })).not.toContain('todo');
    expect(ids({ organizeTodo: true })).toContain('todo');
  });
});
