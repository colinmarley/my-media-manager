'use client';

import React from 'react';
import {
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  FormControl,
  IconButton,
  MenuItem,
  Select,
  Typography,
} from '@mui/material';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import EditIcon from '@mui/icons-material/Edit';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import type {
  IngressAiSettings,
  IngressQueueGroup,
  IngressQueueItem,
  QueueClassificationOverride,
  QueueGroupBy,
} from '@/service/ingress/IngressAutomationService';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import { CLASSIFICATION_OPTIONS, STATUS_COLORS, isClassificationEditable, isQueueItemAssignable } from '@/service/ingress/ingressQueueModel';
import {
  GROUP_ROW_HEIGHT,
  MORE_ROW_HEIGHT,
  PREVIEW_ROW_HEIGHT,
  describeAcceptAction,
  formatAiConfidence,
  formatConfidenceRange,
  formatGroupCount,
  getGroupActionCount,
  getGroupAiSummaryLabel,
  getGroupLabel,
  getGroupStatusChips,
  getGroupSubLabel,
  getItemAiLabel,
  getAiSettings,
  getOldestAgeLabel,
  getQueueStatusLabel,
  queueGroupSignature,
  type GroupSelectionState,
} from '@/service/ingress/ingressTriageGroupsModel';

/** Shared by the sticky header, group rows and preview rows so the three grids stay aligned. */
export const ROW_COLUMNS = '44px 36px minmax(160px, 2fr) 90px minmax(150px, 2fr) 72px 84px 212px';

type GroupRowProps = {
  group: IngressQueueGroup;
  groupBy: QueueGroupBy;
  expanded: boolean;
  selectionState: GroupSelectionState;
  excludedCount: number;
  working: boolean;
  /** A batch for this group is in flight: the row already shows its optimistic status. */
  inFlight: boolean;
  /** Live Jev mode and confidence floor, from GET /queue/groups — decides how answers read. */
  ai?: IngressAiSettings;
  /** A folder classification for this group is running; only this button waits for it. */
  reclassifying: boolean;
  /** Reviewer-picked Jev confidence floor for this group's Accept, or null for a plain accept. */
  acceptMinConfidence: number | null;
  onToggleGroup: (group: IngressQueueGroup) => void;
  onToggleExpand: (group: IngressQueueGroup) => void;
  onGroupAction: (action: 'accept' | 'ignore', group: IngressQueueGroup) => void;
  onReclassifyGroup: (group: IngressQueueGroup) => void;
};

