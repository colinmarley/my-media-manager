import AlbumIcon from '@mui/icons-material/Album';
import VideocamIcon from '@mui/icons-material/Videocam';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  ListSubheader,
  Radio,
  TextField,
  Typography,
} from '@mui/material';
import React, { useEffect, useRef, useState } from 'react';

import FileTechChips from '@/components/ui/FileTechChips';
import { searchDiscs } from '@/service/catalog/DiscCatalogService';
import { searchTapes } from '@/service/catalog/TapeCatalogService';
import { MediaFile, SourceKind } from '@/types/library/MediaFile.type';
import { formatBytes } from '@/utils/format';

export interface SourceOption {
  kind: SourceKind;
  id: string;
  title: string;
  format?: string | null;
}

interface Props {
  open: boolean;
  onClose: () => void;
  /**
   * Without `target`: the files being linked (the user picks the disc / tape).
   * With `target`: the candidates (the user picks which files to link to it).
   */
  files: MediaFile[];
  target?: SourceOption | null;
  /** This title's own discs and tapes, offered first. */
  sources: SourceOption[];
  onLink: (fileIds: string[], target: SourceOption) => Promise<unknown>;
}

const key = (s: SourceOption) => `${s.kind}:${s.id}`;

const SourceIcon = ({ kind }: { kind: SourceKind }) => (kind === 'disc' ? <AlbumIcon fontSize="small" /> : <VideocamIcon fontSize="small" />);

/**
 * Links files to a disc or tape — by selection, since the app has no drag-and-drop. Two
 * directions: pick a disc / tape for the given files, or (with `target`) pick which of the
 * given files go on that disc / tape.
 */
const LinkFileToDiscDialog = ({ open, onClose, files, target, sources, onLink }: Props) => {
  const pickFiles = Boolean(target);
  const [chosenSource, setChosenSource] = useState<SourceOption | null>(null);
  const [chosenFiles, setChosenFiles] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SourceOption[]>([]);
  const [searching, setSearching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!open) return;
    setChosenSource(sources.length === 1 && !pickFiles ? sources[0] : null);
    setChosenFiles(new Set());
    setQuery('');
    setResults([]);
    setError(null);
    // Reset only when the dialog opens, not when the parent re-renders the same lists.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const runSearch = async (q: string) => {
    if (!q.trim()) {
      setResults([]);
      return;
    }
    setSearching(true);
    try {
      const [discs, tapes] = await Promise.all([searchDiscs({ title: q }), searchTapes({ title: q })]);
      const known = new Set(sources.map(key));
      setResults([
        ...discs.map((d) => ({ kind: 'disc' as const, id: d.id, title: d.title || d.id, format: d.format ?? null })),
        ...tapes.map((t) => ({ kind: 'tape' as const, id: t.id, title: t.title || t.id, format: t.tapeType ?? null })),
      ].filter((s) => !known.has(key(s))));
    } finally {
      setSearching(false);
    }
  };

  const onQuery = (value: string) => {
    setQuery(value);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void runSearch(value), 300);
  };

  const toggleFile = (id: string) =>
    setChosenFiles((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const linkTarget = pickFiles ? target! : chosenSource;
  const fileIds = pickFiles ? files.filter((f) => chosenFiles.has(f.id)).map((f) => f.id) : files.map((f) => f.id);
  const canSubmit = Boolean(linkTarget) && fileIds.length > 0 && !saving;

  const submit = async () => {
    if (!linkTarget) return;
    setSaving(true);
    setError(null);
    try {
      await onLink(fileIds, linkTarget);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Linking failed.');
    } finally {
      setSaving(false);
    }
  };

  const sourceItem = (s: SourceOption) => (
    <ListItemButton key={key(s)} selected={chosenSource ? key(chosenSource) === key(s) : false} onClick={() => setChosenSource(s)}>
      <ListItemIcon sx={{ minWidth: 36 }}>
        <Radio size="small" edge="start" checked={chosenSource ? key(chosenSource) === key(s) : false} tabIndex={-1} slotProps={{ input: { 'aria-label': s.title } }} />
      </ListItemIcon>
      <ListItemIcon sx={{ minWidth: 28 }}><SourceIcon kind={s.kind} /></ListItemIcon>
      <ListItemText primary={s.title} secondary={[s.kind === 'disc' ? 'Disc' : 'Tape', s.format].filter(Boolean).join(' · ')} />
    </ListItemButton>
  );

  return (
    <Dialog open={open} onClose={saving ? undefined : onClose} maxWidth="sm" fullWidth aria-labelledby="link-files-title">
      <DialogTitle id="link-files-title">
        {pickFiles ? `Link files to "${target!.title}"` : `Link ${files.length === 1 ? files[0].fileName : `${files.length} files`} to a disc or tape`}
      </DialogTitle>
      <DialogContent dividers>
        {error && <Alert severity="error" sx={{ mb: 1.5 }}>{error}</Alert>}

        {pickFiles ? (
          files.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              Every file of this title is already linked to a disc or tape.
            </Typography>
          ) : (
            <List dense aria-label="Files without a source">
              {files.map((file) => (
                <ListItemButton key={file.id} onClick={() => toggleFile(file.id)} selected={chosenFiles.has(file.id)}>
                  <ListItemIcon sx={{ minWidth: 36 }}>
                    <Checkbox size="small" edge="start" checked={chosenFiles.has(file.id)} tabIndex={-1} slotProps={{ input: { 'aria-label': file.fileName } }} />
                  </ListItemIcon>
                  <ListItemText
                    primary={file.fileName}
                    secondary={
                      <Box component="span" sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap', mt: 0.25 }}>
                        <span>{formatBytes(file.fileSize, { precision: 'video' })}</span>
                        <FileTechChips {...file} />
                      </Box>
                    }
                    slotProps={{ secondary: { component: 'div' } }}
                  />
                </ListItemButton>
              ))}
            </List>
          )
        ) : (
          <>
            {sources.length > 0 && (
              <List dense subheader={<ListSubheader disableSticky>This title&apos;s discs and tapes</ListSubheader>}>
                {sources.map(sourceItem)}
              </List>
            )}
            <TextField
              label="Search all discs and tapes"
              value={query}
              onChange={(e) => onQuery(e.target.value)}
              fullWidth
              size="small"
              sx={{ mt: 1 }}
              slotProps={{ input: { endAdornment: searching ? <CircularProgress size={16} /> : undefined } }}
            />
            {results.length > 0 && <List dense aria-label="Search results">{results.map(sourceItem)}</List>}
            {!searching && query.trim() && results.length === 0 && (
              <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                No other discs or tapes match &ldquo;{query}&rdquo;.
              </Typography>
            )}
          </>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>Cancel</Button>
        <Button variant="contained" onClick={submit} disabled={!canSubmit}>
          {saving ? 'Linking…' : fileIds.length === 0 ? 'Link files' : `Link ${fileIds.length} file${fileIds.length === 1 ? '' : 's'}`}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default LinkFileToDiscDialog;
