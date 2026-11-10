'use client';

import React from 'react';
import {
  Box,
  Checkbox,
  Chip,
  FormControl,
  IconButton,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  TableCell,
  TableRow,
  Tooltip,
  Typography,
} from '@mui/material';
import {
  Cancel,
  CheckCircle,
  Edit,
  Replay,
  RestartAlt,
} from '@mui/icons-material';
import type {
  IngressQueueItem,
  QueueClassificationOverride,
} from '@/service/ingress/IngressAutomationService';
import {
  CLASSIFICATION_OPTIONS,
  STATUS_COLORS,
  formatDuration,
  getQueueClassificationBadges,
  getSourceFolderLabel,
  isAwaitingDestination,
  isClassificationEditable,
  isQueueItemSelectable,
} from '@/service/ingress/ingressQueueModel';
import { IngressConfidenceWithExplanation } from './IngressMatchExplanation';

type Props = {
  item: IngressQueueItem;
  selected: boolean;
  working: boolean;
  onToggleSelection: (itemId: string, shiftKey: boolean) => void;
  onRetry: (itemId: string) => void;
  onAssign: (itemIds: string[]) => void;
  onMarkDone: (itemId: string) => void;
  onResetToEncoded: (itemId: string) => void;
  onMarkFailed: (itemId: string) => void;
  onReclassify: (itemIds: string[], classification: QueueClassificationOverride) => void;
};

const IngressQueueTableRow: React.FC<Props> = ({
  item,
  selected,
  working,
  onToggleSelection,
  onRetry,
  onAssign,
  onMarkDone,
  onResetToEncoded,
  onMarkFailed,
  onReclassify,
}) => (
  <TableRow>
    <TableCell padding="checkbox">
      <Checkbox
        checked={selected}
        disabled={!isQueueItemSelectable(item) || working}
        onChange={(event) => onToggleSelection(item.id, event.nativeEvent instanceof MouseEvent ? event.nativeEvent.shiftKey : false)}
        inputProps={{ 'aria-label': `Select ${item.file_name}` }}
      />
    </TableCell>
    <TableCell sx={{ maxWidth: 240 }}>
      <Typography variant="body2" noWrap title={item.file_path}>
        {item.file_name}
      </Typography>
      {getSourceFolderLabel(item) && (
        <Typography variant="caption" display="block" color="text.secondary" noWrap title={item.file_path}>
          in {getSourceFolderLabel(item)}
        </Typography>
      )}
      {item.last_error && (
        <Typography variant="caption" color="error" noWrap title={item.last_error}>
          {item.last_error}
        </Typography>
      )}
    </TableCell>
    <TableCell sx={{ whiteSpace: 'nowrap' }}>
      <Typography variant="body2">
        {item.media_duration_ms != null ? formatDuration(item.media_duration_ms) : '—'}
      </Typography>
    </TableCell>
    <TableCell>
      <Chip
        label={item.status}
        size="small"
        color={STATUS_COLORS[item.status] || 'default'}
      />
    </TableCell>
    <TableCell sx={{ minWidth: 220 }}>
      <Stack direction="row" spacing={0.5} useFlexGap flexWrap="wrap">
        {getQueueClassificationBadges(item).map((badge) => (
          <Chip
            key={`${item.id}-${badge.label}`}
            label={badge.label}
            size="small"
            color={badge.color}
            variant={badge.variant || 'filled'}
          />
        ))}
      </Stack>
      <FormControl size="small" sx={{ mt: 1, minWidth: 170 }}>
        <InputLabel id={`classification-override-${item.id}`}>Override</InputLabel>
        <Select
          labelId={`classification-override-${item.id}`}
          value={item.classification_override || 'auto'}
          label="Override"
          disabled={!isClassificationEditable(item) || working}
          onChange={(event) => onReclassify([item.id], event.target.value as QueueClassificationOverride)}
        >
          {CLASSIFICATION_OPTIONS.map((option) => (
            <MenuItem key={option.value} value={option.value}>
              {option.label}
            </MenuItem>
          ))}
        </Select>
      </FormControl>
    </TableCell>
    <TableCell sx={{ maxWidth: 200 }}>
      <Typography variant="caption" noWrap title={item.best_match?.title}>
        {item.best_match?.title || '—'}
      </Typography>
      {item.best_match?.year && (
        <Typography variant="caption" color="text.secondary">
          {' '}({item.best_match.year})
        </Typography>
      )}
      {item.proposed_path && (
        <Typography variant="caption" display="block" color="text.secondary" noWrap title={item.proposed_path} sx={{ fontStyle: 'italic' }}>
          → {item.proposed_path}
        </Typography>
      )}
      {isAwaitingDestination(item) && (
        <Typography
          variant="caption"
          display="block"
          color="text.secondary"
          noWrap
          title="Nothing resolves a destination for this file yet. It stays in its source folder until it is matched."
          sx={{ fontStyle: 'italic' }}
        >
          No destination yet, stays in place
        </Typography>
      )}
      {item.parsed_info?.review_reason && (
        <Typography
          variant="caption"
          display="block"
          color={item.parsed_info.ambiguous_match ? 'warning.main' : 'text.secondary'}
          noWrap
          title={item.parsed_info.review_reason}
        >
          {item.parsed_info.review_reason}
        </Typography>
      )}
    </TableCell>
    <TableCell>
      <IngressConfidenceWithExplanation item={item}>
        {item.confidence_score ?? '—'}
      </IngressConfidenceWithExplanation>
    </TableCell>
    <TableCell>
      <Box sx={{ display: 'flex', gap: 0.5 }}>
        {(item.status === 'failed' || item.status === 'needs_review') && (
          <Tooltip title="Retry">
            <IconButton size="small" onClick={() => onRetry(item.id)}>
              <Replay fontSize="small" />
            </IconButton>
          </Tooltip>
        )}
        {(item.status === 'needs_review' || item.status === 'failed') && (
          <Tooltip title="Assign manually">
            <IconButton size="small" onClick={() => onAssign([item.id])}>
              <Edit fontSize="small" color="primary" />
            </IconButton>
          </Tooltip>
        )}
        {(item.status === 'needs_review' || item.status === 'auto_assigned') && (
          <Tooltip title="Mark done">
            <IconButton size="small" onClick={() => onMarkDone(item.id)}>
              <CheckCircle fontSize="small" color="success" />
            </IconButton>
          </Tooltip>
        )}
        {item.status === 'completed' && item.assignment_id && (
          <Tooltip title="Reset files back to encoded for retest">
            <IconButton size="small" onClick={() => onResetToEncoded(item.id)}>
              <RestartAlt fontSize="small" color="warning" />
            </IconButton>
          </Tooltip>
        )}
        {item.status === 'needs_review' && (
          <Tooltip title="Dismiss / mark failed">
            <IconButton size="small" onClick={() => onMarkFailed(item.id)}>
              <Cancel fontSize="small" color="error" />
            </IconButton>
          </Tooltip>
        )}
      </Box>
    </TableCell>
  </TableRow>
);

export default IngressQueueTableRow;
