'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  FormControl,
  IconButton,
  InputAdornment,
  InputLabel,
  MenuItem,
  Select,
  TablePagination,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import SearchIcon from '@mui/icons-material/Search';
import IngressAutomationService, {
  type IngressBulkAction,
  type IngressQueueGroup,
  type IngressQueueGroupsResult,
  type IngressQueueItem,
  type QueueGroupBy,
} from '@/service/ingress/IngressAutomationService';
import {
  GROUP_LIST_HEIGHT,
  GROUP_PREVIEW_SIZE,
  GROUP_ROWS_PER_PAGE_OPTIONS,
  QUEUE_GROUP_BY_OPTIONS,
  QUEUE_GROUP_STATUS_OPTIONS,
  applyBulkResultToGroup,
  buildGroupBulkRequest,
  buildRowOffsets,
  buildTriageRows,
  describeBulkResult,
  formatGroupCount,
  getBulkFailureLines,
  getGroupActionCount,
  getGroupLabel,
  getGroupSelectionState,
  getTriageWindow,
  needsActionConfirmation,
  optimisticGroupForAction,
  queueGroupSignature,
  toggleGroupSelection,
  togglePreviewItemSelection,
  type GroupSelectionMap,
} from '@/service/ingress/ingressTriageGroupsModel';
import { isIngressTimeoutError } from '@/service/ingress/ingressQueueModel';
import useIngressAssignDialog from '@/hooks/ingress/useIngressAssignDialog';
import useIngressQueueActions from '@/hooks/ingress/useIngressQueueActions';
import IngressManualAssignDialog from './ingress/IngressManualAssignDialog';
import { IngressTriageGroupRow, IngressTriageMoreRow, IngressTriagePreviewRow, ROW_COLUMNS } from './ingress/IngressTriageRows';

type PendingAction = { action: IngressBulkAction; group: IngressQueueGroup; count: number };
type ActionReport = { text: string; failures: string[]; severity: 'success' | 'warning' };

/**
 * Grouped triage queue: one row per folder/title, each with per-status counts and accept/ignore that
 * posts a single bulk request keyed by the group, so a 1,900-file folder never lands in the browser.
 * Only the scrolled window of rows is mounted (see getTriageWindow), and search/status/paging are
 * resolved by GET /api/ingress/queue/groups rather than in the client.
 */
