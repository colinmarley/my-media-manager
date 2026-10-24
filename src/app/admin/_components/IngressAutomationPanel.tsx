"use client";

import React from 'react';
import { Box, CircularProgress, Grid, Typography } from '@mui/material';
import FolderBrowser from '@/app/admin/library/_components/FolderBrowser';
import IngressStatusAlerts from './ingress/IngressStatusAlerts';
import IngressStatusSummary from './ingress/IngressStatusSummary';
import IngressWatcherControlCard from './ingress/IngressWatcherControlCard';
import IngressSettingsCard from './ingress/IngressSettingsCard';
import IngressQueueCard from './ingress/IngressQueueCard';
import IngressHistoryCard from './ingress/IngressHistoryCard';
import IngressManualAssignDialog from './ingress/IngressManualAssignDialog';
import useIngressAssignDialog from '@/hooks/ingress/useIngressAssignDialog';
import useIngressQueueActions from '@/hooks/ingress/useIngressQueueActions';
import useIngressQueueSelection from '@/hooks/ingress/useIngressQueueSelection';
import useIngressStatus from '@/hooks/ingress/useIngressStatus';
import useIngressWatcherControl from '@/hooks/ingress/useIngressWatcherControl';

export {
  filterSelectableQueueItemIds,
  getQueueClassificationBadges,
  isEpisodeMappingValid,
  runQueueActionsSequentially,
} from '@/service/ingress/ingressQueueModel';
export type { EpisodeAssignmentMapping, QueueBadge } from '@/service/ingress/ingressQueueModel';

/**
 * Admin ingress automation dashboard.
 *
 * State lives in the ingress hooks; each visual block is rendered by a section component
 * under `./ingress`.
 */
const IngressAutomationPanel: React.FC = () => {
  const status = useIngressStatus();
  const selection = useIngressQueueSelection({
    queueItems: status.queueItems,
    filteredQueueItems: status.filteredQueueItems,
    selectedQueueItemIds: status.selectedQueueItemIds,
    setSelectedQueueItemIds: status.setSelectedQueueItemIds,
    lastSelectedQueueItemId: status.lastSelectedQueueItemId,
    setLastSelectedQueueItemId: status.setLastSelectedQueueItemId,
  });
  const queueActions = useIngressQueueActions({
    queueItems: status.queueItems,
    selectedQueueItems: selection.selectedQueueItems,
    refreshAll: status.refreshAll,
    setError: status.setError,
    setWorking: status.setWorking,
  });
  const watcherControl = useIngressWatcherControl({
    parsePathsInput: status.parsePathsInput,
    refreshAll: status.refreshAll,
    setError: status.setError,
    setStatusMessage: status.setStatusMessage,
    setWorking: status.setWorking,
  });
  const assignDialog = useIngressAssignDialog({
    queueItems: status.queueItems,
    refreshAll: status.refreshAll,
    setError: status.setError,
    setSelectedQueueItemIds: status.setSelectedQueueItemIds,
  });

  if (status.loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box>
      <Typography variant="h5" sx={{ mb: 2 }}>
        Ingress Automation
      </Typography>

      <IngressStatusAlerts
        error={status.error}
        statusMessage={status.statusMessage}
        watcher={status.watcher}
        queueStatus={status.queueStatus}
        health={status.health}
      />

      <IngressStatusSummary
        watcher={status.watcher}
        queueStatus={status.queueStatus}
        health={status.health}
      />

      <IngressWatcherControlCard
        pathsInput={status.pathsInput}
        onPathsInputChange={status.setPathsInput}
        processExistingOnStart={watcherControl.processExistingOnStart}
        onProcessExistingOnStartChange={watcherControl.setProcessExistingOnStart}
        resetCompletedOnStart={watcherControl.resetCompletedOnStart}
        onResetCompletedOnStartChange={watcherControl.setResetCompletedOnStart}
        working={status.working}
        watcher={status.watcher}
        onOpenFolderBrowser={() => watcherControl.setFolderBrowserOpen(true)}
        onStartWatcher={watcherControl.handleStartWatcher}
        onStopWatcher={watcherControl.handleStopWatcher}
        onProcessPending={watcherControl.handleProcessPending}
        onRefresh={status.refreshAll}
      />

      <IngressSettingsCard
        editThreshold={status.editThreshold}
        onEditThresholdChange={status.setEditThreshold}
        editAutoOrganize={status.editAutoOrganize}
        onEditAutoOrganizeChange={status.setEditAutoOrganize}
        editAutoProcess={status.editAutoProcess}
        onEditAutoProcessChange={status.setEditAutoProcess}
        savingConfig={status.savingConfig}
        onSaveConfig={status.handleSaveConfig}
      />

      <Grid container spacing={2}>
        <Grid size={{ xs: 12 }}>
          <IngressQueueCard
            working={status.working}
            selectedQueueItemIds={status.selectedQueueItemIds}
            selectableVisibleItems={selection.selectableVisibleItems}
            selectedVisibleCount={selection.selectedVisibleCount}
            selectedAcceptCount={selection.selectedAcceptCount}
            selectedRejectCount={selection.selectedRejectCount}
            selectedRetryCount={selection.selectedRetryCount}
            visibleQueueItems={selection.visibleQueueItems}
            filteredQueueItemsCount={status.filteredQueueItems.length}
            queuePage={selection.queuePage}
            queueRowsPerPage={selection.queueRowsPerPage}
            setQueuePage={selection.setQueuePage}
            setQueueRowsPerPage={selection.setQueueRowsPerPage}
            onToggleSelectAllVisible={selection.toggleSelectAllVisible}
            onBulkAccept={queueActions.handleBulkAccept}
            onBulkReject={queueActions.handleBulkReject}
            onBulkRetry={queueActions.handleBulkRetry}
            onOpenAssignDialog={assignDialog.openAssignDialog}
            onReclassify={queueActions.handleUpdateClassification}
            onRetry={queueActions.handleRetry}
            onMarkDone={queueActions.handleMarkDone}
            onMarkFailed={queueActions.handleMarkFailed}
            onResetToEncoded={queueActions.handleResetToEncoded}
            onToggleItemSelection={selection.toggleQueueItemSelection}
          />
        </Grid>

        <Grid size={{ xs: 12 }}>
          <IngressHistoryCard history={status.history} />
        </Grid>
      </Grid>

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

      <FolderBrowser
        open={watcherControl.folderBrowserOpen}
        onClose={() => watcherControl.setFolderBrowserOpen(false)}
        onSelect={(path) => {
          status.handleAddIngressPath(path);
          watcherControl.setFolderBrowserOpen(false);
        }}
      />
    </Box>
  );
};

export default IngressAutomationPanel;
