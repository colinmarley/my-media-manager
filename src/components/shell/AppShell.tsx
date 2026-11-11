'use client';

import React, { Suspense, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { Box, Drawer, IconButton, Tooltip, Typography, useMediaQuery, useTheme } from '@mui/material';
import { KeyboardDoubleArrowLeft, KeyboardDoubleArrowRight, VideoLibraryOutlined } from '@mui/icons-material';
import useShellStore from '@/store/useShellStore';
import useRipperStatus from '@/hooks/shell/useRipperStatus';
import useAttentionSummary from '@/hooks/attention/useAttentionSummary';
import { accent, borders, layout, surfaces, text } from '@/theme/tokens';
import NavSection, { type NavIndicator } from './NavSection';
import TopBar from './TopBar';
import { DEFAULT_NAV_FLAGS, findActiveNavItem, getNavGroups, type NavFlags, type NavGroup } from './navConfig';

export interface AppShellProps {
  children: React.ReactNode;
  flags?: NavFlags;
  /** Count badges by nav item id. The To-Do badge comes from the shared attention summary unless given here. */
  badges?: Partial<Record<string, number>>;
}

interface ActiveNav {
  activeId: string | null;
  section: string | null;
  title: string;
}

function resolveActive(groups: NavGroup[], pathname: string | null, view: string | null): ActiveNav {
  const activeId = findActiveNavItem(groups, pathname, view);
  for (const group of groups) {
    const item = group.items.find((i) => i.id === activeId);
    if (item) return { activeId, section: group.label ?? null, title: item.label };
  }
  return { activeId: null, section: null, title: 'Media Manager' };
}

/** Reads `?view=`; must sit under <Suspense> (Next requires it for useSearchParams). */
function WithView({ children }: { children: (view: string | null) => React.ReactNode }) {
  const params = useSearchParams();
  return <>{children(params?.get('view') ?? null)}</>;
}

function ViewAware({ children }: { children: (view: string | null) => React.ReactNode }) {
  return (
    <Suspense fallback={children(null)}>
      <WithView>{children}</WithView>
    </Suspense>
  );
}

interface SidebarProps {
  groups: NavGroup[];
  activeId: string | null;
  collapsed: boolean;
  showCollapseToggle: boolean;
  badges?: Partial<Record<string, number>>;
  indicators: Partial<Record<string, NavIndicator>>;
  onToggleCollapsed: () => void;
  onNavigate?: () => void;
}

function Sidebar({ groups, activeId, collapsed, showCollapseToggle, badges, indicators, onToggleCollapsed, onNavigate }: SidebarProps) {
  const toggleLabel = collapsed ? 'Expand sidebar' : 'Collapse sidebar';
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <Box
        component={Link}
        href="/dashboard"
        onClick={onNavigate}
        aria-label="Media Manager home"
        sx={{
          height: layout.topBarHeight,
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          gap: 1.25,
          px: collapsed ? 0 : 2.5,
          justifyContent: collapsed ? 'center' : 'flex-start',
          color: text.primary,
          textDecoration: 'none',
          borderBottom: `1px solid ${borders.subtle}`,
          '&:focus-visible': { outline: `2px solid ${accent.main}`, outlineOffset: -2 },
        }}
      >
        <VideoLibraryOutlined sx={{ color: accent.main, fontSize: 22 }} />
        {!collapsed && <Typography variant="subtitle1" component="span" sx={{ fontWeight: 600 }}>Media Manager</Typography>}
      </Box>
      <Box component="nav" aria-label="Main" sx={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', pb: 2 }}>
        {groups.map((group) => (
          <NavSection
            key={group.id}
            group={group}
            activeId={activeId}
            collapsed={collapsed}
            badges={badges}
            indicators={indicators}
            onNavigate={onNavigate}
          />
        ))}
      </Box>
      {showCollapseToggle && (
        <Box sx={{ borderTop: `1px solid ${borders.subtle}`, p: 1, display: 'flex', justifyContent: collapsed ? 'center' : 'flex-end' }}>
          <Tooltip title={toggleLabel} placement="right">
            <IconButton onClick={onToggleCollapsed} aria-label={toggleLabel} aria-expanded={!collapsed} size="small" sx={{ color: text.secondary }}>
              {collapsed ? <KeyboardDoubleArrowRight fontSize="small" /> : <KeyboardDoubleArrowLeft fontSize="small" />}
            </IconButton>
          </Tooltip>
        </Box>
      )}
    </Box>
  );
}

const paperSx = { bgcolor: surfaces.chrome, borderRight: `1px solid ${borders.subtle}`, overflowX: 'hidden' } as const;

/**
 * Permanent, workflow-grouped sidebar at `md`+ (collapsible to an icon rail),
 * a temporary drawer below `md`, and a slim top bar with the page title and
 * the account control.
 */
export default function AppShell({ children, flags = DEFAULT_NAV_FLAGS, badges }: AppShellProps) {
  const theme = useTheme();
  // Desktop-first: assume a wide screen during SSR so desktop never flashes the mobile layout.
  const isDesktop = useMediaQuery(theme.breakpoints.up('md'), { defaultMatches: true });
  const pathname = usePathname();
  const { collapsed, mobileOpen, toggleCollapsed, setMobileOpen, hydrate } = useShellStore();
  const ripper = useRipperStatus();
  const groups = useMemo(() => getNavGroups(flags), [flags]);
  const indicators = useMemo(() => ({ 'rip-disc': ripper }), [ripper]);
  // Hidden at 0, while loading, and on a server without the To-Do list (total stays 0).
  const attention = useAttentionSummary();
  const allBadges = useMemo(() => ({ todo: attention.total, ...badges }), [attention.total, badges]);

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname, setMobileOpen]);

  const railCollapsed = isDesktop && collapsed;
  const sidebarWidth = railCollapsed ? layout.railWidth : layout.sidebarWidth;

  // Only the nav and the title read `?view=`, so only they sit under Suspense;
  // the page itself never remounts when the search params resolve.
  const sidebar = (
    <ViewAware>
      {(view) => (
        <Sidebar
          groups={groups}
          activeId={resolveActive(groups, pathname, view).activeId}
          collapsed={railCollapsed}
          showCollapseToggle={isDesktop}
          badges={allBadges}
          indicators={indicators}
          onToggleCollapsed={toggleCollapsed}
          onNavigate={isDesktop ? undefined : () => setMobileOpen(false)}
        />
      )}
    </ViewAware>
  );

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh', bgcolor: 'background.default' }}>
      <Box
        component="a"
        href="#main-content"
        sx={{
          position: 'absolute', left: 8, top: -48, zIndex: (t) => t.zIndex.tooltip, px: 1.5, py: 1,
          bgcolor: accent.main, color: accent.contrastText, borderRadius: 1, textDecoration: 'none',
          '&:focus': { top: 8 },
        }}
      >
        Skip to content
      </Box>
      {isDesktop ? (
        <Drawer
          variant="permanent"
          sx={{ width: sidebarWidth, flexShrink: 0, transition: 'width 150ms ease' }}
          slotProps={{ paper: { sx: { ...paperSx, width: sidebarWidth, transition: 'width 150ms ease' } } }}
        >
          {sidebar}
        </Drawer>
      ) : (
        <Drawer
          variant="temporary"
          open={mobileOpen}
          onClose={() => setMobileOpen(false)}
          slotProps={{ paper: { sx: { ...paperSx, width: layout.sidebarWidth } } }}
        >
          {sidebar}
        </Drawer>
      )}
      <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <ViewAware>
          {(view) => {
            const active = resolveActive(groups, pathname, view);
            return (
              <TopBar
                section={active.section}
                title={active.title}
                showMenuButton={!isDesktop}
                onOpenMenu={() => setMobileOpen(true)}
              />
            );
          }}
        </ViewAware>
        <Box component="main" id="main-content" tabIndex={-1} sx={{ flex: 1, minWidth: 0, outline: 'none' }}>
          {children}
        </Box>
      </Box>
    </Box>
  );
}
