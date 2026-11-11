'use client';

import React from 'react';
import Link from 'next/link';
import {
  Box,
  Checkbox,
  Link as MuiLink,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import { ArrowForward } from '@mui/icons-material';

import FileTechChips from '@/components/ui/FileTechChips';
import StatusChip from '@/components/ui/StatusChip';
import { itemActions, SEVERITY_META, titleHref, type AttentionAction } from '@/service/attention/attentionModel';
import { borders, fontFamilies, surfaces } from '@/theme/tokens';
import type { AttentionItem } from '@/types/attention/Attention.type';
import { formatBytes } from '@/utils/format';
import TodoRowActions, { type DismissChoice } from './TodoRowActions';

interface Props {
  items: AttentionItem[];
  /** Label for the table (the kind's name). */
  label: string;
  /** Rows that can be bulk-selected (rename). Omit for no selection column. */
  selectable?: (item: AttentionItem) => boolean;
  selected?: Set<string>;
  onToggle?: (itemId: string) => void;
  onToggleAll?: (itemIds: string[], select: boolean) => void;
  busy?: boolean;
  onAction: (item: AttentionItem, action: AttentionAction) => void;
  onDismiss: (item: AttentionItem, choice: DismissChoice) => void;
}

const mono = { fontFamily: fontFamilies.mono, fontSize: '0.75rem', overflowWrap: 'anywhere' } as const;

/** current → expected, when the item has them. */
const CurrentExpected = ({ current, expected }: { current: string | null; expected: string | null }) => {
  if (!current && !expected) return null;
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap', mt: 0.5 }} aria-label="Current and expected name">
      {current && <Box component="span" sx={{ ...mono, color: 'text.secondary' }}>{current}</Box>}
      {current && expected && <ArrowForward sx={{ fontSize: 14, color: 'text.disabled' }} aria-label="should be" />}
      {expected && <Box component="span" sx={mono}>{expected}</Box>}
    </Box>
  );
};

const TodoItemRow = ({ item, selectable, selected, onToggle, busy, onAction, onDismiss }: Omit<Props, 'items' | 'label' | 'onToggleAll' | 'selectable'> & { item: AttentionItem; selectable: boolean }) => {
  const actions = itemActions(item);
  const severity = SEVERITY_META[item.severity] ?? SEVERITY_META.low;
  const href = titleHref(item);
  const file = item.file;

  return (
    <TableRow hover selected={selected?.has(item.id)} data-item-id={item.id}>
      {onToggle && (
        <TableCell padding="checkbox">
          {selectable && (
            <Checkbox
              size="small"
              checked={selected?.has(item.id) ?? false}
              onChange={() => onToggle(item.id)}
              slotProps={{ input: { 'aria-label': `Select ${item.title}` } }}
            />
          )}
        </TableCell>
      )}
      <TableCell component="th" scope="row" sx={{ minWidth: 280 }}>
        <Typography variant="body2" sx={{ fontWeight: 500, overflowWrap: 'anywhere' }}>{item.title}</Typography>
        <Typography variant="body2" color="text.secondary">{item.detail}</Typography>
        <CurrentExpected current={item.current} expected={item.expected} />
        {file && (
          <Stack direction="row" spacing={1} alignItems="center" useFlexGap flexWrap="wrap" sx={{ mt: 0.75 }}>
            {file.fileSize !== null && file.fileSize !== undefined && (
              <Typography variant="caption" color="text.secondary" sx={{ fontFamily: fontFamilies.mono }}>
                {formatBytes(file.fileSize, { precision: 'video' })}
              </Typography>
            )}
            <FileTechChips {...file} />
          </Stack>
        )}
        {actions.note && (
          <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 0.5 }}>{actions.note}</Typography>
        )}
      </TableCell>
      <TableCell sx={{ minWidth: 140 }}>
        {href ? (
          <MuiLink component={Link} href={href} variant="body2" underline="hover">{item.mediaTitle || 'Open title'}</MuiLink>
        ) : (
          <Typography variant="body2" color="text.disabled">{item.mediaTitle || 'No title yet'}</Typography>
        )}
      </TableCell>
      <TableCell>
        <StatusChip status={item.severity} tone={severity.tone} label={severity.label} />
      </TableCell>
      <TableCell align="right">
        <TodoRowActions item={item} actions={actions} busy={busy} onAction={onAction} onDismiss={onDismiss} />
      </TableCell>
    </TableRow>
  );
};

/** A dense table of one kind's items: what is wrong, the title it belongs to, severity, and the fix. */
const TodoItemTable = ({ items, label, selectable, selected, onToggle, onToggleAll, busy, onAction, onDismiss }: Props) => {
  const selectableIds = selectable ? items.filter(selectable).map((item) => item.id) : [];
  const selectedCount = selectableIds.filter((id) => selected?.has(id)).length;
  const withSelection = Boolean(selectable && onToggle && selectableIds.length > 0);

  return (
    <TableContainer sx={{ border: `1px solid ${borders.default}`, borderRadius: 1, bgcolor: surfaces.paper }}>
      <Table size="small" aria-label={label}>
        <TableHead>
          <TableRow>
            {withSelection && (
              <TableCell padding="checkbox">
                <Checkbox
                  size="small"
                  checked={selectedCount > 0 && selectedCount === selectableIds.length}
                  indeterminate={selectedCount > 0 && selectedCount < selectableIds.length}
                  onChange={(event) => onToggleAll?.(selectableIds, event.target.checked)}
                  slotProps={{ input: { 'aria-label': 'Select all files' } }}
                />
              </TableCell>
            )}
            <TableCell sx={{ color: 'text.secondary' }}>Item</TableCell>
            <TableCell sx={{ color: 'text.secondary' }}>Title</TableCell>
            <TableCell sx={{ color: 'text.secondary' }}>Severity</TableCell>
            <TableCell align="right" sx={{ color: 'text.secondary' }}>Actions</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {items.map((item) => (
            <TodoItemRow
              key={item.id}
              item={item}
              selectable={Boolean(selectable?.(item))}
              selected={selected}
              onToggle={withSelection ? onToggle : undefined}
              busy={busy}
              onAction={onAction}
              onDismiss={onDismiss}
            />
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
};

export default TodoItemTable;
