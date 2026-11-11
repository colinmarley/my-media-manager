'use client';

import React from 'react';
import { Box, Chip, type ChipProps } from '@mui/material';
import { status as statusColors, type StatusTone } from '@/theme/tokens';

interface StatusDefinition {
  tone: StatusTone;
  label: string;
}

/**
 * Every status word the UI shows, mapped to one tone and one label. Queue
 * statuses use the backend's names (backend/services/ingress_queue_service.py).
 */
export const STATUS_DEFINITIONS: Record<string, StatusDefinition> = {
  pending: { tone: 'info', label: 'Pending' },
  processing: { tone: 'info', label: 'Processing' },
  auto_assigned: { tone: 'success', label: 'Matched' },
  needs_review: { tone: 'warning', label: 'Needs review' },
  failed: { tone: 'error', label: 'Failed' },
  completed: { tone: 'success', label: 'Organized' },
  ignored: { tone: 'neutral', label: 'Ignored' },
  running: { tone: 'success', label: 'Running' },
  stopped: { tone: 'neutral', label: 'Stopped' },
  queued: { tone: 'info', label: 'Queued' },
  ripping: { tone: 'warning', label: 'Ripping' },
  delivering: { tone: 'warning', label: 'Delivering' },
  open: { tone: 'warning', label: 'Open' },
  success: { tone: 'success', label: 'OK' },
  warning: { tone: 'warning', label: 'Warning' },
  error: { tone: 'error', label: 'Error' },
  info: { tone: 'info', label: 'Info' },
  neutral: { tone: 'neutral', label: 'Unknown' },
};

function humanize(value: string): string {
  const text = value.replace(/[_-]+/g, ' ').trim();
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : 'Unknown';
}

export function resolveStatus(status: string | null | undefined): StatusDefinition {
  const key = (status ?? '').toLowerCase();
  return STATUS_DEFINITIONS[key] ?? { tone: 'neutral', label: humanize(status ?? '') };
}

export interface StatusChipProps extends Omit<ChipProps, 'color' | 'label'> {
  status: string | null | undefined;
  /** Overrides the mapped label (e.g. "3 failed"). */
  label?: React.ReactNode;
  /** Overrides the mapped tone. */
  tone?: StatusTone;
}

const StatusChip: React.FC<StatusChipProps> = ({ status, label, tone, size = 'small', sx, ...rest }) => {
  const resolved = resolveStatus(status);
  const colors = statusColors[tone ?? resolved.tone];
  return (
    <Chip
      size={size}
      data-tone={tone ?? resolved.tone}
      label={label ?? resolved.label}
      icon={<Box component="span" aria-hidden sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: colors.fg, ml: '8px !important' }} />}
      sx={[
        {
          color: colors.fg,
          bgcolor: colors.bg,
          border: `1px solid ${colors.border}`,
          height: size === 'small' ? 22 : 28,
          '& .MuiChip-label': { px: 1 },
        },
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
      {...rest}
    />
  );
};

export default StatusChip;