export const IngressTriageGroups: React.FC = () => {
  const [groupBy, setGroupBy] = useState<QueueGroupBy>('source_folder');
  const [statusFilter, setStatusFilter] = useState('all');
  const [searchInput, setSearchInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(GROUP_ROWS_PER_PAGE_OPTIONS[1]);
  const [data, setData] = useState<IngressQueueGroupsResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<ActionReport | null>(null);
  const [selection, setSelection] = useState<GroupSelectionMap>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [scrollTop, setScrollTop] = useState(0);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [inFlight, setInFlight] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  // Per-item work started from a preview row (classification override, manual assign) belongs to the
  // reused queue hooks, not to a group batch: keep its in-flight flag separate.
  const [perItemWorking, setPerItemWorking] = useState(false);

  const previewQueueItems = useMemo(
    () => (data?.groups ?? []).flatMap((group) => group.preview_items ?? []),
    [data]
  );
  const refreshPreviewItems = useCallback(async () => {
    setReloadToken((token) => token + 1);
  }, []);

  // The folder view reuses the flat queue list's own handlers for the per-item affordances it also
  // owes its rows (classification override, manual assign) instead of growing a second implementation.
  const queueActions = useIngressQueueActions({
    queueItems: previewQueueItems,
    selectedQueueItems: [],
    refreshAll: refreshPreviewItems,
    setError,
    setWorking: setPerItemWorking,
  });
  const assignDialog = useIngressAssignDialog({
    queueItems: previewQueueItems,
    refreshAll: refreshPreviewItems,
    setError,
    setSelectedQueueItemIds: () => undefined,
  });

  // Search is a server query param; the debounce keeps keystrokes from turning into a scan per key.
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearchQuery(searchInput.trim());
      setPage(0);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(
        await IngressAutomationService.getQueueGroups({
          groupBy,
          statuses: statusFilter === 'all' ? undefined : [statusFilter],
          q: searchQuery || undefined,
          limit: rowsPerPage,
          offset: page * rowsPerPage,
          previewSize: GROUP_PREVIEW_SIZE,
        })
      );
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load queue groups');
    } finally {
      setLoading(false);
    }
  }, [groupBy, statusFilter, searchQuery, page, rowsPerPage, reloadToken]);

  useEffect(() => {
    void load();
  }, [load]);

  const groups = data?.groups ?? [];
  const rows = useMemo(() => buildTriageRows(groups, expanded), [groups, expanded]);
  const offsets = useMemo(() => buildRowOffsets(rows), [rows]);
  const window = getTriageWindow(rows, offsets, scrollTop);
  const visibleRows = rows.slice(window.start, window.end);

  // Rewrite one group row in place: that is how a batch updates its row without refetching the page.
  const patchGroup = useCallback((signature: string, updater: (group: IngressQueueGroup) => IngressQueueGroup) => {
    setData((prev) =>
      prev ? { ...prev, groups: prev.groups.map((group) => (queueGroupSignature(group) === signature ? updater(group) : group)) } : prev
    );
  }, []);

  const runGroupAction = useCallback(
    async (action: IngressBulkAction, group: IngressQueueGroup, excludedItemIds: string[], count: number) => {
      const signature = queueGroupSignature(group);
      setWorking(true);
      setInFlight(signature);
      patchGroup(signature, (current) => optimisticGroupForAction(current, action, count));
      try {
        const result = await IngressAutomationService.bulkQueueAction(buildGroupBulkRequest(action, group, excludedItemIds));
        setReport({
          text: describeBulkResult(result, getGroupLabel(group, groupBy)),
          failures: getBulkFailureLines(result),
          severity: result.failed > 0 || result.skipped > 0 ? 'warning' : 'success',
        });
        patchGroup(signature, () => applyBulkResultToGroup(group, result));
        setSelection((prev) => {
          const next = { ...prev };
          delete next[signature];
          return next;
        });
      } catch (err) {
        if (isIngressTimeoutError(err)) {
          // Only the *request* gave up: a group batch can still be applying server-side, so re-read the
          // page and show what actually happened instead of the stale pre-action snapshot.
          setReloadToken((token) => token + 1);
        } else {
          patchGroup(signature, () => group); // refused outright: nothing happened, roll back
        }
        setError(err instanceof Error ? err.message : `Failed to ${action} group`);
      } finally {
        setWorking(false);
        setInFlight(null);
      }
    },
    [groupBy, patchGroup]
  );

  const requestGroupAction = (action: IngressBulkAction, group: IngressQueueGroup) => {
    const excludedItemIds = selection[queueGroupSignature(group)] ?? [];
    const count = getGroupActionCount(group, action, excludedItemIds.length);
    if (count === 0) {
      return;
    }
    // Ignore is only undoable from the history log, so it always asks; accept asks once it is big.
    if (action === 'ignore' || needsActionConfirmation(count)) {
      setPending({ action, group, count });
      return;
    }
    void runGroupAction(action, group, excludedItemIds, count);
  };

  // Single rows go through the same bulk endpoint with itemIds, so accept/ignore semantics match the group.
  const runItemAction = useCallback(
    async (action: IngressBulkAction, group: IngressQueueGroup, item: IngressQueueItem) => {
      const signature = queueGroupSignature(group);
      setWorking(true);
      setInFlight(signature);
      patchGroup(signature, (current) => optimisticGroupForAction(current, action, 1));
      try {
        const result = await IngressAutomationService.bulkQueueAction({ action, itemIds: [item.id] });
        setReport({
          text: describeBulkResult(result, item.file_name),
          failures: getBulkFailureLines(result),
          severity: result.failed > 0 ? 'warning' : 'success',
        });
        const itemStatus = result.results?.[0]?.item_status;
        patchGroup(signature, () => {
          const next = applyBulkResultToGroup(group, result);
          return itemStatus
            ? { ...next, preview_items: (next.preview_items || []).map((row) => (row.id === item.id ? { ...row, status: itemStatus } : row)) }
            : next;
        });
      } catch (err) {
        if (isIngressTimeoutError(err)) {
          setReloadToken((token) => token + 1); // outcome unknown — let the server report this row back
        } else {
          patchGroup(signature, () => group);
        }
        setError(err instanceof Error ? err.message : `Failed to ${action} item`);
      } finally {
        setWorking(false);
        setInFlight(null);
      }
    },
    [patchGroup]
  );

  const toggleExpand = (group: IngressQueueGroup) => {
    const signature = queueGroupSignature(group);
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(signature)) {
        next.delete(signature);
      } else {
        next.add(signature);
      }
      return next;
    });
  };

  const selectedOnPage = groups.filter((group) => getGroupSelectionState(group, selection) !== 'none').length;
  const togglePageSelection = () => {
    setSelection((prev) => {
      if (groups.length > 0 && groups.every((group) => prev[queueGroupSignature(group)])) {
        return {};
      }
      return groups.reduce((acc, group) => ({ ...acc, [queueGroupSignature(group)]: [] }), {} as GroupSelectionMap);
    });
  };

  return (
    <Card>
      <CardContent>
        <Box sx={{ alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: 2, mb: 2 }}>
          <Typography variant="h6">Review by folder</Typography>
          <ToggleButtonGroup
            size="small"
            exclusive
            value={groupBy}
            onChange={(_, value) => {
              if (value) {
                setGroupBy(value as QueueGroupBy);
                setPage(0);
              }
            }}
            aria-label="Group queue by"
          >
            {QUEUE_GROUP_BY_OPTIONS.map((option) => (
              <ToggleButton key={option.value} value={option.value}>
                {option.label}
              </ToggleButton>
            ))}
          </ToggleButtonGroup>
          <FormControl size="small" sx={{ minWidth: 160 }}>
            <InputLabel id="triage-status-label">Status</InputLabel>
            <Select
              labelId="triage-status-label"
              label="Status"
              value={statusFilter}
              onChange={(event) => {
                setStatusFilter(event.target.value);
                setPage(0);
              }}
            >
              {QUEUE_GROUP_STATUS_OPTIONS.map((status) => (
                <MenuItem key={status} value={status}>
                  {status === 'all' ? 'All statuses' : status.replace(/_/g, ' ')}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <TextField
            size="small"
            label="Search path or title"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon fontSize="small" />
                </InputAdornment>
              ),
            }}
            sx={{ minWidth: 240 }}
          />
          <Box sx={{ flexGrow: 1 }} />
          <Typography variant="caption" color="text.secondary" data-testid="triage-summary">
            {data ? `${formatGroupCount(data.total_groups)} groups · ${formatGroupCount(data.total_items)} items` : '—'}
          </Typography>
          <IconButton onClick={() => setReloadToken((token) => token + 1)} disabled={loading} aria-label="Reload queue groups">
            <RefreshIcon />
          </IconButton>
        </Box>

        {error ? <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert> : null}
        {report ? (
          <Alert severity={report.severity} sx={{ mb: 2 }}>
            {report.text}
            {report.failures.length > 0 ? (
              <Box component="ul" sx={{ m: 1, pl: 2 }}>
                {report.failures.map((line) => (
                  <Box component="li" key={line} sx={{ fontSize: 13 }}>
                    {line}
                  </Box>
                ))}
              </Box>
            ) : null}
          </Alert>
        ) : null}

        <Box
          data-testid="triage-list"
          onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
          sx={{ height: `${GROUP_LIST_HEIGHT}px`, overflowY: 'auto' }}
        >
          <Box
            sx={{
              alignItems: 'center',
              background: 'background.paper',
              display: 'grid',
              gap: 1,
              gridTemplateColumns: ROW_COLUMNS,
              position: 'sticky',
              top: 0,
              zIndex: 1,
              px: 1,
            }}
            role="row"
          >
            <Checkbox
              checked={groups.length > 0 && selectedOnPage === groups.length}
              indeterminate={selectedOnPage > 0 && selectedOnPage < groups.length}
              disabled={groups.length === 0 || working}
              onChange={togglePageSelection}
              inputProps={{ 'aria-label': 'Select all groups on page' }}
            />
            <Box />
            <Typography variant="caption">Group</Typography>
            <Typography variant="caption" sx={{ textAlign: 'right' }}>
              Items
            </Typography>
            <Typography variant="caption">Statuses</Typography>
            <Typography variant="caption">Oldest</Typography>
            <Typography variant="caption">Confidence</Typography>
            <Typography variant="caption" sx={{ textAlign: 'right' }}>
              Actions
            </Typography>
          </Box>

          {loading && groups.length === 0 ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', p: 3 }}>
              <CircularProgress size={20} />
            </Box>
          ) : null}
          {!loading && groups.length === 0 ? (
            <Alert severity="info">No queue groups match the current filter.</Alert>
          ) : null}

          {window.padTop > 0 ? <Box data-testid="triage-pad-top" sx={{ height: `${window.padTop}px` }} /> : null}
          {visibleRows.map((row) =>
            row.kind === 'group' ? (
              <IngressTriageGroupRow
                key={row.key}
                group={row.group}
                groupBy={groupBy}
                expanded={expanded.has(queueGroupSignature(row.group))}
                selectionState={getGroupSelectionState(row.group, selection)}
                excludedCount={(selection[queueGroupSignature(row.group)] ?? []).length}
                working={working}
                inFlight={inFlight === queueGroupSignature(row.group)}
                onToggleGroup={(group) => setSelection((prev) => toggleGroupSelection(prev, group))}
                onToggleExpand={toggleExpand}
                onGroupAction={requestGroupAction}
              />
            ) : row.kind === 'more' ? (
              <IngressTriageMoreRow key={row.key} label={row.label} />
            ) : (
              <IngressTriagePreviewRow
                key={row.key}
                item={row.item}
                groupSelected={getGroupSelectionState(row.group, selection) !== 'none'}
                excluded={(selection[queueGroupSignature(row.group)] ?? []).includes(row.item.id)}
                working={working || perItemWorking}
                onToggleExcluded={(item, checked) =>
                  setSelection((prev) => togglePreviewItemSelection(prev, row.group, item.id, checked))
                }
                onItemAction={(action, item) => void runItemAction(action, row.group, item)}
                onReclassify={(item, classification) =>
                  void queueActions.handleUpdateClassification([item.id], classification)
                }
                onAssign={(item) => assignDialog.openAssignDialog([item.id])}
              />
            )
          )}
          {window.padBottom > 0 ? <Box data-testid="triage-pad-bottom" sx={{ height: `${window.padBottom}px` }} /> : null}
        </Box>

        <TablePagination
          component="div"
          count={data?.total_groups ?? 0}
          page={page}
          onPageChange={(_, newPage) => setPage(newPage)}
          rowsPerPage={rowsPerPage}
          onRowsPerPageChange={(event) => {
            setRowsPerPage(parseInt(event.target.value, 10));
            setPage(0);
          }}
          rowsPerPageOptions={GROUP_ROWS_PER_PAGE_OPTIONS}
        />

        <Dialog open={pending !== null} onClose={() => setPending(null)}>
          <DialogTitle>{pending?.action === 'ignore' ? 'Ignore queue group?' : 'Accept queue group?'}</DialogTitle>
          <DialogContent>
            <DialogContentText>
              {pending
                ? `${pending.action === 'ignore' ? 'Ignore' : 'Accept'} ${formatGroupCount(pending.count)} item${
                    pending.count === 1 ? '' : 's'
                  } in ${getGroupLabel(pending.group, groupBy)}?${
                    pending.action === 'ignore' ? ' This is only undoable from the history log.' : ''
                  }`
                : ''}
            </DialogContentText>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setPending(null)}>Cancel</Button>
            <Button
              variant="contained"
              color={pending?.action === 'ignore' ? 'error' : 'primary'}
              onClick={() => {
                if (!pending) {
                  return;
                }
                const excludedItemIds = selection[queueGroupSignature(pending.group)] ?? [];
                void runGroupAction(pending.action, pending.group, excludedItemIds, pending.count);
                setPending(null);
              }}
            >
              {pending?.action === 'ignore' ? 'Ignore group' : 'Accept group'}
            </Button>
          </DialogActions>
        </Dialog>

        <IngressManualAssignDialog
          open={assignDialog.assignDialogOpen}
          assigning={assignDialog.assigning}
          assignSearching={assignDialog.assignSearching}
          assignTargetCount={assignDialog.assignTargetItemIds.length}
          assignMediaType={assignDialog.assignMediaType}
          onAssignMediaTypeChange={assignDialog.setAssignMediaType}
          assignSearchMode={assignDialog.assignSearchMode}
          onAssignSearchModeChange={assignDialog.handleAssignSearchModeChange}
          assignSearchSource={assignDialog.assignSearchSource}
          onAssignSearchSourceChange={assignDialog.handleAssignSearchSourceChange}
          assignSearchQuery={assignDialog.assignSearchQuery}
          onAssignSearchQueryChange={assignDialog.setAssignSearchQuery}
          assignImdbQuery={assignDialog.assignImdbQuery}
          onAssignImdbQueryChange={assignDialog.setAssignImdbQuery}
          assignSearchResults={assignDialog.assignSearchResults}
          visibleAssignSearchResults={assignDialog.visibleAssignSearchResults}
          selectedAssignResult={assignDialog.selectedAssignResult}
          onSelectAssignResult={assignDialog.setSelectedAssignResult}
          assignTargets={assignDialog.assignTargets}
          episodeMapByItemId={assignDialog.episodeMapByItemId}
          onEpisodeMappingChange={assignDialog.updateEpisodeMapping}
          organizeAfterAssign={assignDialog.organizeAfterAssign}
          onOrganizeAfterAssignChange={assignDialog.setOrganizeAfterAssign}
          onSearch={assignDialog.handleAssignSearch}
          onImdbSearch={assignDialog.handleAssignImdbSearch}
          onResultsScroll={assignDialog.handleAssignResultsScroll}
          onClose={assignDialog.closeAssignDialog}
          onAssign={assignDialog.handleManualAssign}
        />
      </CardContent>
    </Card>
  );
};

export default IngressTriageGroups;
