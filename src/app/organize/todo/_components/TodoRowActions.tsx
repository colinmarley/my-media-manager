'use client';

import React, { useId, useState } from 'react';
import Link from 'next/link';
import { Button, Divider, IconButton, ListItemText, Menu, MenuItem, Stack, Tooltip } from '@mui/material';
import { MoreVert } from '@mui/icons-material';

import type { AttentionAction, ItemActions } from '@/service/attention/attentionModel';
import type { AttentionItem } from '@/types/attention/Attention.type';

export type DismissChoice = { days: number | null; withNote?: boolean };

interface Props {
  item: AttentionItem;
  actions: ItemActions;
  busy?: boolean;
  onAction: (item: AttentionItem, action: AttentionAction) => void;
  onDismiss: (item: AttentionItem, choice: DismissChoice) => void;
}

/** The row's primary fix as a button, then a menu with the other links and Dismiss. */
const TodoRowActions = ({ item, actions, busy, onAction, onDismiss }: Props) => {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const menuId = useId();
  const { primary, secondary } = actions;
  const close = () => setAnchor(null);
  const hasMenu = secondary.length > 0 || item.dismissible;

  const primaryButton = primary
    ? primary.type === 'link' ? (
      <Button size="small" variant="outlined" component={Link} href={primary.href} sx={{ whiteSpace: 'nowrap' }}>
        {primary.label}
      </Button>
    ) : (
      <Button
        size="small"
        variant="contained"
        disabled={busy}
        onClick={() => onAction(item, primary)}
        aria-label={`${primary.label.replace(/…$/, '')}: ${item.title}`}
        sx={{ whiteSpace: 'nowrap' }}
      >
        {primary.label}
      </Button>
    )
    : null;

  const dismiss = (choice: DismissChoice) => {
    close();
    onDismiss(item, choice);
  };

  return (
    <Stack direction="row" spacing={0.5} alignItems="center" justifyContent="flex-end">
      {primaryButton}
      {hasMenu && (
        <>
          <Tooltip title="More actions">
            <IconButton
              size="small"
              aria-label={`More actions for ${item.title}`}
              aria-haspopup="menu"
              aria-controls={anchor ? menuId : undefined}
              aria-expanded={anchor ? 'true' : undefined}
              onClick={(event) => setAnchor(event.currentTarget)}
            >
              <MoreVert fontSize="small" />
            </IconButton>
          </Tooltip>
          <Menu id={menuId} anchorEl={anchor} open={Boolean(anchor)} onClose={close} anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }} transformOrigin={{ vertical: 'top', horizontal: 'right' }}>
            {secondary.map((action) =>
              action.type === 'link' ? (
                <MenuItem key={action.label} component={Link} href={action.href} onClick={close}>
                  {action.label}
                </MenuItem>
              ) : (
                <MenuItem key={action.label} onClick={() => { close(); onAction(item, action); }} disabled={busy}>
                  {action.label}
                </MenuItem>
              ),
            )}
            {secondary.length > 0 && item.dismissible && <Divider />}
            {item.dismissible && [
              <MenuItem key="until" onClick={() => dismiss({ days: null })}>
                <ListItemText primary="Dismiss until it changes" />
              </MenuItem>,
              <MenuItem key="30" onClick={() => dismiss({ days: 30 })}>
                <ListItemText primary="Dismiss for 30 days" />
              </MenuItem>,
              <MenuItem key="note" onClick={() => dismiss({ days: null, withNote: true })}>
                <ListItemText primary="Dismiss with a note…" />
              </MenuItem>,
            ]}
          </Menu>
        </>
      )}
    </Stack>
  );
};

export default TodoRowActions;
