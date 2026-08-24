'use client';

import {
  Alert,
  Box,
  Button,
  Card,
  CardActionArea,
  CardContent,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControl,
  FormControlLabel,
  FormLabel,
  InputAdornment,
  Radio,
  RadioGroup,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import SearchIcon from '@mui/icons-material/Search';
import MovieIcon from '@mui/icons-material/Movie';
import TvIcon from '@mui/icons-material/Tv';
import { useCallback, useState } from 'react';
import { api } from '@/service/api/apiClient';
import MediaAssignmentSearchService, {
  SearchResult,
} from '@/service/library/MediaAssignmentSearchService';

const searchService = MediaAssignmentSearchService;

interface SelectedDisc {
  id: string;
  title: string;
  fileNames: string[];
}

interface Props {
  open: boolean;
  fromMediaId: string;
  fromMediaTitle: string;
  selectedDiscs: SelectedDisc[];
  onClose: () => void;
  onReassigned: (toMediaId: string, toMediaTitle: string) => void;
}

export default function ReassignFilesDialog({
  open,
  fromMediaId,
  fromMediaTitle,
  selectedDiscs,
  onClose,
  onReassigned,
}: Props) {
  const [searchText, setSearchText] = useState('');
  const [mediaTypeFilter, setMediaTypeFilter] = useState<'movie' | 'series'>('movie');
  const [classification, setClassification] = useState<'main_feature' | 'special_feature' | 'alternate_version'>('main_feature');
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [selectedTarget, setSelectedTarget] = useState<SearchResult | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);

  const handleSearch = useCallback(async () => {
    if (!searchText.trim()) return;
    setSearchLoading(true);
    setSearchError(null);
    setSelectedTarget(null);
    try {
      const results = await searchService.combinedSearch(searchText.trim(), mediaTypeFilter);
      setSearchResults(results);
      if (results.length === 0) setSearchError('No results found.');
    } catch {
      setSearchError('Search failed. Please try again.');
    } finally {
      setSearchLoading(false);
    }
  }, [searchText, mediaTypeFilter]);

  const handleConfirm = async () => {
    if (!selectedTarget) return;
    setSaving(true);
    setError(null);

    let targetId: string | null = null;

    try {
      const resolvedTarget = await searchService.ensureCatalogEntry(selectedTarget, mediaTypeFilter);
      targetId = resolvedTarget.id;

      if (!targetId) throw new Error('Could not resolve a catalog ID for the selected title.');

      if (!targetId) throw new Error('Could not resolve a catalog ID for the selected title.');

      await api.post('/api/catalog/reassign-discs', {
        discIds: selectedDiscs.map((d) => d.id),
        fromMediaId,
        toMediaId: targetId,
        toMediaType: mediaTypeFilter,
        classification,
      });

      onReassigned(targetId, selectedTarget.title);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Reassignment failed.');
    } finally {
      setSaving(false);
    }
  };

  const handleClose = () => {
    if (saving) return;
    setSearchText('');
    setSearchResults([]);
    setSelectedTarget(null);
    setClassification('main_feature');
    setError(null);
    setSearchError(null);
    onClose();
  };

  const totalFiles = selectedDiscs.reduce((n, d) => n + d.fileNames.length, 0);

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ pb: 0.5 }}>
        <Stack direction="row" spacing={1.5} alignItems="center">
          <WarningAmberIcon color="warning" />
          <Box>
            <Typography variant="h6">Reassign Files to Another Title</Typography>
            <Typography variant="body2" color="text.secondary">
              {selectedDiscs.length} disc record{selectedDiscs.length !== 1 ? 's' : ''} •{' '}
              {totalFiles} file{totalFiles !== 1 ? 's' : ''}
            </Typography>
          </Box>
        </Stack>
      </DialogTitle>

      <DialogContent dividers>
        {/* Warning */}
        <Alert severity="warning" sx={{ mb: 2 }}>
          <Typography variant="body2" fontWeight={600}>
            All association data for the selected file records will be overwritten.
          </Typography>
          <Typography variant="body2" sx={{ mt: 0.5 }}>
            The selected files will be removed from <strong>{fromMediaTitle}</strong> and linked
            to the title you choose below. This action cannot be undone automatically.
          </Typography>
        </Alert>

        {/* Selected files summary */}
        <Box
          sx={{
            p: 1.5,
            mb: 2,
            borderRadius: 1,
            border: '1px solid',
            borderColor: 'divider',
            bgcolor: 'rgba(2,6,9,0.45)',
            maxHeight: 120,
            overflowY: 'auto',
          }}
        >
          {selectedDiscs.map((disc) => (
            <Box key={disc.id} sx={{ mb: 0.5 }}>
              <Typography variant="caption" fontWeight={700} color="text.secondary">
                {disc.title || disc.id}
              </Typography>
              {disc.fileNames.map((fn) => (
                <Typography key={fn} variant="caption" display="block" sx={{ pl: 1.5, opacity: 0.75 }}>
                  {fn}
                </Typography>
              ))}
            </Box>
          ))}
        </Box>

        <Divider sx={{ mb: 2 }} />

        {/* Classification */}
        <FormControl sx={{ mb: 2 }}>
          <FormLabel sx={{ mb: 0.5, fontSize: '0.8rem' }}>
            <Stack direction="row" spacing={0.5} alignItems="center">
              <span>File Classification</span>
              <Tooltip title="How these files should be treated in the target title's folder. Main Feature: primary content file. Special Feature: bonus/extra content. Alternate Version: a different cut or encode of the same content." placement="right" arrow>
                <InfoOutlinedIcon sx={{ fontSize: 14, opacity: 0.6, cursor: 'help' }} />
              </Tooltip>
            </Stack>
          </FormLabel>
          <RadioGroup
            row
            value={classification}
            onChange={(e) => setClassification(e.target.value as typeof classification)}
          >
            <FormControlLabel value="main_feature" control={<Radio size="small" />} label="Main Feature" />
            <FormControlLabel value="special_feature" control={<Radio size="small" />} label="Special Feature" />
            <FormControlLabel value="alternate_version" control={<Radio size="small" />} label="Alternate Version" />
          </RadioGroup>
        </FormControl>

        {/* Media type toggle */}
        <Stack direction="row" spacing={1} sx={{ mb: 1.5 }}>
          <Button
            size="small"
            variant={mediaTypeFilter === 'movie' ? 'contained' : 'outlined'}
            startIcon={<MovieIcon />}
            onClick={() => { setMediaTypeFilter('movie'); setSearchResults([]); setSelectedTarget(null); }}
          >
            Movie
          </Button>
          <Button
            size="small"
            variant={mediaTypeFilter === 'series' ? 'contained' : 'outlined'}
            startIcon={<TvIcon />}
            onClick={() => { setMediaTypeFilter('series'); setSearchResults([]); setSelectedTarget(null); }}
          >
            TV Show
          </Button>
        </Stack>

        {/* Search */}
        <Stack direction="row" spacing={1} sx={{ mb: 1.5 }}>
          <TextField
            fullWidth
            size="small"
            placeholder={`Search for a ${mediaTypeFilter === 'movie' ? 'movie' : 'TV show'}…`}
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleSearch(); }}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon fontSize="small" />
                </InputAdornment>
              ),
            }}
          />
          <Button
            variant="contained"
            onClick={handleSearch}
            disabled={searchLoading || !searchText.trim()}
            sx={{ minWidth: 90 }}
          >
            {searchLoading ? <CircularProgress size={18} color="inherit" /> : 'Search'}
          </Button>
        </Stack>

        {searchError && (
          <Alert severity="info" sx={{ mb: 1.5 }}>
            {searchError}
          </Alert>
        )}

        {/* Results */}
        {searchResults.length > 0 && (
          <Box sx={{ maxHeight: 280, overflowY: 'auto' }}>
            <Stack spacing={0.75}>
              {searchResults.map((result) => {
                const isSelected = selectedTarget?.id === result.id;
                return (
                  <Card
                    key={`${result.source}-${result.id}`}
                    variant="outlined"
                    sx={{
                      borderColor: isSelected ? 'primary.main' : 'divider',
                      bgcolor: isSelected ? 'rgba(25,118,210,0.12)' : 'transparent',
                      transition: 'all 0.15s',
                    }}
                  >
                    <CardActionArea onClick={() => setSelectedTarget(result)}>
                      <CardContent sx={{ py: 1, px: 1.5, '&:last-child': { pb: 1 } }}>
                        <Stack direction="row" spacing={1} alignItems="center">
                          <Radio
                            checked={isSelected}
                            size="small"
                            disableRipple
                            sx={{ p: 0 }}
                          />
                          <Box sx={{ flex: 1, minWidth: 0 }}>
                            <Typography variant="body2" fontWeight={600} noWrap>
                              {result.title}
                            </Typography>
                            <Stack direction="row" spacing={1}>
                              <Typography variant="caption" color="text.secondary">
                                {result.year || 'N/A'}
                              </Typography>
                              <Typography
                                variant="caption"
                                sx={{
                                  px: 0.75,
                                  borderRadius: 0.5,
                                  bgcolor: result.source === 'catalog' ? 'success.dark' : 'info.dark',
                                  color: 'white',
                                  lineHeight: 1.6,
                                }}
                              >
                                {result.source === 'catalog' ? 'In Catalog' : 'OMDB'}
                              </Typography>
                            </Stack>
                          </Box>
                        </Stack>
                      </CardContent>
                    </CardActionArea>
                  </Card>
                );
              })}
            </Stack>
          </Box>
        )}

        {error && (
          <Alert severity="error" sx={{ mt: 2 }}>
            {error}
          </Alert>
        )}
      </DialogContent>

      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button onClick={handleClose} disabled={saving}>
          Cancel
        </Button>
        <Button
          variant="contained"
          color="warning"
          onClick={handleConfirm}
          disabled={saving || !selectedTarget}
          startIcon={saving ? <CircularProgress size={16} color="inherit" /> : undefined}
        >
          {saving ? 'Reassigning…' : `Reassign to "${selectedTarget?.title ?? '…'}"`}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
