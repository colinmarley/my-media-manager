import FolderOffIcon from '@mui/icons-material/FolderOff';
import SwapHorizIcon from '@mui/icons-material/SwapHoriz';
import { Box, Button, CircularProgress, Paper, Stack, Typography } from '@mui/material';
import React, { useEffect, useMemo, useState } from 'react';

import EmptyState from '@/components/ui/EmptyState';
import { fileSections, fileSource, isFlagged } from '@/service/library/mediaFileModel';
import { surfaces, borders } from '@/theme/tokens';
import { MediaFile, MediaFileGroups } from '@/types/library/MediaFile.type';
import { FileActionHandlers } from './fileActionTypes';
import FileSectionTable from './FileSectionTable';

interface Props {
  groups: MediaFileGroups;
  allFiles: MediaFile[];
  actions: FileActionHandlers;
  /** False on a backend without the file inventory (only the folder listing exists). */
  hasInventory: boolean;
  onScan: () => void;
  scanning: boolean;
  /** Whole-folder reassignment, when the title has a folder. */
  onReassignFolder?: () => void;
  /** The on-disk folder listing (MediaFolderFileList), shown when the inventory is empty. */
  folderFallback?: React.ReactNode;
}

/** The bar that appears over the tables while files are selected. */
const BulkBar = ({
  files,
  actions,
  onClear,
}: {
  files: MediaFile[];
  actions: FileActionHandlers;
  onClear: () => void;
}) => {
  const linked = files.filter((file) => fileSource(file));
  const allFlagged = files.every(isFlagged);
  return (
    <Paper
      role="toolbar"
      aria-label="Bulk actions for selected files"
      variant="outlined"
      sx={{ position: 'sticky', top: 8, zIndex: 2, p: 1, mb: 2, bgcolor: surfaces.raised, borderColor: borders.strong }}
    >
      <Stack direction="row" spacing={1} alignItems="center" useFlexGap flexWrap="wrap">
        <Typography variant="body2" sx={{ mx: 1 }} aria-live="polite">
          {files.length} selected
        </Typography>
        <Button size="small" variant="contained" onClick={() => actions.onLink(files)} disabled={actions.busy}>
          Link to disc/tape…
        </Button>
        <Button size="small" onClick={() => actions.onUnlink(linked)} disabled={actions.busy || linked.length === 0}>
          Unlink
        </Button>
        <Button
          size="small"
          onClick={() => actions.onSetFlag(files, !allFlagged)}
          disabled={actions.busy || actions.reviewUnavailable}
          title={actions.reviewUnavailable ? 'Not available on this server yet' : undefined}
        >
          {allFlagged ? 'Clear flag' : 'Flag for second look'}
        </Button>
        <Button
          size="small"
          onClick={() => actions.onRename(files)}
          disabled={actions.busy || actions.renameUnavailable}
          title={actions.renameUnavailable ? 'Not available on this server yet' : undefined}
        >
          Rename to canonical…
        </Button>
        {actions.busy && <CircularProgress size={16} aria-label="Working" />}
        <Box sx={{ flex: 1 }} />
        <Button size="small" onClick={onClear}>Clear selection</Button>
      </Stack>
    </Paper>
  );
};

/**
 * Every file of the title, grouped: Main feature, Versions, Extras, the seasons of a show
 * (collapsible, episodes in order), Other. Rows can be multi-selected for the bulk actions.
 */
const FilesTab = ({
  groups,
  allFiles,
  actions,
  hasInventory,
  onScan,
  scanning,
  onReassignFolder,
  folderFallback,
}: Props) => {
  const sections = useMemo(() => fileSections(groups), [groups]);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Drop selections for files that left the title after a refetch.
  useEffect(() => {
    setSelected((prev) => {
      const present = new Set(allFiles.map((file) => file.id));
      const next = new Set(Array.from(prev).filter((id) => present.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [allFiles]);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const toggleMany = (ids: string[], select: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => (select ? next.add(id) : next.delete(id)));
      return next;
    });

  const selectedFiles = allFiles.filter((file) => selected.has(file.id));

  if (allFiles.length === 0) {
    return (
      <Box>
        <Paper variant="outlined" sx={{ mb: 2 }}>
          <EmptyState
            icon={<FolderOffIcon />}
            title={hasInventory ? 'No files recorded for this title yet' : 'File inventory is not available'}
            description={
              hasInventory
                ? 'The library inventory has no files linked to this title. It may never have been scanned, or its files sit outside the library folders. Scan the library to pick them up; the folder listing below shows what is on disk right now.'
                : 'This server does not report a file inventory yet, so only the folder listing on disk is shown below.'
            }
            action={
              hasInventory ? (
                <Button
                  variant="contained"
                  onClick={onScan}
                  disabled={scanning}
                  startIcon={scanning ? <CircularProgress size={14} color="inherit" /> : undefined}
                >
                  {scanning ? 'Scanning…' : 'Scan library now'}
                </Button>
              ) : undefined
            }
          />
        </Paper>
        {folderFallback}
      </Box>
    );
  }

  return (
    <Box>
      {selectedFiles.length > 0 && (
        <BulkBar files={selectedFiles} actions={actions} onClear={() => setSelected(new Set())} />
      )}
      {onReassignFolder && (
        <Stack direction="row" justifyContent="flex-end" sx={{ mb: 1 }}>
          <Button size="small" startIcon={<SwapHorizIcon />} onClick={onReassignFolder}>
            Reassign entire folder…
          </Button>
        </Stack>
      )}
      {sections.map((section) => (
        <FileSectionTable
          key={section.key}
          section={section}
          selected={selected}
          onToggle={toggle}
          onToggleMany={toggleMany}
          actions={actions}
        />
      ))}
    </Box>
  );
};

export default FilesTab;
