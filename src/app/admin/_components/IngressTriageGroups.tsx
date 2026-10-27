'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  aiFloorChoices,
  applyBulkResultToGroup,
  buildGroupBulkRequest,
  buildRowOffsets,
  buildTriageRows,
  describeAiClassifyError,
  describeBulkResult,
  formatAiConfidence,
  formatGroupCount,
  getAiClassifyAnswers,
  getAiSettings,
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

type PendingAction = { action: IngressBulkAction; group: IngressQueueGroup; count: number; minConfidence: number | null };
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
  // Jev confidence floor the reviewer wants Accept to honour; null means "accept everything actionable".
  const [minConfidence, setMinConfidence] = useState<number | null>(null);
  // Which group's folder classification is running. Separate from `working` on purpose: a folder can
  // take a while through the local model, and neither the rows nor the other groups wait on it.
  const [reclassifying, setReclassifying] = useState<string | null>(null);
  const ai = getAiSettings(data?.ai);
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

  // A successful re-read clears the error banner, with one exception: the reload a timed-out batch
  // triggers keeps the error which explains why the numbers on screen are no longer the ones the user
  // acted on. That reason is recorded explicitly, so a manual reload or a per-item refresh still clears.
  const querySignature = JSON.stringify([groupBy, statusFilter, searchQuery, page, rowsPerPage]);
  const lastQuerySignature = useRef<string | null>(null);
  const keepErrorAfterReload = useRef(false);

  // Answers can arrive out of order — a slow page-1 response landing after page-2's would repaint the
  // list with rows the user has already left behind — so only the newest request may paint.
  const requestId = useRef(0);

  const load = useCallback(async () => {
    const request = ++requestId.current;
    const freshQuery = lastQuerySignature.current !== querySignature;
    lastQuerySignature.current = querySignature;
    const keepError = keepErrorAfterReload.current && !freshQuery;
    keepErrorAfterReload.current = false;
    setLoading(true);
    try {
      const result = await IngressAutomationService.getQueueGroups({
        groupBy,
        statuses: statusFilter === 'all' ? undefined : [statusFilter],
        q: searchQuery || undefined,
        limit: rowsPerPage,
        offset: page * rowsPerPage,
        previewSize: GROUP_PREVIEW_SIZE,
      });
      if (request !== requestId.current) return;
      setData(result);
      if (!keepError) setError(null);
    } catch (err) {
      if (request !== requestId.current) return;
      setError(err instanceof Error ? err.message : 'Failed to load queue groups');
    } finally {
      if (request === requestId.current) setLoading(false);
    }
  }, [querySignature, groupBy, statusFilter, searchQuery, page, rowsPerPage, reloadToken]);

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
    async (
      action: IngressBulkAction,
      group: IngressQueueGroup,
      excludedItemIds: string[],
      count: number,
      acceptMinConfidence: number | null = null
    ) => {
      const signature = queueGroupSignature(group);
      setWorking(true);
      setInFlight(signature);
      setError(null);
      patchGroup(signature, (current) => optimisticGroupForAction(current, action, count));
      try {
        const result = await IngressAutomationService.bulkQueueAction(
          buildGroupBulkRequest(action, group, excludedItemIds, action === 'accept' ? acceptMinConfidence : null)
        );
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
          keepErrorAfterReload.current = true;
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
    // Only accept carries a floor: the server compares it against each item's Jev answer and skips the
    // rest, so the count shown here is the most the batch can do, not a promise it will do all of them.
    const floor = action === 'accept' ? minConfidence : null;
    if (count === 0) {
      return;
    }
    // Ignore is only undoable from the history log, so it always asks; accept asks once it is big.
    if (action === 'ignore' || needsActionConfirmation(count)) {
      setPending({ action, group, count, minConfidence: floor });
      return;
    }
    void runGroupAction(action, group, excludedItemIds, count, floor);
  };

  /**
   * "Re-classify with Jev": ask the classifier for this folder's answers now, whatever the mode says.
   * One request per group (the classifier answers every file in the folder from one of its ids), kept
   * off the batch `working` flag so the rest of the triage page stays usable while it runs, and re-read
   * afterwards so the answers on screen are the ones the server just stored.
   */
  const reclassifyGroupWithAI = useCallback(
    async (group: IngressQueueGroup) => {
      const signature = queueGroupSignature(group);
      const itemId = (group.preview_items || [])[0]?.id;
      if (!itemId || reclassifying !== null) {
        return;
      }
      setReclassifying(signature);
      try {
        const result = await IngressAutomationService.classifyQueueItemWithAI(itemId);
        // The classifier answers the folder in one call, keyed by item id, and skips the files it could
        // not label — count what it actually answered, in either shape it may send.
        const answered = getAiClassifyAnswers(result).filter((answer) => answer?.label).length;
        setReport({
          text: `Jev answered ${answered} file${answered === 1 ? '' : 's'} in ${getGroupLabel(group, groupBy)} (mode: ${result?.mode || ai.mode})`,
          failures: [],
          severity: 'success',
        });
        setReloadToken((token) => token + 1);
      } catch (err) {
        // 503 INGEST_AI_NOT_CONFIGURED is a normal answer on a backend without the classifier: say so,
        // and keep the rows as they are.
        setReport({
          text: `Jev did not re-classify ${getGroupLabel(group, groupBy)}`,
          failures: [describeAiClassifyError(err)],
          severity: 'warning',
        });
        if (isIngressTimeoutError(err)) {
          setReloadToken((token) => token + 1); // the answers may have landed anyway — let the server answer
        }
      } finally {
        setReclassifying(null);
      }
    },
    [ai.mode, groupBy, reclassifying]
  );

  // Single rows go through the same bulk endpoint with itemIds, so accept/ignore semantics match the group.
  const runItemAction = useCallback(
    async (action: IngressBulkAction, group: IngressQueueGroup, item: IngressQueueItem) => {
      const signature = queueGroupSignature(group);
      setWorking(true);
      setInFlight(signature);
      setError(null);
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
          keepErrorAfterReload.current = true;
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
      // Only this page's groups are in play: a group checked on another page stays checked, because a
      // batch is always one group and repainting this page must not silently drop the others.
      const onThisPage = new Set(groups.map((group) => queueGroupSignature(group)));
      const kept = Object.fromEntries(Object.entries(prev).filter(([signature]) => !onThisPage.has(signature)));
      if (groups.length > 0 && groups.every((group) => prev[queueGroupSignature(group)])) {
        return kept;
      }
      return groups.reduce(
        (acc, group) => ({ ...acc, [queueGroupSignature(group)]: [] }),
        kept as GroupSelectionMap
      );
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
          <FormControl size="small" sx={{ minWidth: 168 }}>
            <InputLabel id="triage-ai-floor-label">Jev accept floor</InputLabel>
            <Select
              labelId="triage-ai-floor-label"
              label="Jev accept floor"
              value={minConfidence === null ? 'none' : String(minConfidence)}
              onChange={(event) =>
                setMinConfidence(event.target.value === 'none' ? null : Number(event.target.value))
              }
            >
              <MenuItem value="none">No floor</MenuItem>
              {/* Choices under the configured MEDIA_LIBRARY_INGEST_AI_MIN_CONFIDENCE are not offered: a
                  request cannot lower that floor, so offering them would only be a lie. */}
              {aiFloorChoices(ai.min_confidence).map((choice) => (
                <MenuItem key={choice} value={String(choice)}>
                  {`≥ ${formatAiConfidence(choice)}`}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <Typography variant="caption" color="text.secondary" data-testid="triage-ai-mode">
            {`Jev ${ai.mode} · floor ${formatAiConfidence(ai.min_confidence)}`}
          </Typography>
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
          <IconButton
            onClick={() => {
              keepErrorAfterReload.current = false;
              setReloadToken((token) => token + 1);
            }}
            disabled={loading}
            aria-label="Reload queue groups"
          >
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
                ai={ai}
                reclassifying={reclassifying === queueGroupSignature(row.group)}
                acceptMinConfidence={minConfidence}
                onToggleGroup={(group) => setSelection((prev) => toggleGroupSelection(prev, group))}
                onToggleExpand={toggleExpand}
                onGroupAction={requestGroupAction}
                onReclassifyGroup={(group) => void reclassifyGroupWithAI(group)}
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
                ai={ai}
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
                    pending.minConfidence !== null
                      ? ` Only items Jev answers with at least ${formatAiConfidence(pending.minConfidence)} confidence are organized; the rest are skipped.`
                      : ''
                  }${
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
                void runGroupAction(pending.action, pending.group, excludedItemIds, pending.count, pending.minConfidence);
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
