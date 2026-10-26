'use client';

import React from 'react';
import {
  Box,
  Button,
  Checkbox,
  Chip,
  IconButton,
  Tooltip,
  Typography,
} from '@mui/material';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import type { IngressQueueGroup, IngressQueueItem, QueueGroupBy } from '@/service/ingress/IngressAutomationService';
import { STATUS_COLORS } from '@/service/ingress/ingressQueueModel';
import {
  GROUP_ROW_HEIGHT,
  PREVIEW_ROW_HEIGHT,
  formatConfidenceRange,
  formatGroupCount,
  getGroupActionCount,
  getGroupLabel,
  getGroupStatusChips,
  getGroupSubLabel,
  getOldestAgeLabel,
  getQueueStatusLabel,
  queueGroupSignature,
  type GroupSelectionState,
} from '@/service/ingress/ingressTriageGroupsModel';

const ROW_COLUMNS = '44px 36px minmax(160px, 2fr) 90px minmax(140px, 2fr) 72px 84px 176px';

type GroupRowProps = {
  group: IngressQueueGroup;
  groupBy: QueueGroupBy;
  expanded: boolean;
  selectionState: GroupSelectionState;
  excludedCount: number;
  working: boolean;
  onToggleGroup: (group: IngressQueueGroup) => void;
  onToggleExpand: (group: IngressQueueGroup) => void;
  onGroupAction: (action: 'accept' | 'ignore', group: IngressQueueGroup) => void;
};

export const IngressTriageGroupRow: React.FC<GroupRowProps> = ({
  group,
  groupBy,
  expanded,
  selectionState,
  excludedCount,
  working,
  onToggleGroup,
  onToggleExpand,
  onGroupAction,
}) => {
  const label = getGroupLabel(group, groupBy);
  const acceptCount = getGroupActionCount(group, 'accept', excludedCount);
  const ignoreCount = getGroupActionCount(group, 'ignore', excludedCount);

  return (
    <Box
      data-testid={`triage-group-${queueGroupSignature(group)}`}
      sx={{
        alignItems: 'center',
        borderLeft: '3px solid',
        borderColor: selectionState === 'none' ? 'divider' : 'primary.main',
        display: 'grid',
        gap: 1,
        gridTemplateColumns: ROW_COLUMNS,
        height: `${GROUP_ROW_HEIGHT}px`,
        px: 1,
      }}
      role="row"
    >
      <Checkbox
        checked={selectionState === 'all'}
        indeterminate={selectionState === 'partial'}
        disabled={working}
        onChange={() => onToggleGroup(group)}
        inputProps={{ 'aria-label': `Select group ${label}` }}
      />
      <IconButton size="small" onClick={() => onToggleExpand(group)} aria-label={`${expanded ? 'Collapse' : 'Expand'} ${label}`}>
        {expanded ? <ExpandMoreIcon /> : <ChevronRightIcon />}
      </IconButton>
      <Box sx={{ minWidth: 0 }}>
        <Typography noWrap variant="subtitle2" title={label}>
          {label}
        </Typography>
        <Typography noWrap variant="caption" color="text.secondary" title={group.ingress_path}>
          {getGroupSubLabel(group)}
        </Typography>
        {group.suggestion ? (
          <Typography noWrap variant="caption" color="text.secondary" display="block">
            Suggested: {group.suggestion}
          </Typography>
        ) : null}
      </Box>
      <Box sx={{ textAlign: 'right' }}>
        <Typography variant="body2">{formatGroupCount(group.matching_count)}</Typography>
        <Typography variant="caption" color="text.secondary">
          of {formatGroupCount(group.item_count)}
        </Typography>
      </Box>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
        {getGroupStatusChips(group).map((chip) => (
          <Chip
            key={chip.status}
            size="small"
            variant="outlined"
            color={chip.color}
            label={`${chip.count} ${getQueueStatusLabel(chip.status)}`}
          />
        ))}
      </Box>
      <Typography variant="body2">{getOldestAgeLabel(group)}</Typography>
      <Typography variant="body2">{formatConfidenceRange(group)}</Typography>
      <Box sx={{ display: 'flex', gap: 0.5, justifyContent: 'flex-end' }}>
        <Button
          size="small"
          variant="contained"
          disabled={working || acceptCount === 0}
          onClick={() => onGroupAction('accept', group)}
        >
          Accept {acceptCount}
        </Button>
        <Tooltip title="Ignore is only undoable from the history log">
          <Button
            size="small"
            variant="outlined"
            color="error"
            disabled={working || ignoreCount === 0}
            onClick={() => onGroupAction('ignore', group)}
          >
            Ignore
          </Button>
        </Tooltip>
      </Box>
    </Box>
  );
};

type PreviewRowProps = {
  item: IngressQueueItem;
  groupSelected: boolean;
  excluded: boolean;
  working: boolean;
  onToggleExcluded: (item: IngressQueueItem, checked: boolean) => void;
  onItemAction: (action: 'accept' | 'ignore' | 'retry', item: IngressQueueItem) => void;
};

export const IngressTriagePreviewRow: React.FC<PreviewRowProps> = ({
  item,
  groupSelected,
  excluded,
  working,
  onToggleExcluded,
  onItemAction,
}) => (
  <Box
    data-testid={`triage-item-${item.id}`}
    sx={{
      alignItems: 'center',
      display: 'grid',
      gap: 1,
      gridTemplateColumns: ROW_COLUMNS,
      height: `${PREVIEW_ROW_HEIGHT}px`,
      pl: 6,
      pr: 1,
    }}
    role="row"
  >
    <Checkbox
      size="small"
      checked={groupSelected && !excluded}
      disabled={working || !groupSelected}
      onChange={(event) => onToggleExcluded(item, event.target.checked)}
      inputProps={{ 'aria-label': `Include ${item.file_name} in the batch` }}
    />
    <Box />
    <Typography noWrap variant="body2" title={item.file_path}>
      {item.file_name}
    </Typography>
    <Box />
    <Box sx={{ display: 'flex', gap: 0.5 }}>
      <Chip
        size="small"
        variant="outlined"
        color={getChipColor(item.status)}
        label={getQueueStatusLabel(item.status)}
      />
      {item.best_match?.title ? (
        <Typography noWrap variant="caption" color="text.secondary">
          {item.best_match.title}
        </Typography>
      ) : null}
    </Box>
    <Box />
    <Typography variant="caption" color="text.secondary">
      {item.confidence_score === undefined ? '—' : `${item.confidence_score}%`}
    </Typography>
    <Box sx={{ display: 'flex', gap: 0.5, justifyContent: 'flex-end' }}>
      <Button size="small" color="inherit" disabled={working} onClick={() => onItemAction('retry', item)}>
        Retry
      </Button>
      <Button size="small" color="inherit" disabled={working} onClick={() => onItemAction('accept', item)}>
        Accept
      </Button>
      <Button size="small" color="inherit" disabled={working} onClick={() => onItemAction('ignore', item)}>
        Ignore
      </Button>
    </Box>
  </Box>
);

// The parent owns every request; this row only reports intent.
function getChipColor(status: string) {
  return STATUS_COLORS[status] || 'default';
}
