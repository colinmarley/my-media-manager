'use client';

import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import { VisibilityOffOutlined } from '@mui/icons-material';

import EmptyState from '@/components/ui/EmptyState';
import AttentionService from '@/service/attention/AttentionService';
import { isAttentionKind, kindMeta } from '@/service/attention/attentionModel';
import { borders, fontFamilies, surfaces } from '@/theme/tokens';
import type { AttentionDismissal } from '@/types/attention/Attention.type';

interface Props {
  /** Restores one dismissal (DELETE) and refetches the list and summary. */
  onRestore: (dismissal: AttentionDismissal) => Promise<boolean>;
  busy?: boolean;
}

const formatDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString() : null);

/** Everything that was dismissed, with Restore. */
const DismissedList = ({ onRestore, busy }: Props) => {
  const [rows, setRows] = useState<AttentionDismissal[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setRows(await AttentionService.getDismissals());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load dismissed items.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) {
    return (
      <Alert severity="error" action={<Button color="inherit" size="small" onClick={() => void load()}>Retry</Button>}>
        {error}
      </Alert>
    );
  }
  if (!rows) return <Skeleton variant="rounded" height={120} aria-label="Loading dismissed items" />;
  if (rows.length === 0) {
    return <EmptyState icon={<VisibilityOffOutlined />} title="Nothing is dismissed" description="Items you dismiss from the To-Do list show up here so you can bring them back." />;
  }

  return (
    <TableContainer sx={{ border: `1px solid ${borders.default}`, borderRadius: 1, bgcolor: surfaces.paper }}>
      <Table size="small" aria-label="Dismissed items">
        <TableHead>
          <TableRow>
            <TableCell sx={{ color: 'text.secondary' }}>Item</TableCell>
            <TableCell sx={{ color: 'text.secondary' }}>Category</TableCell>
            <TableCell sx={{ color: 'text.secondary' }}>Hidden</TableCell>
            <TableCell sx={{ color: 'text.secondary' }}>Note</TableCell>
            <TableCell align="right" sx={{ color: 'text.secondary' }}>Actions</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.id} hover>
              <TableCell component="th" scope="row" sx={{ fontFamily: fontFamilies.mono, fontSize: '0.75rem', overflowWrap: 'anywhere' }}>
                {row.subjectType.replace('_', ' ')} {row.subjectId}
              </TableCell>
              <TableCell>{isAttentionKind(row.kind) ? kindMeta(row.kind).label : row.kind}</TableCell>
              <TableCell sx={{ whiteSpace: 'nowrap' }}>
                {row.dismissedUntil ? `Until ${formatDate(row.dismissedUntil)}` : 'Until it changes'}
              </TableCell>
              <TableCell>
                <Typography variant="body2" color={row.note ? 'text.primary' : 'text.disabled'}>{row.note || '—'}</Typography>
              </TableCell>
              <TableCell align="right">
                <Button
                  size="small"
                  disabled={busy}
                  onClick={async () => {
                    if (await onRestore(row)) await load();
                  }}
                  aria-label={`Restore ${row.subjectType.replace('_', ' ')} ${row.subjectId}`}
                >
                  Restore
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
};

export default DismissedList;
