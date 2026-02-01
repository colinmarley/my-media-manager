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
  InputAdornment,
  IconButton,
} from '@mui/material';
import {
  Movie as MovieIcon,
  Tv as TvIcon,
  Folder,
  Check,
  Search as SearchIcon,
  CloudDownload,
  Close,
} from '@mui/icons-material';
import { MediaFile } from '@/types/library';
import { Movie } from '@/types/collections/Movie.type';
import { Series } from '@/types/collections/Series.type';
import { Episode } from '@/types/collections/Episode.type';
import { Season } from '@/types/collections/Season.type';
import MediaOrganizationService from '@/service/library/MediaOrganizationService';
import MediaAssignmentSearchService, { SearchResult } from '@/service/library/MediaAssignmentSearchService';
import FolderBrowser from '../../library/_components/FolderBrowser';
import EpisodeSelector from './EpisodeSelector';

interface MediaAssignmentDialogProps {
  open: boolean;
  onClose: () => void;
  selectedFiles: MediaFile[];
  onAssign: (assignments: AssignmentData[]) => Promise<void>;
}

interface AssignmentData {
  fileId: string;
  fileIds: string[];
  scanId: string;
  mediaType: 'movie' | 'episode';
  mediaId: string;
  mediaTitle: string;
  targetStructure: any;
  version?: string;
  organizeNow?: boolean;
  seriesId?: string;
  seasonId?: string;
  seasonNumber?: number;
  episodeNumber?: number;
}

