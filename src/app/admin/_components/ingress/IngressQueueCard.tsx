'use client';

import React from 'react';
import {
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TablePagination,
  TableRow,
  Typography,
} from '@mui/material';
import type {
  IngressQueueItem,
  QueueClassificationOverride,
} from '@/service/ingress/IngressAutomationService';
import { QUEUE_ROWS_PER_PAGE_OPTIONS } from '@/service/ingress/ingressQueueModel';
import IngressQueueTableRow from './IngressQueueTableRow';

type Props = {
  working: boolean;
  selectedQueueItemIds: string[];
  selectableVisibleItems: IngressQueueItem[];
  selectedVisibleCount: number;
  selectedAcceptCount: number;
  selectedRejectCount: number;
  selectedRetryCount: number;
  visibleQueueItems: IngressQueueItem[];
  filteredQueueItemsCount: number;
  queuePage: number;
  queueRowsPerPage: number;
  setQueuePage: (page: number) => void;
  setQueueRowsPerPage: (rowsPerPage: number) => void;
  onToggleSelectAllVisible: () => void;
  onBulkAccept: () => void;
  onBulkReject: () => void;
  onBulkRetry: () => void;
  onOpenAssignDialog: (itemIds: string[]) => void;
  onReclassify: (itemIds: string[], classification: QueueClassificationOverride) => void;
  onRetry: (itemId: string) => void;
  onMarkDone: (itemId: string) => void;
  onMarkFailed: (itemId: string) => void;
  onResetToEncoded: (itemId: string) => void;
  onToggleItemSelection: (itemId: string, shiftKey: boolean) => void;
};

const IngressQueueCard: React.FC<Props> = ({
  working,
  selectedQueueItemIds,
  selectableVisibleItems,
  selectedVisibleCount,
  selectedAcceptCount,
  selectedRejectCount,
  selectedRetryCount,
  visibleQueueItems,
  filteredQueueItemsCount,
  queuePage,
  queueRowsPerPage,
  setQueuePage,
  setQueueRowsPerPage,
  onToggleSelectAllVisible,
  onBulkAccept,
  onBulkReject,
  onBulkRetry,
  onOpenAssignDialog,
  onReclassify,
  onRetry,
  onMarkDone,
  onMarkFailed,
  onResetToEncoded,
  onToggleItemSelection,
}) => (
  <Card>
    <CardContent>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2, flexWrap: 'wrap', mb: 2 }}>
        <Typography variant="h6">Queue Items</Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
          <Typography variant="caption" color="text.secondary">
            {selectedQueueItemIds.length > 0
              ? `${selectedQueueItemIds.length} selected`
              : `${selectableVisibleItems.length} selectable`}
          </Typography>
          <Button
            size="small"
            variant="contained"
            onClick={onBulkAccept}
            disabled={working || selectedAcceptCount === 0}
          >
            Accept Selected
          </Button>
          <Button
            size="small"
            variant="text"
            onClick={() => onReclassify(selectedQueueItemIds, 'auto')}
            disabled={working || selectedQueueItemIds.length === 0}
          >
            Auto
          </Button>
          <Button
            size="small"
            variant="text"
            onClick={() => onReclassify(selectedQueueItemIds, 'main_feature')}
            disabled={working || selectedQueueItemIds.length === 0}
          >
            Set Main
          </Button>
          <Button
            size="small"
            variant="text"
            color="warning"
            onClick={() => onReclassify(selectedQueueItemIds, 'special_feature')}
            disabled={working || selectedQueueItemIds.length === 0}
          >
            Set Special
          </Button>
          <Button
            size="small"
            variant="text"
            onClick={() => onReclassify(selectedQueueItemIds, 'alternate_version')}
            disabled={working || selectedQueueItemIds.length === 0}
          >
            Set Version
          </Button>
          <Button
            size="small"
            variant="outlined"
            color="error"
            onClick={onBulkReject}
            disabled={working || selectedRejectCount === 0}
          >
            Reject Selected
          </Button>
          <Button
            size="small"
            variant="outlined"
            onClick={onBulkRetry}
            disabled={working || selectedRetryCount === 0}
          >
            Retry Selected
          </Button>
          <Button
            size="small"
            variant="outlined"
            onClick={() => onOpenAssignDialog(selectedQueueItemIds)}
            disabled={working || selectedQueueItemIds.length === 0}
          >
            Assign Selected
          </Button>
        </Box>
      </Box>
      <TableContainer component={Paper} variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell padding="checkbox">
                <Checkbox
                  indeterminate={selectedVisibleCount > 0 && selectedVisibleCount < selectableVisibleItems.length}
                  checked={selectableVisibleItems.length > 0 && selectedVisibleCount === selectableVisibleItems.length}
                  disabled={selectableVisibleItems.length === 0}
                  onChange={onToggleSelectAllVisible}
                  inputProps={{ 'aria-label': 'Select all queue items' }}
                />
              </TableCell>
              <TableCell>File</TableCell>
              <TableCell>Duration</TableCell>
              <TableCell>Status</TableCell>
              <TableCell>Classification</TableCell>
              <TableCell>Match / Proposed Path</TableCell>
              <TableCell>Conf.</TableCell>
              <TableCell>Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {visibleQueueItems.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} sx={{ color: 'text.secondary' }}>
                  No active queue items.
                </TableCell>
              </TableRow>
            ) : (
              visibleQueueItems.map((item) => (
                <IngressQueueTableRow
                  key={item.id}
                  item={item}
                  selected={selectedQueueItemIds.includes(item.id)}
                  working={working}
                  onToggleSelection={onToggleItemSelection}
                  onRetry={onRetry}
                  onAssign={onOpenAssignDialog}
                  onMarkDone={onMarkDone}
                  onResetToEncoded={onResetToEncoded}
                  onMarkFailed={onMarkFailed}
                  onReclassify={onReclassify}
                />
              ))
            )}
          </TableBody>
        </Table>
      </TableContainer>
      <TablePagination
        component="div"
        count={filteredQueueItemsCount}
        page={queuePage}
        onPageChange={(_, newPage) => setQueuePage(newPage)}
        rowsPerPage={queueRowsPerPage}
        onRowsPerPageChange={(event) => {
          setQueueRowsPerPage(parseInt(event.target.value, 10));
          setQueuePage(0);
        }}
        rowsPerPageOptions={QUEUE_ROWS_PER_PAGE_OPTIONS}
      />
    </CardContent>
  </Card>
);

export default IngressQueueCard;
