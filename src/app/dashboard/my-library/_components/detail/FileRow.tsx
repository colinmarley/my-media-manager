import AlbumIcon from '@mui/icons-material/Album';
import VideocamIcon from '@mui/icons-material/Videocam';
import { Box, Button, Checkbox, Chip, Stack, TableCell, TableRow, Tooltip, Typography } from '@mui/material';
import Link from 'next/link';
import React from 'react';

import StatusChip from '@/components/ui/StatusChip';
import {
  audioLabel,
  displayRelativePath,
  fileSource,
  fileStatusBadges,
  isMissing,
  qualityLabel,
  roleLabel,
  typeLabel,
  videoCodecLabel,
} from '@/service/library/mediaFileModel';
import { fontFamilies } from '@/theme/tokens';
import { MediaFile } from '@/types/library/MediaFile.type';
import { formatBytes, formatDuration } from '@/utils/format';
import { FileActionHandlers } from './fileActionTypes';
import FileRowMenu from './FileRowMenu';

/** The Source chip's cap, so the Files table fits at 1280px wide. */
export const SOURCE_CHIP_MAX_WIDTH = 168;

export const FILE_COLUMNS = ['File', 'Role', 'Quality', 'Video', 'Audio', 'Type', 'Size', 'Duration', 'Source', 'Status'] as const;

const Dash = () => <Box component="span" sx={{ color: 'text.disabled' }} aria-label="Unknown">—</Box>;

const mono = { fontFamily: fontFamilies.mono, fontSize: '0.75rem', whiteSpace: 'nowrap' } as const;

const Value = ({ value }: { value: string | null }) => (value ? <Box component="span" sx={mono}>{value}</Box> : <Dash />);

/** The source chip linking to the disc / tape page, or the "Link…" affordance. */
export const SourceCell = ({ file, onLink }: { file: MediaFile; onLink?: (files: MediaFile[]) => void }) => {
  const source = fileSource(file);
  if (source) {
    const label = source.format ? `${source.title} · ${source.format}` : source.title;
    // A long disc name must not widen the table: cap the chip, ellipsize, full name on hover / focus.
    return (
      <Tooltip title={label} placement="top" describeChild>
        <Chip
          size="small"
          variant="outlined"
          clickable
          component={Link}
          href={source.href}
          icon={source.kind === 'disc' ? <AlbumIcon /> : <VideocamIcon />}
          label={label}
          aria-label={`Source ${source.kind}: ${source.title}`}
          data-testid="file-source-chip"
          sx={{ maxWidth: SOURCE_CHIP_MAX_WIDTH, '& .MuiChip-label': { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 } }}
        />
      </Tooltip>
    );
  }
  if (!onLink) return <Dash />;
  return (
    <Button size="small" variant="text" onClick={() => onLink([file])} aria-label={`Link ${file.fileName} to a disc or tape`}>
      Link…
    </Button>
  );
};

export const StatusCell = ({ file }: { file: MediaFile }) => {
  const badges = fileStatusBadges(file);
  if (badges.length === 0) return <StatusChip status="success" label="OK" />;
  return (
    <Stack direction="row" spacing={0.5} useFlexGap flexWrap="wrap">
      {badges.map((badge) => {
        const chip = <StatusChip key={badge.key} status={badge.key} tone={badge.tone} label={badge.label} tabIndex={badge.detail ? 0 : undefined} />;
        return badge.detail ? (
          <Tooltip key={badge.key} title={badge.detail}>
            {chip}
          </Tooltip>
        ) : chip;
      })}
    </Stack>
  );
};

interface Props {
  file: MediaFile;
  selected: boolean;
  onToggle: (fileId: string) => void;
  actions: FileActionHandlers;
}

/** One inventory file: name + relative path, role or SxxEyy, the technical facts, source and status. */
const FileRow = ({ file, selected, onToggle, actions }: Props) => {
  const relative = displayRelativePath(file);
  const missing = isMissing(file);

  return (
    <TableRow
      hover
      selected={selected}
      data-missing={missing || undefined}
      sx={missing ? { opacity: 0.55, '& td': { textDecorationColor: 'currentColor' } } : undefined}
    >
      <TableCell padding="checkbox">
        <Checkbox
          size="small"
          checked={selected}
          onChange={() => onToggle(file.id)}
          slotProps={{ input: { 'aria-label': `Select ${file.fileName}` } }}
        />
      </TableCell>
      <TableCell component="th" scope="row" sx={{ minWidth: 200, maxWidth: 340 }}>
        <Tooltip title={file.filePath || ''} placement="top-start" describeChild>
          <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>{file.fileName}</Typography>
        </Tooltip>
        {relative && relative !== file.fileName && (
          <Typography variant="caption" color="text.secondary" component="div" sx={{ ...mono, whiteSpace: 'normal', overflowWrap: 'anywhere' }}>
            {relative}
          </Typography>
        )}
      </TableCell>
      <TableCell sx={{ whiteSpace: 'nowrap' }}>{roleLabel(file)}</TableCell>
      <TableCell><Value value={qualityLabel(file)} /></TableCell>
      <TableCell><Value value={videoCodecLabel(file)} /></TableCell>
      <TableCell><Value value={audioLabel(file)} /></TableCell>
      <TableCell><Value value={typeLabel(file)} /></TableCell>
      <TableCell align="right" sx={mono}>{formatBytes(file.fileSize, { precision: 'video' })}</TableCell>
      <TableCell align="right" sx={mono}>{formatDuration(file.durationMs)}</TableCell>
      <TableCell sx={{ maxWidth: SOURCE_CHIP_MAX_WIDTH + 32 }}><SourceCell file={file} onLink={actions.onLink} /></TableCell>
      <TableCell><StatusCell file={file} /></TableCell>
      <TableCell padding="checkbox" align="right">
        <FileRowMenu file={file} actions={actions} />
      </TableCell>
    </TableRow>
  );
};

export default FileRow;
