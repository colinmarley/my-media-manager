'use client';

import React from 'react';
import Link from 'next/link';
import { Badge, Box, List, ListItem, ListItemButton, ListItemIcon, ListItemText, Tooltip, Typography } from '@mui/material';
import { accent, status as statusColors, surfaces, text, type StatusTone } from '@/theme/tokens';
import { attentionCountLabel } from '@/service/attention/attentionModel';
import type { NavGroup } from './navConfig';

export interface NavIndicator {
  tone: StatusTone;
  /** Screen-reader / tooltip text, e.g. "Ripping". */
  label: string;
}

export interface NavSectionProps {
  group: NavGroup;
  activeId: string | null;
  collapsed: boolean;
  /** Count badges by item id (e.g. the To-Do item). Zero hides the badge. */
  badges?: Partial<Record<string, number>>;
  /** Status dots by item id (e.g. the disc ripper). */
  indicators?: Partial<Record<string, NavIndicator>>;
  onNavigate?: () => void;
}

const NavSection: React.FC<NavSectionProps> = ({ group, activeId, collapsed, badges, indicators, onNavigate }) => {
  const headingId = `nav-group-${group.id}`;
  return (
    <Box component="section" aria-labelledby={group.label ? headingId : undefined} sx={{ mt: group.label ? 2 : 1 }}>
      {group.label && (
        <Typography
          id={headingId}
          variant="caption"
          component="h2"
          sx={collapsed
            ? { position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }
            : { display: 'block', px: 2.5, pb: 0.5, color: text.disabled, fontWeight: 600 }}
        >
          {group.label}
        </Typography>
      )}
      {collapsed && group.label && <Box aria-hidden sx={{ mx: 2, mb: 0.5, borderTop: 1, borderColor: 'divider' }} />}
      <List dense disablePadding>
        {group.items.map((item) => {
          const active = item.id === activeId;
          const Icon = item.icon;
          const badge = badges?.[item.id] ?? 0;
          const indicator = indicators?.[item.id];
          const badgeLabel = badge > 0 ? attentionCountLabel(badge) : null;
          const extras = [indicator?.label, badgeLabel].filter(Boolean).join(', ');
          const accessibleName = extras ? `${item.label} (${extras})` : item.label;

          const icon = (
            <Badge color="primary" badgeContent={badge} max={99} invisible={!badge || !collapsed} variant="dot">
              <Icon fontSize="small" />
            </Badge>
          );

          const button = (
            <ListItemButton
              component={Link}
              href={item.href}
              onClick={onNavigate}
              aria-current={active ? 'page' : undefined}
              aria-label={collapsed ? accessibleName : undefined}
              selected={active}
              sx={{
                mx: 1,
                my: 0.25,
                minHeight: 34,
                px: collapsed ? 0 : 1.5,
                justifyContent: collapsed ? 'center' : 'flex-start',
                borderRadius: 1,
                color: active ? text.primary : text.secondary,
                '&:hover': { bgcolor: surfaces.raised, color: text.primary },
                '&.Mui-selected': { bgcolor: accent.tint, color: text.primary },
                '&.Mui-selected:hover': { bgcolor: accent.tint },
                '&.Mui-selected .MuiListItemIcon-root': { color: accent.main },
                '&.Mui-focusVisible': { outline: `2px solid ${accent.main}`, outlineOffset: -2 },
              }}
            >
              <ListItemIcon sx={{ minWidth: collapsed ? 0 : 32, color: 'inherit', position: 'relative' }}>
                {icon}
                {indicator && collapsed && (
                  <Box
                    component="span"
                    aria-hidden
                    sx={{ position: 'absolute', top: -2, right: -4, width: 7, height: 7, borderRadius: '50%', bgcolor: statusColors[indicator.tone].fg }}
                  />
                )}
              </ListItemIcon>
              {!collapsed && (
                <>
                  <ListItemText primary={item.label} slotProps={{ primary: { variant: 'body2', fontWeight: active ? 600 : 500 } }} />
                  {indicator && (
                    <Tooltip title={indicator.label}>
                      <Box
                        component="span"
                        role="img"
                        aria-label={indicator.label}
                        data-tone={indicator.tone}
                        sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: statusColors[indicator.tone].fg, flexShrink: 0 }}
                      />
                    </Tooltip>
                  )}
                  {badge > 0 && (
                    <Box
                      component="span"
                      role="img"
                      aria-label={badgeLabel ?? undefined}
                      sx={{ ml: 1, px: 0.75, minWidth: 20, textAlign: 'center', borderRadius: 1, fontSize: '0.6875rem', fontWeight: 600, bgcolor: accent.tint, color: accent.light }}
                    >
                      {badge > 99 ? '99+' : badge}
                    </Box>
                  )}
                </>
              )}
            </ListItemButton>
          );

          return (
            <ListItem key={item.id} disablePadding sx={{ display: 'block' }}>
              {collapsed ? (
                <Tooltip title={accessibleName} placement="right">
                  {button}
                </Tooltip>
              ) : (
                button
              )}
            </ListItem>
          );
        })}
      </List>
    </Box>
  );
};

export default NavSection;
