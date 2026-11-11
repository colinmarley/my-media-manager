import AddLinkIcon from '@mui/icons-material/AddLink';
import AlbumIcon from '@mui/icons-material/Album';
import LinkOffIcon from '@mui/icons-material/LinkOff';
import SwapHorizIcon from '@mui/icons-material/SwapHoriz';
import VideocamIcon from '@mui/icons-material/Videocam';
import {
  Box,
  Button,
  IconButton,
  Link as MuiLink,
  List,
  ListItem,
  ListItemText,
  Paper,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import Link from 'next/link';
import React from 'react';

import FileTechChips from '@/components/ui/FileTechChips';
import StatusChip from '@/components/ui/StatusChip';
import { isMissing, qualityLabel, roleLabel, TitleSource } from '@/service/library/mediaFileModel';
import { formatStorageLocation } from '@/utils/storageLocation';
import { formatBytes } from '@/utils/format';
import { MediaFile } from '@/types/library/MediaFile.type';

interface Props {
  source: TitleSource;
  onLinkFiles: (source: TitleSource) => void;
  onUnlink: (file: MediaFile) => void;
  /** Discs only: move the disc record to another title (ReassignFilesDialog). */
  onReassign?: (source: TitleSource) => void;
  busy: boolean;
}

const str = (record: Record<string, unknown> | null, key: string): string | null => {
  const value = record?.[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
};

/** Ripped when files are linked to it (anywhere, not only this title's). */
export function ripState(source: TitleSource): { label: string; tone: 'success' | 'neutral' } {
  const linked = typeof source.record?.linkedFileCount === 'number' ? (source.record.linkedFileCount as number) : source.files.length;
  const verb = source.kind === 'disc' ? 'Ripped' : 'Digitized';
  return linked > 0
    ? { label: `${verb} · ${linked} file${linked === 1 ? '' : 's'}`, tone: 'success' }
    : { label: `Not ${verb.toLowerCase()}`, tone: 'neutral' };
}

/** One disc or tape of the title: what it is, where it is kept, and this title's files on it. */
const SourceCard = ({ source, onLinkFiles, onUnlink, onReassign, busy }: Props) => {
  const location = source.record ? formatStorageLocation(source.record as Parameters<typeof formatStorageLocation>[0]) : '';
  const edition = str(source.record, 'edition') ?? str(source.record, 'releaseEdition');
  const rip = ripState(source);
  const headingId = `source-${source.kind}-${source.id}`;
  const facts = [
    source.kind === 'disc' ? 'Disc' : 'Tape',
    source.format,
    edition,
    location ? `Kept in ${location}` : 'No storage location',
  ].filter(Boolean);

  return (
    <Paper variant="outlined" component="article" aria-labelledby={headingId} sx={{ p: 2 }}>
      <Stack direction="row" spacing={1.5} alignItems="flex-start">
        <Box sx={{ color: 'text.secondary', pt: 0.25 }} aria-hidden>
          {source.kind === 'disc' ? <AlbumIcon /> : <VideocamIcon />}
        </Box>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography id={headingId} variant="h6" component="h3">
            <MuiLink component={Link} href={source.href} underline="hover" color="inherit">
              {source.title}
            </MuiLink>
          </Typography>
          <Typography variant="body2" color="text.secondary">{facts.join(' · ')}</Typography>
          <Stack direction="row" spacing={1} sx={{ mt: 1 }} useFlexGap flexWrap="wrap">
            <StatusChip status={rip.tone} tone={rip.tone} label={rip.label} />
            {!source.record && <StatusChip status="warning" label="A file points here, but the title is not linked" />}
          </Stack>
        </Box>
        <Stack spacing={0.5} alignItems="flex-end">
          <Button size="small" startIcon={<AddLinkIcon />} onClick={() => onLinkFiles(source)} disabled={busy}>
            Link files…
          </Button>
          {onReassign && source.kind === 'disc' && source.record && (
            <Button size="small" startIcon={<SwapHorizIcon />} onClick={() => onReassign(source)} disabled={busy}>
              Move to another title…
            </Button>
          )}
        </Stack>
      </Stack>

      {source.files.length === 0 ? (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5 }}>
          None of this title&apos;s files are linked to this {source.kind} yet.
        </Typography>
      ) : (
        <List dense disablePadding sx={{ mt: 1 }} aria-label={`Files on ${source.title}`}>
          {source.files.map((file) => (
            <ListItem
              key={file.id}
              divider
              sx={{ px: 0, opacity: isMissing(file) ? 0.55 : 1 }}
              secondaryAction={
                <Tooltip title={`Unlink from this ${source.kind}`}>
                  <span>
                    <IconButton
                      edge="end"
                      size="small"
                      onClick={() => onUnlink(file)}
                      disabled={busy}
                      aria-label={`Unlink ${file.fileName} from ${source.title}`}
                    >
                      <LinkOffIcon fontSize="small" />
                    </IconButton>
                  </span>
                </Tooltip>
              }
            >
              <ListItemText
                primary={file.fileName}
                secondary={
                  <Box component="span" sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap', mt: 0.25 }}>
                    <span>{roleLabel(file)}</span>
                    <span>{formatBytes(file.fileSize, { precision: 'video' })}</span>
                    {!qualityLabel(file) && !file.videoCodec ? <span>Not probed</span> : <FileTechChips {...file} />}
                    {isMissing(file) && <StatusChip status="error" label="Missing" />}
                  </Box>
                }
                slotProps={{ secondary: { component: 'div' } }}
              />
            </ListItem>
          ))}
        </List>
      )}
    </Paper>
  );
};

export default SourceCard;
