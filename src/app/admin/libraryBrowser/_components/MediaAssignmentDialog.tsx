/**
 * MediaAssignmentDialog Component
 * Allows users to assign selected files to movies or TV episodes
 * Includes search, version selection, and Jellyfin folder preview
 */

import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  Autocomplete,
  Box,
  Typography,
  FormControl,
  FormLabel,
  RadioGroup,
  FormControlLabel,
  Radio,
  Chip,
  Stack,
  Alert,
  CircularProgress,
  Paper,
  Divider,
} from '@mui/material';
import {
  Movie as MovieIcon,
  Tv as TvIcon,
  Folder,
  Check,
} from '@mui/icons-material';
import { MediaFile } from '@/types/library';
import { Movie } from '@/types/collections/Movie.type';
import { Series } from '@/types/collections/Series.type';
import { Episode } from '@/types/collections/Episode.type';
import { Season } from '@/types/collections/Season.type';
import MediaOrganizationService from '@/service/library/MediaOrganizationService';

interface MediaAssignmentDialogProps {
  open: boolean;
  onClose: () => void;
  selectedFiles: MediaFile[];
  onAssign: (assignments: AssignmentData[]) => Promise<void>;
}

interface AssignmentData {
  fileId: string;
  mediaType: 'movie' | 'episode';
  mediaId: string;
  version?: string;
  targetStructure: {
    libraryRoot: string;
    mediaFolder: string;
    fullPath: string;
    jellyfinFolderName: string;
    jellyfinFileName: string;
  };
}