export default function MediaAssignmentDialog({
  open,
  onClose,
  selectedFiles,
  onAssign,
}: MediaAssignmentDialogProps) {
  const [mediaType, setMediaType] = useState<'movie' | 'episode'>('movie');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [selectedResult, setSelectedResult] = useState<SearchResult | null>(null);
  const [selectedMedia, setSelectedMedia] = useState<Movie | Series | null>(null);
  const [selectedEpisode, setSelectedEpisode] = useState<Episode | null>(null);
  const [selectedSeason, setSelectedSeason] = useState<Season | null>(null);
  const [version, setVersion] = useState('1080p');
  const [organizeNow, setOrganizeNow] = useState(false);
  const [destinationFolder, setDestinationFolder] = useState<string | null>(null);
  const [showFolderBrowser, setShowFolderBrowser] = useState(false);
  const [loading, setLoading] = useState(false);
  const [searching, setSearching] = useState(false);
  const [previewStructure, setPreviewStructure] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const orgService = new MediaOrganizationService();

  // Autocomplete search (Firebase only) - triggered as user types
  const handleAutocompleteSearch = async (value: string) => {
    if (!value || value.length < 2) {
      setSearchResults([]);
      return;
    }

    setSearching(true);
    try {
      const results = await MediaAssignmentSearchService.searchFirebase(
        value,
        mediaType === 'movie' ? 'movie' : 'series'
      );
      setSearchResults(results);
    } catch (error) {
      console.error('Autocomplete search failed:', error);
    } finally {
      setSearching(false);
    }
  };

  // Button search (Firebase + OMDB) - triggered when user clicks search button
  const handleOMDBSearch = async () => {
    if (!searchQuery || searchQuery.length < 2) {
      setError('Please enter at least 2 characters');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const results = await MediaAssignmentSearchService.combinedSearch(
        searchQuery,
        mediaType === 'movie' ? 'movie' : 'series'
      );
      setSearchResults(results);
      
      if (results.length === 0) {
        setError('No results found. Try a different search term.');
      }
    } catch (error: any) {
      console.error('OMDB search failed:', error);
      setError(error.message || 'Search failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // Handle selection from autocomplete
  const handleResultSelect = async (result: SearchResult | null) => {
    setSelectedResult(result);
    
    if (!result) {
      setSelectedMedia(null);
      return;
    }

    // If it's from Firebase, use the data directly
    if (result.source === 'firebase') {
      setSelectedMedia(result.data as Movie | Series);
    } 
    // If it's from OMDB, we need to fetch full data and potentially save it
    else if (result.source === 'omdb') {
      setLoading(true);
      try {
        const fullData = await MediaAssignmentSearchService.getOMDBFullData(result.imdbId);
        
        // Save to Firebase
        let firebaseId: string;
        if (result.type === 'movie') {
          firebaseId = await MediaAssignmentSearchService.saveMovieToFirebase(fullData);
        } else {
          firebaseId = await MediaAssignmentSearchService.saveSeriesToFirebase(fullData);
        }
        
        // Fetch the newly created document
        const savedResults = await MediaAssignmentSearchService.searchFirebase(
          result.title,
          result.type
        );
        const savedMedia = savedResults.find(r => r.id === firebaseId);
        
        if (savedMedia) {
          setSelectedMedia(savedMedia.data as Movie | Series);
        }
      } catch (error: any) {
        console.error('Error processing OMDB result:', error);
        setError('Failed to save media data. Please try again.');
      } finally {
        setLoading(false);
      }
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
    if (!selectedMedia || typeof selectedMedia !== 'object' || selectedFiles.length === 0) {
      setPreviewStructure(null);
      return;
    }

    const firstFile = selectedFiles[0] as any;
    // Convert the file format for structure generation
    const mediaFile: any = {
      fileExtension: firstFile.extension?.startsWith('.') ? firstFile.extension : `.${firstFile.extension || ''}`,
      folderPath: firstFile.path?.substring(0, firstFile.path.lastIndexOf('\\\\')) || firstFile.folderPath || '',
      filePath: firstFile.path || firstFile.filePath || '',
      fileName: firstFile.name || firstFile.fileName || ''
    };
    
    let structure;

    if (mediaType === 'movie' && 'externalIds' in selectedMedia) {
      structure = orgService.generateMovieStructure(
        selectedMedia as Movie,
        mediaFile,
        version,
        destinationFolder || undefined
      );
    } else if (mediaType === 'episode' && selectedEpisode && selectedSeason) {
      structure = orgService.generateEpisodeStructure(
        selectedMedia as Series,
        selectedSeason,
        selectedEpisode,
        mediaFile,
        destinationFolder || undefined
      );
    }

    setPreviewStructure(structure);
  }, [selectedMedia, selectedEpisode, selectedSeason, version, selectedFiles, mediaType, destinationFolder]);

  const handleAssign = async () => {
    if (!selectedMedia || selectedFiles.length === 0) return;
    if (mediaType === 'episode' && !selectedEpisode) return;

    setLoading(true);
    try {
      const firstFile = selectedFiles[0] as any;
      // Get the current scanId (should be same for all files)
      const scanId = firstFile.scanId;

      const assignments: AssignmentData[] = selectedFiles.map(file => ({
        fileId: file.id,
        fileIds: [file.id],
        scanId: scanId || '',
        mediaType: mediaType,
        mediaId: mediaType === 'episode' && selectedEpisode 
          ? selectedEpisode.id 
          : (selectedMedia.id || selectedMedia.externalIds?.imdbId || ''),
        mediaTitle: mediaType === 'episode' && selectedEpisode
          ? selectedEpisode.title 
          : selectedMedia.title,
        targetStructure: previewStructure!,
        version: mediaType === 'movie' ? version : undefined,
        organizeNow: organizeNow,
        seriesId: mediaType === 'episode' ? (selectedMedia.id || selectedMedia.externalIds?.imdbId) : undefined,
        seasonId: selectedSeason?.id,
        seasonNumber: selectedSeason?.seasonNumber ?? undefined,
        episodeNumber: selectedEpisode?.episodeNumber ?? undefined,
      }));

      await onAssign(assignments);
      onClose();
    } catch (error: any) {
      console.error('Assignment failed:', error);
      setError(error.message || 'Failed to assign media');
    } finally {
      setLoading(false);
    }
  };

  const getMediaTitle = (result: SearchResult): string => {
    const source = result.source === 'firebase' ? '✓' : '⬇';
    return `${source} ${result.title} (${result.year})`;
  };

  const getResultOptionLabel = (option: SearchResult | string): string => {
    if (typeof option === 'string') {
      return option;
    }
    return getMediaTitle(option);
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
          {/* Error Alert */}
          {error && (
            <Alert severity="error" onClose={() => setError(null)}>
              {error}
            </Alert>
          )}

          {/* Media Type Selection */}
          <FormControl>
            <FormLabel>Media Type</FormLabel>
            <RadioGroup
              row
              value={mediaType}
              onChange={(e) => {
                setMediaType(e.target.value as 'movie' | 'episode');
                setSelectedMedia(null);
                setSelectedResult(null);
                setSelectedEpisode(null);
                setSelectedSeason(null);
                setSearchResults([]);
                setSearchQuery('');
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

          {/* Search with Autocomplete and Button */}
          <Box>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
              ✓ = In your collection | ⬇ = From OMDB (will be added)
            </Typography>
            <Autocomplete
              freeSolo
              options={searchResults}
              value={selectedResult}
              getOptionLabel={getResultOptionLabel}
              loading={searching}
              onInputChange={(_, value) => {
                setSearchQuery(value);
                handleAutocompleteSearch(value);
              }}
              onChange={(_, value) => {
                if (value && typeof value === 'object') {
                  handleResultSelect(value);
                } else {
                  handleResultSelect(null);
                }
              }}
              renderOption={(props, option) => {
                const { key, ...otherProps } = props;
                return (
                  <Box component="li" key={key} {...otherProps}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, width: '100%' }}>
                      {option.source === 'firebase' ? (
                        <Check color="success" fontSize="small" />
                    ) : (
                      <CloudDownload color="info" fontSize="small" />
                    )}
                    <Box sx={{ flexGrow: 1 }}>
                      <Typography variant="body2">{option.title}</Typography>
                      <Typography variant="caption" color="text.secondary">
                        {option.year} • {option.source === 'firebase' ? 'Your Collection' : 'OMDB'}
                      </Typography>
                    </Box>
                    {option.poster && option.poster !== 'N/A' && (
                      <Box
                        component="img"
                        src={option.poster}
                        sx={{ width: 40, height: 60, objectFit: 'cover', borderRadius: 0.5 }}
                        onError={(e: any) => { e.target.style.display = 'none'; }}
                      />
                    )}
                  </Box>
                </Box>
                );
              }}
              renderInput={(params) => (
                <TextField
                  {...params}
                  label={`Search ${mediaType === 'movie' ? 'Movies' : 'TV Series'}`}
                  placeholder="Start typing or click search..."
                  InputProps={{
                    ...params.InputProps,
                    endAdornment: (
                      <>
                        {searching && <CircularProgress size={20} />}
                        {params.InputProps.endAdornment}
                        <InputAdornment position="end">
                          <IconButton
                            onClick={handleOMDBSearch}
                            disabled={loading || !searchQuery}
                            color="primary"
                            edge="end"
                          >
                            <SearchIcon />
                          </IconButton>
                        </InputAdornment>
                      </>
                    ),
                  }}
                />
              )}
            />
            <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
              Type to search your collection, or click the search icon to search OMDB
            </Typography>
          </Box>

          {/* Episode Selection (for TV shows) */}
          {mediaType === 'episode' && selectedMedia && (
            <EpisodeSelector
              seriesId={selectedMedia.id || selectedMedia.externalIds?.imdbId || ''}
              selectedEpisode={selectedEpisode}
              onEpisodeSelect={(season, episode) => {
                setSelectedSeason(season);
                setSelectedEpisode(episode);
              }}
            />
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

          {/* Organization Options */}
          {selectedMedia && (
            <>
              {/* Destination Folder Selection */}
              <Box>
                <FormLabel>Destination Library Folder</FormLabel>
                <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', mt: 1 }}>
                  <Button
                    variant="outlined"
                    startIcon={<Folder />}
                    onClick={() => setShowFolderBrowser(true)}
                    fullWidth
                  >
                    {destinationFolder || 'Select Destination Folder'}
                  </Button>
                  {destinationFolder && (
                    <IconButton
                      size="small"
                      onClick={() => setDestinationFolder(null)}
                      color="error"
                    >
                      <Close />
                    </IconButton>
                  )}
                </Box>
                <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
                  Choose where media will be organized. If not selected, uses the file's current location.
                </Typography>
              </Box>

              {/* Organize Now Option */}
              <FormControl>
                <FormControlLabel
                  control={
                    <Radio
                      checked={organizeNow}
                      onChange={(e) => setOrganizeNow(e.target.checked)}
                      color="primary"
                    />
                  }
                  label={
                    <Box>
                      <Typography variant="body2">
                        Organize files immediately
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        Moves files to Jellyfin folder structure after assignment. Backend must be running.
                      </Typography>
                    </Box>
                  }
                />
              </FormControl>
            </>
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
                    📁 {previewStructure.mediaFolder}
                  </Typography>
                </Box>
                
                <Box sx={{ pl: 2 }}>
                  <Typography variant="caption" color="text.secondary">File Name</Typography>
                  <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: '0.875rem' }}>
                    📄 {previewStructure.fileName}
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

      {/* Folder Browser Dialog */}
      <FolderBrowser
        open={showFolderBrowser}
        onClose={() => setShowFolderBrowser(false)}
        onSelect={(path) => {
          setDestinationFolder(path);
          setShowFolderBrowser(false);
        }}
        initialPath={destinationFolder || ''}
      />
    </Dialog>
  );
}