export const IngressTriageGroupRow: React.FC<GroupRowProps> = ({
  group,
  groupBy,
  expanded,
  selectionState,
  excludedCount,
  working,
  inFlight,
  ai,
  reclassifying,
  acceptMinConfidence,
  onToggleGroup,
  onToggleExpand,
  onGroupAction,
  onReclassifyGroup,
}) => {
  const label = getGroupLabel(group, groupBy);
  const settings = getAiSettings(ai);
  const acceptCount = getGroupActionCount(group, 'accept', excludedCount);
  const acceptAction = describeAcceptAction(acceptCount, acceptMinConfidence);
  const ignoreCount = getGroupActionCount(group, 'ignore', excludedCount);
  // The classifier answers a whole folder from one of its files, and triage only holds the preview.
  const canReclassify = (group.preview_items || []).length > 0;
  // Same button either way — the floor only narrows what the server agrees to organize, and saying so
  // here is what tells a reviewer why the accepted count can come back smaller than this number.
  const acceptTitle =
    acceptMinConfidence === null
      ? 'Organize every item in this folder and write the library records — the same path as accepting one item'
      : `Organize only the items Jev answers with at least ${formatAiConfidence(acceptMinConfidence)} confidence — the rest are skipped, and the configured floor is never lower`;

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
        {/* #36's line: the group's Jev summary. Rendered whether or not there are answers, so rows
            with AI and rows without keep the same height. */}
        <Typography
          noWrap
          variant="caption"
          color="text.secondary"
          display="flex"
          alignItems="center"
          gap={0.5}
          title={getGroupAiSummaryLabel(group, settings)}
        >
          <Box component="span" sx={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {getGroupAiSummaryLabel(group, settings)}
          </Box>
          <IconButton
            size="small"
            disabled={working || reclassifying || !canReclassify}
            onClick={() => onReclassifyGroup(group)}
            aria-label={`Re-classify ${label} with Jev`}
            title={
              canReclassify
                ? `Run the Jev classifier on this folder now (mode: ${settings.mode})`
                : 'No preview item in this group to classify'
            }
            sx={{ flexShrink: 0, p: 0.25 }}
          >
            {reclassifying ? <CircularProgress size={14} /> : <AutoAwesomeIcon fontSize="small" />}
          </IconButton>
        </Typography>
        {inFlight ? (
          <Typography variant="caption" display="block">
            Applying…
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
          aria-label={acceptAction.ariaLabel}
          title={acceptTitle}
        >
          {acceptAction.text}
        </Button>
        {/* aria-label, not a Tooltip: a Tooltip would replace the button's accessible name with its warning text. */}
        <Button
          size="small"
          variant="outlined"
          color="error"
          disabled={working || ignoreCount === 0}
          onClick={() => onGroupAction('ignore', group)}
          aria-label={`Ignore ${ignoreCount} in this group. Ignore is only undoable from the history log.`}
          title="Ignore is only undoable from the history log"
        >
          Ignore {ignoreCount}
        </Button>
      </Box>
    </Box>
  );
};

// A group is only ever previewed; everything past the preview stays server-side and is counted here.
export const IngressTriageMoreRow: React.FC<{ label: string }> = ({ label }) => (
  <Box
    data-testid="triage-more"
    role="row"
    sx={{ alignItems: 'center', display: 'flex', height: `${MORE_ROW_HEIGHT}px`, pl: 6, pr: 1 }}
  >
    <Typography variant="caption" color="text.secondary">
      {label}
    </Typography>
  </Box>
);

type PreviewRowProps = {
  item: IngressQueueItem;
  groupSelected: boolean;
  excluded: boolean;
  working: boolean;
  /** Absent from a backend predating issue #36, which the UI reads as mode "off" with no answers. */
  ai?: IngressAiSettings;
  onToggleExcluded: (item: IngressQueueItem, checked: boolean) => void;
  onItemAction: (action: 'accept' | 'ignore' | 'retry', item: IngressQueueItem) => void;
  /** The flat queue table's own per-item affordances, reused here rather than re-invented (#35 review). */
  onReclassify: (item: IngressQueueItem, classification: QueueClassificationOverride) => void;
  onAssign: (item: IngressQueueItem) => void;
};

export const IngressTriagePreviewRow: React.FC<PreviewRowProps> = ({
  item,
  groupSelected,
  excluded,
  working,
  ai,
  onToggleExcluded,
  onItemAction,
  onReclassify,
  onAssign,
}) => {
  const aiLabel = getItemAiLabel(item, getAiSettings(ai));
  return (
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
      {/* Jev's own answer for this file — label + confidence, or the explicit no-answer state. Always
          rendered: a folder with AI off and a folder with answers keep the same 90px slot. */}
      <Box data-testid={`triage-ai-${item.id}`} title={aiLabel.detail} sx={{ minWidth: 0 }}>
        <Chip
          size="small"
          variant={aiLabel.answered ? 'filled' : 'outlined'}
          color={aiLabel.answered ? 'primary' : 'default'}
          label={aiLabel.text}
        />
      </Box>
      <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center' }}>
        <Chip
          size="small"
          variant="outlined"
          color={getChipColor(item.status)}
          label={getQueueStatusLabel(item.status)}
        />
        {/* Same classification override the flat queue table row exposes: triage from the folder view without
            losing the row to a re-scan, and the parent posts the identical request. */}
        <FormControl size="small" sx={{ flexShrink: 0, width: 104 }}>
          <Select
            value={item.classification_override || 'auto'}
            disabled={!isClassificationEditable(item) || working}
            onChange={(event) => onReclassify(item, event.target.value as QueueClassificationOverride)}
            // The name has to land on the combobox itself (MUI keeps a FormControl's aria-label on the
            // wrapper), and it has to name the file: a folder view holds one control per preview row.
            inputProps={{ 'aria-label': `Classification override for ${item.file_name}` }}
          >
            {CLASSIFICATION_OPTIONS.map((option) => (
              <MenuItem key={option.value} value={option.value}>
                {option.label}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
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
        {isQueueItemAssignable(item) ? (
          <IconButton
            size="small"
            disabled={working}
            onClick={() => onAssign(item)}
            aria-label={`Assign ${item.file_name} manually`}
            title="Pick the title by hand — the same dialog the flat queue list uses"
          >
            <EditIcon fontSize="small" />
          </IconButton>
        ) : null}
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
};

// The parent owns every request; this row only reports intent.
function getChipColor(status: string) {
  return STATUS_COLORS[status] || 'default';
}
