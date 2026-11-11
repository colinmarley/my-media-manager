import AlbumIcon from '@mui/icons-material/Album';
import { Box, Button, Paper, Stack, Typography } from '@mui/material';
import Link from 'next/link';
import React, { useMemo, useState } from 'react';

import EmptyState from '@/components/ui/EmptyState';
import { fileSource, TitleSource } from '@/service/library/mediaFileModel';
import { MediaFile } from '@/types/library/MediaFile.type';
import FileSectionTable from './FileSectionTable';
import { FileActionHandlers } from './fileActionTypes';
import SourceCard from './SourceCard';

interface Props {
  sources: TitleSource[];
  allFiles: MediaFile[];
  actions: FileActionHandlers;
  /** Opens LinkFileToDiscDialog to pick which unlinked files go on this disc / tape. */
  onLinkFilesTo: (source: TitleSource) => void;
  onReassignDisc?: (source: TitleSource) => void;
}

/**
 * The title's discs and tapes, one card each with this title's files on it, then the files that
 * have no source disc yet (multi-select, then "Link to…").
 */
const DiscsTapesTab = ({ sources, allFiles, actions, onLinkFilesTo, onReassignDisc }: Props) => {
  const unsourced = useMemo(() => allFiles.filter((file) => !fileSource(file)), [allFiles]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const selectedFiles = unsourced.filter((file) => selected.has(file.id));

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

  return (
    <Box>
      {sources.length === 0 ? (
        <Paper variant="outlined" sx={{ mb: 3 }}>
          <EmptyState
            icon={<AlbumIcon />}
            title="No discs or tapes linked"
            description="Link this title to the disc or tape it came from on the Discs & Tapes page, or link a file below to one."
            action={<Button component={Link} href="/dashboard/physical-media" variant="outlined">Go to Discs &amp; Tapes</Button>}
          />
        </Paper>
      ) : (
        <Box sx={{ display: 'grid', gap: 2, mb: 3, gridTemplateColumns: { xs: '1fr', lg: 'repeat(2, minmax(0, 1fr))' } }}>
          {sources.map((source) => (
            <SourceCard
              key={`${source.kind}:${source.id}`}
              source={source}
              busy={actions.busy}
              onLinkFiles={onLinkFilesTo}
              onReassign={onReassignDisc}
              onUnlink={(file) => actions.onUnlink([file])}
            />
          ))}
        </Box>
      )}

      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
        <Typography variant="h5" component="h2">Files with no source disc</Typography>
        <Button
          size="small"
          variant="contained"
          disabled={selectedFiles.length === 0 || actions.busy}
          onClick={() => {
            actions.onLink(selectedFiles);
            setSelected(new Set());
          }}
        >
          Link {selectedFiles.length > 0 ? `${selectedFiles.length} ` : ''}to…
        </Button>
      </Stack>
      {unsourced.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          {allFiles.length === 0 ? 'This title has no files in the inventory yet.' : 'Every file of this title is linked to a disc or tape.'}
        </Typography>
      ) : (
        <FileSectionTable
          section={{ key: 'unsourced', title: 'Unlinked files', files: unsourced }}
          selected={selected}
          onToggle={toggle}
          onToggleMany={toggleMany}
          actions={actions}
        />
      )}
    </Box>
  );
};

export default DiscsTapesTab;
