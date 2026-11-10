import SwapHorizIcon from '@mui/icons-material/SwapHoriz';
import {
  Alert,
  Button,
  Checkbox,
  ListItem,
  ListItemIcon,
  ListItemText,
  List,
  Paper,
  Stack,
  Typography,
} from '@mui/material';
import React from 'react';

import { CatalogDisc } from '@/types/catalog/Disc.type';
import { CatalogTape } from '@/types/catalog/Tape.type';
import { FolderFileEntry, SeasonFolderEntry } from '@/service/library/mediaFolderFiles';
import MediaFolderFileList from './MediaFolderFileList';
import styles from './mediaDetailStyles';

interface FolderSectionProps {
  loading: boolean;
  files: FolderFileEntry[];
  isSeries: boolean;
  seasonFolders: SeasonFolderEntry[];
  selectedSeasonPath: string;
  onSeasonChange: (path: string) => void;
  onReassignFolder: () => void;
  onReassignFile: (path: string, name: string) => void;
  onAssignEpisode: (file: { path: string; name: string }) => void;
}

interface Props {
  folderPath: string | null;
  selectedDiscCount: number;
  onOpenReassign: () => void;
  reassignSuccessMsg: string | null;
  onCloseReassignSuccessMsg: () => void;
  diskReassignMsg: string | null;
  onCloseDiskReassignMsg: () => void;
  associatedDiscs: CatalogDisc[];
  associatedTapes: CatalogTape[];
  mediaLinksLoading: boolean;
  selectedDiscIds: Set<string>;
  onToggleDisc: (discId: string) => void;
  folderSection: FolderSectionProps;
}

const storageSummary = (
  record: { videoFiles?: { fileName: string }[]; storageType?: string | null; storageId?: string | null },
  kind: 'disc' | 'tape',
) => (
  (Array.isArray(record.videoFiles) && record.videoFiles.length > 0
    ? record.videoFiles.map((file) => file.fileName).join(', ')
    : `No video file names were stored on this ${kind} record.`)
  + (record.storageType && record.storageId ? ` · ${record.storageType} ${record.storageId}` : ' · No storage location set')
);

/**
 * Everything the page knows about the records attached to a title: destination files on disk,
 * linked disc records (selectable for reassignment) and linked tape records.
 */
const MediaAssociatedFilesCard = ({
  folderPath,
  selectedDiscCount,
  onOpenReassign,
  reassignSuccessMsg,
  onCloseReassignSuccessMsg,
  diskReassignMsg,
  onCloseDiskReassignMsg,
  associatedDiscs,
  associatedTapes,
  mediaLinksLoading,
  selectedDiscIds,
  onToggleDisc,
  folderSection,
}: Props) => (
  <Paper sx={styles.sectionCard}>
    <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
      <Typography variant="h6" sx={styles.sectionTitle}>
        Associated Discs and Files
      </Typography>
      {selectedDiscCount > 0 && (
        <Button
          variant="contained"
          color="warning"
          size="small"
          startIcon={<SwapHorizIcon />}
          onClick={onOpenReassign}
        >
          Reassign {selectedDiscCount} selected
        </Button>
      )}
    </Stack>

    {reassignSuccessMsg && (
      <Alert severity="success" sx={{ mb: 1.5 }} onClose={onCloseReassignSuccessMsg}>
        {reassignSuccessMsg}
      </Alert>
    )}

    {diskReassignMsg && (
      <Alert severity="success" sx={{ mb: 1.5 }} onClose={onCloseDiskReassignMsg}>
        {diskReassignMsg}
      </Alert>
    )}

    {associatedDiscs.length === 0 && associatedTapes.length === 0 && !mediaLinksLoading
      && !folderSection.loading && folderSection.files.length === 0 && (
      <Alert severity="info">No associated disc or file records were found.</Alert>
    )}

    {folderSection.loading && (
      <Typography variant="body2" sx={{ opacity: 0.7, py: 1 }}>Loading files from folder…</Typography>
    )}

    {!folderSection.loading && folderSection.files.length > 0 && (
      <MediaFolderFileList
        files={folderSection.files}
        isSeries={folderSection.isSeries}
        seasonFolders={folderSection.seasonFolders}
        selectedSeasonPath={folderSection.selectedSeasonPath}
        onSeasonChange={folderSection.onSeasonChange}
        folderPath={folderPath}
        onReassignFolder={folderSection.onReassignFolder}
        onReassignFile={folderSection.onReassignFile}
        onAssignEpisode={folderSection.onAssignEpisode}
      />
    )}

    {!folderSection.loading && folderPath && folderSection.files.length === 0 && (
      <Alert severity="info" sx={{ mb: 1.5 }}>
        No files were found in the destination folder on disk.
      </Alert>
    )}

    {associatedDiscs.length > 0 && (
      <>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
          Select disc records to reassign them to a different catalog entry.
        </Typography>
        <List disablePadding>
          {associatedDiscs.map((disc) => (
            <ListItem
              key={disc.id}
              sx={{ ...styles.listItem, cursor: 'pointer' }}
              onClick={() => onToggleDisc(disc.id)}
            >
              <ListItemIcon sx={{ minWidth: 36 }}>
                <Checkbox
                  edge="start"
                  checked={selectedDiscIds.has(disc.id)}
                  tabIndex={-1}
                  disableRipple
                  size="small"
                />
              </ListItemIcon>
              <ListItemText
                primary={disc.title || disc.id}
                secondary={storageSummary(disc, 'disc')}
              />
            </ListItem>
          ))}
        </List>
      </>
    )}

    {associatedTapes.length > 0 && (
      <>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: associatedDiscs.length > 0 ? 2 : 0, mb: 0.5 }}>
          Associated tapes.
        </Typography>
        <List disablePadding>
          {associatedTapes.map((tape) => (
            <ListItem key={tape.id} sx={styles.listItem}>
              <ListItemText
                primary={tape.title || tape.id}
                secondary={storageSummary(tape, 'tape')}
              />
            </ListItem>
          ))}
        </List>
      </>
    )}
  </Paper>
);

export default MediaAssociatedFilesCard;
