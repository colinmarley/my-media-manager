import InsertDriveFileIcon from '@mui/icons-material/InsertDriveFile';
import SwapHorizIcon from '@mui/icons-material/SwapHoriz';
import {
  Alert,
  Box,
  Button,
  FormControl,
  InputLabel,
  ListItem,
  ListItemIcon,
  ListItemText,
  List,
  MenuItem,
  Select,
  Stack,
  Typography,
} from '@mui/material';
import React from 'react';

import { FolderFileEntry, formatFileSize, isVideoFileName, SeasonFolderEntry } from '@/service/library/mediaFolderFiles';
import styles from './mediaDetailStyles';

interface Props {
  files: FolderFileEntry[];
  isSeries: boolean;
  seasonFolders: SeasonFolderEntry[];
  selectedSeasonPath: string;
  onSeasonChange: (path: string) => void;
  folderPath: string | null;
  onReassignFolder: () => void;
  onReassignFile: (path: string, name: string) => void;
  onAssignEpisode: (file: { path: string; name: string }) => void;
}

/**
 * The destination folder listing: season picker, whole-folder reassign entry point and the
 * per-file reassign / assign-episode actions.
 */
const MediaFolderFileList = ({
  files,
  isSeries,
  seasonFolders,
  selectedSeasonPath,
  onSeasonChange,
  folderPath,
  onReassignFolder,
  onReassignFile,
  onAssignEpisode,
}: Props) => (
  <>
    <Alert severity="info" sx={{ mb: 1.5 }}>
      Destination files on disk. You can manually reassign the entire folder or individual files.
    </Alert>

    {isSeries && seasonFolders.length > 0 && (
      <Box sx={{ mb: 1.5, display: 'flex', alignItems: 'center', gap: 1.5 }}>
        <FormControl size="small" sx={{ minWidth: 220 }}>
          <InputLabel id="season-select-label">Season</InputLabel>
          <Select
            labelId="season-select-label"
            label="Season"
            value={selectedSeasonPath}
            onChange={(e) => onSeasonChange(e.target.value)}
          >
            {seasonFolders.map((season) => (
              <MenuItem key={season.path} value={season.path}>{season.name}</MenuItem>
            ))}
          </Select>
        </FormControl>
        <Typography variant="caption" color="text.secondary">
          Showing files for the selected season folder.
        </Typography>
      </Box>
    )}

    {/* Folder-level reassign */}
    {folderPath && (
      <Box sx={{ mb: 1.5 }}>
        <Button
          variant="outlined"
          color="warning"
          size="small"
          startIcon={<SwapHorizIcon />}
          onClick={onReassignFolder}
        >
          Reassign Entire Folder
        </Button>
        <Typography variant="caption" color="text.secondary" sx={{ ml: 1.5 }}>
          Renames the folder, files, and rewrites the NFO
        </Typography>
      </Box>
    )}

    <List disablePadding>
      {files.map((file) => (
        <ListItem
          key={file.path}
          sx={{ ...styles.listItem }}
          secondaryAction={
            <Stack direction="row" spacing={1}>
              {isSeries && isVideoFileName(file.name) && (
                <Button
                  size="small"
                  variant="text"
                  color="primary"
                  onClick={() => onAssignEpisode({ path: file.path, name: file.name })}
                >
                  Assign Episode
                </Button>
              )}
              <Button
                size="small"
                variant="text"
                color="warning"
                startIcon={<SwapHorizIcon />}
                onClick={() => onReassignFile(file.path, file.name)}
              >
                Reassign
              </Button>
            </Stack>
          }
        >
          <ListItemIcon sx={{ minWidth: 36 }}>
            <InsertDriveFileIcon fontSize="small" sx={{ opacity: 0.7 }} />
          </ListItemIcon>
          <ListItemText
            primary={file.name}
            secondary={file.size > 0 ? formatFileSize(file.size) : undefined}
            sx={{ pr: 10 }}
          />
        </ListItem>
      ))}
    </List>
  </>
);

export default MediaFolderFileList;
