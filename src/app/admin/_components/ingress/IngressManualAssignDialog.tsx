'use client';

import React from 'react';
import {
  Autocomplete,
  Box,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormControlLabel,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import type { IngressQueueItem } from '@/service/ingress/IngressAutomationService';
import type { SearchResult } from '@/service/library/MediaAssignmentSearchService';
import {
  EpisodeAssignmentMapping,
  withEpisode,
  withSeason,
  withUnknownFlag,
} from '@/service/ingress/ingressQueueModel';

type Props = {
  open: boolean;
  assigning: boolean;
  assignSearching: boolean;
  assignTargetCount: number;
  assignMediaType: 'movie' | 'episode';
  onAssignMediaTypeChange: (value: 'movie' | 'episode') => void;
  assignSearchMode: 'title' | 'imdb_id';
  onAssignSearchModeChange: (mode: 'title' | 'imdb_id') => void;
  assignSearchSource: 'omdb' | 'tmdb';
  onAssignSearchSourceChange: (source: 'omdb' | 'tmdb') => void;
  assignSearchQuery: string;
  onAssignSearchQueryChange: (value: string) => void;
  assignImdbQuery: string;
  onAssignImdbQueryChange: (value: string) => void;
  assignSearchResults: SearchResult[];
  visibleAssignSearchResults: SearchResult[];
  selectedAssignResult: SearchResult | null;
  onSelectAssignResult: (value: SearchResult | null) => void;
  assignTargets: IngressQueueItem[];
  episodeMapByItemId: Record<string, EpisodeAssignmentMapping>;
  onEpisodeMappingChange: (itemId: string, mapping: EpisodeAssignmentMapping) => void;
  organizeAfterAssign: boolean;
  onOrganizeAfterAssignChange: (value: boolean) => void;
  onSearch: () => void;
  onImdbSearch: () => void;
  onResultsScroll: (event: React.UIEvent<HTMLUListElement>) => void;
  onClose: () => void;
  onAssign: () => void;
};

const IngressManualAssignDialog: React.FC<Props> = ({
  open,
  assigning,
  assignSearching,
  assignTargetCount,
  assignMediaType,
  onAssignMediaTypeChange,
  assignSearchMode,
  onAssignSearchModeChange,
  assignSearchSource,
  onAssignSearchSourceChange,
  assignSearchQuery,
  onAssignSearchQueryChange,
  assignImdbQuery,
  onAssignImdbQueryChange,
  assignSearchResults,
  visibleAssignSearchResults,
  selectedAssignResult,
  onSelectAssignResult,
  assignTargets,
  episodeMapByItemId,
  onEpisodeMappingChange,
  organizeAfterAssign,
  onOrganizeAfterAssignChange,
  onSearch,
  onImdbSearch,
  onResultsScroll,
  onClose,
  onAssign,
}) => (
  <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
    <DialogTitle>Manual Assignment</DialogTitle>
    <DialogContent>
      <Stack spacing={2} sx={{ mt: 1 }}>
        <Typography variant="body2" color="text.secondary">
          Assigning {assignTargetCount} queue item{assignTargetCount === 1 ? '' : 's'}.
        </Typography>

        <FormControl size="small" sx={{ maxWidth: 240 }}>
          <InputLabel id="assign-media-type-label">Assignment Type</InputLabel>
          <Select
            labelId="assign-media-type-label"
            label="Assignment Type"
            value={assignMediaType}
            onChange={(event) => onAssignMediaTypeChange(event.target.value as 'movie' | 'episode')}
          >
            <MenuItem value="movie">Movie</MenuItem>
            <MenuItem value="episode">TV Episode</MenuItem>
          </Select>
        </FormControl>

        <FormControl size="small" sx={{ maxWidth: 200 }}>
          <InputLabel id="assign-search-mode-label">Search by</InputLabel>
          <Select
            labelId="assign-search-mode-label"
            label="Search by"
            value={assignSearchMode}
            onChange={(event) => onAssignSearchModeChange(event.target.value as 'title' | 'imdb_id')}
          >
            <MenuItem value="title">Title</MenuItem>
            <MenuItem value="imdb_id">IMDb ID</MenuItem>
          </Select>
        </FormControl>

        {assignSearchMode === 'imdb_id' ? (
          <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
            <TextField
              label="IMDb ID"
              fullWidth
              size="small"
              value={assignImdbQuery}
              placeholder="Example: tt1234567"
              onChange={(event) => onAssignImdbQueryChange(event.target.value)}
              onKeyDown={(event) => { if (event.key === 'Enter' && assignImdbQuery.trim()) onImdbSearch(); }}
            />
            <Button variant="contained" onClick={onImdbSearch} disabled={assignSearching || !assignImdbQuery.trim()}>
              {assignSearching ? 'Searching…' : 'Lookup'}
            </Button>
          </Box>
        ) : (
          <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
            <FormControl size="small" sx={{ minWidth: 110 }}>
              <InputLabel id="assign-source-label">Source</InputLabel>
              <Select
                labelId="assign-source-label"
                label="Source"
                value={assignSearchSource}
                onChange={(event) => onAssignSearchSourceChange(event.target.value as 'omdb' | 'tmdb')}
              >
                <MenuItem value="omdb">OMDB</MenuItem>
                <MenuItem value="tmdb">TMDB</MenuItem>
              </Select>
            </FormControl>
            <TextField
              label={assignMediaType === 'movie' ? 'Search movie' : 'Search series'}
              fullWidth
              size="small"
              value={assignSearchQuery}
              onChange={(event) => onAssignSearchQueryChange(event.target.value)}
              onKeyDown={(event) => { if (event.key === 'Enter' && assignSearchQuery.trim()) onSearch(); }}
            />
            <Button variant="contained" onClick={onSearch} disabled={assignSearching || !assignSearchQuery.trim()}>
              {assignSearching ? 'Searching…' : 'Search'}
            </Button>
          </Box>
        )}

        <Autocomplete
          options={visibleAssignSearchResults}
          value={selectedAssignResult}
          onChange={(_, value) => onSelectAssignResult(value)}
          getOptionLabel={(option) => `${option.title} (${option.year}) [${option.source}]`}
          isOptionEqualToValue={(option, value) => option.id === value.id && option.source === value.source}
          ListboxProps={{ onScroll: onResultsScroll }}
          renderInput={(params) => <TextField {...params} label="Select title" size="small" />}
        />

        {assignSearchResults.length > visibleAssignSearchResults.length && (
          <Typography variant="caption" color="text.secondary">
            Showing {visibleAssignSearchResults.length} of {assignSearchResults.length} results. Scroll to the bottom to load more.
          </Typography>
        )}

        {assignMediaType === 'episode' && assignTargets.length > 0 && (
          <Box>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>
              Episode Mapping
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
              Mark an entry as Unknown to place it in Season 00 and keep the original filename.
            </Typography>
            <Stack spacing={1.2}>
              {assignTargets.map((item) => {
                const mapping = episodeMapByItemId[item.id] || {};
                return (
                  <Box key={item.id} sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
                    <Typography variant="body2" sx={{ minWidth: 260 }} noWrap title={item.file_name}>
                      {item.file_name}
                    </Typography>
                    <FormControlLabel
                      control={
                        <Checkbox
                          size="small"
                          checked={Boolean(mapping.unknown)}
                          onChange={(event) => onEpisodeMappingChange(item.id, withUnknownFlag(mapping, event.target.checked))}
                        />
                      }
                      label="Unknown"
                      sx={{ mr: 1 }}
                    />
                    <TextField
                      label="Season"
                      type="number"
                      size="small"
                      disabled={Boolean(mapping.unknown)}
                      value={mapping.season ?? ''}
                      onChange={(event) => {
                        const seasonValue = event.target.value ? Number(event.target.value) : undefined;
                        onEpisodeMappingChange(item.id, withSeason(mapping, seasonValue));
                      }}
                      sx={{ width: 120 }}
                    />
                    <TextField
                      label="Episode"
                      type="number"
                      size="small"
                      disabled={Boolean(mapping.unknown)}
                      value={mapping.episode ?? ''}
                      onChange={(event) => {
                        const episodeValue = event.target.value ? Number(event.target.value) : undefined;
                        onEpisodeMappingChange(item.id, withEpisode(mapping, episodeValue));
                      }}
                      sx={{ width: 120 }}
                    />
                  </Box>
                );
              })}
            </Stack>
          </Box>
        )}

        <FormControlLabel
          control={
            <Switch
              checked={organizeAfterAssign}
              onChange={(event) => onOrganizeAfterAssignChange(event.target.checked)}
            />
          }
          label="Organize files immediately"
        />
      </Stack>
    </DialogContent>
    <DialogActions>
      <Button onClick={onClose} disabled={assigning}>Cancel</Button>
      <Button variant="contained" onClick={onAssign} disabled={assigning || !selectedAssignResult}>
        {assigning ? 'Assigning…' : 'Assign'}
      </Button>
    </DialogActions>
  </Dialog>
);

export default IngressManualAssignDialog;