export default function MediaAssignmentDialog({
  open,
  onClose,
  selectedFiles,
  onAssign,
}: MediaAssignmentDialogProps) {
  const [mediaType, setMediaType] = useState<'movie' | 'episode'>('movie');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<(Movie | Series)[]>([]);
  const [selectedMedia, setSelectedMedia] = useState<Movie | Series | null>(null);
  const [selectedEpisode, setSelectedEpisode] = useState<Episode | null>(null);
  const [selectedSeason, setSelectedSeason] = useState<Season | null>(null);
  const [version, setVersion] = useState('1080p');
  const [loading, setLoading] = useState(false);
  const [previewStructure, setPreviewStructure] = useState<any>(null);

  const orgService = new MediaOrganizationService();

  // Search for movies or series
  const handleSearch = async (query: string) => {
    if (!query || query.length < 2) {
      setSearchResults([]);
      return;
    }

    setLoading(true);
    try {
      // TODO: Replace with actual Firebase query
      // This is a placeholder - you'll need to implement the actual search
      const response = await fetch(`/api/${mediaType === 'movie' ? 'movies' : 'series'}/search?q=${query}`);
      const results = await response.json();
      setSearchResults(results);
    } catch (error) {
      console.error('Search failed:', error);
      setSearchResults([]);
    } finally {
      setLoading(false);
    }
  };

  // Fetch season when episode is selected
  useEffect(() => {
    const fetchSeason = async () => {
      if (!selectedEpisode || !selectedEpisode.seasonId) {
        setSelectedSeason(null);
        return;
      }

      try {
        const response = await fetch(`/api/seasons/${selectedEpisode.seasonId}`);
        if (response.ok) {
          const season = await response.json();
          setSelectedSeason(season);
        }
      } catch (error) {
        console.error('Failed to fetch season:', error);
        setSelectedSeason(null);
      }
    };

    fetchSeason();
  }, [selectedEpisode]);

  // Generate preview when media is selected
  useEffect(() => {
    if (!selectedMedia || selectedFiles.length === 0) {
      setPreviewStructure(null);
      return;
    }

    const firstFile = selectedFiles[0];
    let structure;

    if (mediaType === 'movie' && 'externalIds' in selectedMedia) {
      structure = orgService.generateMovieStructure(
        selectedMedia as Movie,
        firstFile,
        version
      );
    } else if (mediaType === 'episode' && selectedEpisode && selectedSeason) {
      structure = orgService.generateEpisodeStructure(
        selectedMedia as Series,
        selectedSeason,
        selectedEpisode,
        firstFile
      );
    }

    setPreviewStructure(structure);
  }, [selectedMedia, selectedEpisode, selectedSeason, version, selectedFiles, mediaType]);

  const handleAssign = async () => {
    if (!selectedMedia || selectedFiles.length === 0) return;
    if (mediaType === 'episode' && !selectedEpisode) return;

    setLoading(true);
    try {
      const assignments: AssignmentData[] = selectedFiles.map(file => ({
        fileId: file.id,
        mediaType,
        mediaId: mediaType === 'movie' ? selectedMedia.id : selectedEpisode!.id,
        version: mediaType === 'movie' ? version : undefined,
        targetStructure: previewStructure,
      }));

      await onAssign(assignments);
      onClose();
    } catch (error) {
      console.error('Assignment failed:', error);
    } finally {
      setLoading(false);
    }
  };

  const getMediaTitle = (media: Movie | Series): string => {
    if ('externalIds' in media && media.externalIds) {
      const movie = media as Movie;
      // Extract year from releaseDate format "DayAsNumber-Month-Year"
      const year = movie.releaseDate ? movie.releaseDate.split('-')[2] : 
                   movie.theatricalRelease?.date ? new Date(movie.theatricalRelease.date).getFullYear() : 'Unknown';
      return `${movie.title} (${year})`;
    } else {
      const series = media as Series;
      // Extract first year from runningYears or seriesSummary
      const year = series.runningYears?.[0] || 
                   (series.seriesSummary?.firstAired ? new Date(series.seriesSummary.firstAired).getFullYear() : 'Unknown');
      return `${series.title} (${year})`;
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>
        Assign Files to Media
        <Typography variant="body2" color="text.secondary">
          {selectedFiles.length} file{selectedFiles.length !== 1 ? 's' : ''} selected
        </Typography>
      </DialogTitle>

      <DialogContent>
        <Stack spacing={3} sx={{ mt: 1 }}>
          {/* Media Type Selection */}
          <FormControl>
            <FormLabel>Media Type</FormLabel>
            <RadioGroup
              row
              value={mediaType}
              onChange={(e) => {
                setMediaType(e.target.value as 'movie' | 'episode');
                setSelectedMedia(null);
                setSelectedEpisode(null);
                setSelectedSeason(null);
                setSearchResults([]);
              }}
            >
              <FormControlLabel
                value="movie"
                control={<Radio />}
                label={
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <MovieIcon fontSize="small" />
                    Movie
                  </Box>
                }
              />
              <FormControlLabel
                value="episode"
                control={<Radio />}
                label={
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <TvIcon fontSize="small" />
                    TV Episode
                  </Box>
                }
              />
            </RadioGroup>
          </FormControl>

          {/* Search */}
          <Autocomplete
            freeSolo
            options={searchResults}
            getOptionLabel={(option) => {
              if (typeof option === 'string') {
                return option;
              }
              return getMediaTitle(option);
            }}
            loading={loading}
            onInputChange={(_, value) => {
              setSearchQuery(value);
              handleSearch(value);
            }}
            onChange={(_, value) => {
              setSelectedMedia(value as Movie | Series);
            }}
            renderInput={(params) => (
              <TextField
                {...params}
                label={`Search ${mediaType === 'movie' ? 'Movies' : 'TV Series'}`}
                placeholder="Start typing to search..."
                InputProps={{
                  ...params.InputProps,
                  endAdornment: (
                    <>
                      {loading && <CircularProgress size={20} />}
                      {params.InputProps.endAdornment}
                    </>
                  ),
                }}
              />
            )}
          />

          {/* Episode Selection (for TV shows) */}
          {mediaType === 'episode' && selectedMedia && (
            <Alert severity="info">
              Episode selection will be added in the next update. 
              For now, implement a season/episode picker here.
            </Alert>
          )}

          {/* Version Selection (for movies) */}
          {mediaType === 'movie' && selectedMedia && (
            <FormControl>
              <FormLabel>Quality Version</FormLabel>
              <RadioGroup
                row
                value={version}
                onChange={(e) => setVersion(e.target.value)}
              >
                <FormControlLabel value="480p" control={<Radio />} label="480p" />
                <FormControlLabel value="720p" control={<Radio />} label="720p" />
                <FormControlLabel value="1080p" control={<Radio />} label="1080p" />
                <FormControlLabel value="4K" control={<Radio />} label="4K" />
                <FormControlLabel value="8K" control={<Radio />} label="8K" />
              </RadioGroup>
            </FormControl>
          )}

          {/* Jellyfin Structure Preview */}
          {previewStructure && (
            <Paper variant="outlined" sx={{ p: 2, bgcolor: 'background.default' }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
                <Folder color="primary" />
                <Typography variant="subtitle2">Jellyfin Folder Structure Preview</Typography>
              </Box>
              
              <Stack spacing={1}>
                <Box>
                  <Typography variant="caption" color="text.secondary">Library Root</Typography>
                  <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: '0.875rem' }}>
                    {previewStructure.libraryRoot}
                  </Typography>
                </Box>
                
                <Divider />
                
                <Box>
                  <Typography variant="caption" color="text.secondary">Media Folder</Typography>
                  <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: '0.875rem' }}>
                    📁 {previewStructure.jellyfinFolderName}
                  </Typography>
                </Box>
                
                <Box sx={{ pl: 2 }}>
                  <Typography variant="caption" color="text.secondary">File Name</Typography>
                  <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: '0.875rem' }}>
                    📄 {previewStructure.jellyfinFileName}
                  </Typography>
                </Box>
                
                <Divider />
                
                <Box>
                  <Typography variant="caption" color="text.secondary">Full Path</Typography>
                  <Typography 
                    variant="body2" 
                    sx={{ 
                      fontFamily: 'monospace', 
                      fontSize: '0.75rem',
                      wordBreak: 'break-all',
                      color: 'success.main'
                    }}
                  >
                    {previewStructure.fullPath}
                  </Typography>
                </Box>
              </Stack>
            </Paper>
          )}

          {/* Selected Files Summary */}
          <Box>
            <Typography variant="caption" color="text.secondary" gutterBottom>
              Files to Assign
            </Typography>
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
              {selectedFiles.map((file) => (
                <Chip
                  key={file.id}
                  label={file.fileName}
                  size="small"
                  icon={<Check />}
                />
              ))}
            </Stack>
          </Box>
        </Stack>
      </DialogContent>

      <DialogActions>
        <Button onClick={onClose} disabled={loading}>
          Cancel
        </Button>
        <Button
          onClick={handleAssign}
          variant="contained"
          disabled={!selectedMedia || loading || (mediaType === 'episode' && (!selectedEpisode || !selectedSeason))}
          startIcon={loading && <CircularProgress size={20} />}
        >
          Assign Files
        </Button>
      </DialogActions>
    </Dialog>
  );
}
