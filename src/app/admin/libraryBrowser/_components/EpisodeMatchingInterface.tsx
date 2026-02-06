/**
 * EpisodeMatchingInterface Component
 * Drag-and-drop interface for matching multiple files to episodes
 */

import React, { useState, useEffect } from 'react';
import {
  Box,
  Paper,
  Typography,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Button,
  Stack,
  Chip,
  Alert,
  CircularProgress,
  Card,
  CardContent,
  IconButton,
  Tooltip,
} from '@mui/material';
import {
  DragIndicator,
  Link as LinkIcon,
  LinkOff,
  AutoFixHigh,
  Clear,
  CheckCircle,
  Error as ErrorIcon,
} from '@mui/icons-material';
import { MediaFile } from '@/types/library';
import { Season } from '@/types/collections/Season.type';
import { Episode } from '@/types/collections/Episode.type';
import { collection, query, where, getDocs, orderBy } from 'firebase/firestore';
import { db } from '../../../../../firebaseConfig';

interface EpisodeMatchingInterfaceProps {
  seriesId: string;
  selectedFiles: MediaFile[];
  fileEpisodeMappings: Map<string, string>;
  onMappingsChange: (mappings: Map<string, string>, episodes: Episode[], season: Season) => void;
  onAutoMatch: (episodes: Episode[]) => void;
  onClearAll: () => void;
  draggedFileId: string | null;
  onDragStart: (fileId: string) => void;
  onDragEnd: () => void;
  onMapFile: (fileId: string, episodeId: string | null) => void;
}

export default function EpisodeMatchingInterface({
  seriesId,
  selectedFiles,
  fileEpisodeMappings,
  onMappingsChange,
  onAutoMatch,
  onClearAll,
  draggedFileId,
  onDragStart,
  onDragEnd,
  onMapFile,
}: EpisodeMatchingInterfaceProps) {
  const [seasons, setSeasons] = useState<Season[]>([]);
  const [selectedSeason, setSelectedSeason] = useState<Season | null>(null);
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOverEpisodeId, setDragOverEpisodeId] = useState<string | null>(null);

  // Load seasons
  useEffect(() => {
    const loadSeasons = async () => {
      if (!seriesId) return;
      
      setLoading(true);
      setError(null);
      try {
        const q = query(
          collection(db, 'seasons'),
          where('seriesId', '==', seriesId),
          orderBy('seasonNumber', 'asc')
        );
        const snapshot = await getDocs(q);
        const seasonData = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        } as Season));
        
        setSeasons(seasonData);
        
        // Auto-select first season
        if (seasonData.length > 0) {
          setSelectedSeason(seasonData[0]);
        }
      } catch (err: any) {
        console.error('Error loading seasons:', err);
        setError('Failed to load seasons');
      } finally {
        setLoading(false);
      }
    };

    loadSeasons();
  }, [seriesId]);

  // Load episodes when season is selected
  useEffect(() => {
    const loadEpisodes = async () => {
      if (!selectedSeason) {
        setEpisodes([]);
        return;
      }
      
      setLoading(true);
      try {
        const q = query(
          collection(db, 'episodes'),
          where('seasonId', '==', selectedSeason.id),
          orderBy('episodeNumber', 'asc')
        );
        const snapshot = await getDocs(q);
        const episodeData = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        } as Episode));
        
        setEpisodes(episodeData);
        onMappingsChange(fileEpisodeMappings, episodeData, selectedSeason);
      } catch (err: any) {
        console.error('Error loading episodes:', err);
        setError('Failed to load episodes');
      } finally {
        setLoading(false);
      }
    };

    loadEpisodes();
  }, [selectedSeason]);

  const handleDragStart = (e: React.DragEvent, fileId: string) => {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', fileId);
    onDragStart(fileId);
  };

  const handleDragOver = (e: React.DragEvent, episodeId: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverEpisodeId(episodeId);
  };

  const handleDragLeave = () => {
    setDragOverEpisodeId(null);
  };

  const handleDrop = (e: React.DragEvent, episodeId: string) => {
    e.preventDefault();
    const fileId = e.dataTransfer.getData('text/plain');
    if (fileId) {
      onMapFile(fileId, episodeId);
    }
    setDragOverEpisodeId(null);
    onDragEnd();
  };

  const getFileForEpisode = (episodeId: string): MediaFile | undefined => {
    for (const [fileId, epId] of fileEpisodeMappings.entries()) {
      if (epId === episodeId) {
        return selectedFiles.find(f => f.id === fileId);
      }
    }
    return undefined;
  };

  const getUnmappedFiles = (): MediaFile[] => {
    return selectedFiles.filter(f => !fileEpisodeMappings.has(f.id));
  };

  const handleAutoMatch = () => {
    onAutoMatch(episodes);
  };

  const unmappedFiles = getUnmappedFiles();
  const mappedCount = selectedFiles.length - unmappedFiles.length;

  return (
    <Box>
      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {/* Season Selection */}
      <FormControl fullWidth sx={{ mb: 2 }}>
        <InputLabel>Season</InputLabel>
        <Select
          value={selectedSeason?.id || ''}
          onChange={(e) => {
            const season = seasons.find(s => s.id === e.target.value);
            setSelectedSeason(season || null);
          }}
          label="Season"
          disabled={loading || seasons.length === 0}
        >
          {seasons.map(season => (
            <MenuItem key={season.id} value={season.id}>
              Season {season.seasonNumber} - {season.title}
            </MenuItem>
          ))}
        </Select>
      </FormControl>

      {/* Matching Status and Actions */}
      {selectedSeason && (
        <>
          <Stack direction="row" spacing={2} sx={{ mb: 2 }}>
            <Chip
              icon={mappedCount === selectedFiles.length ? <CheckCircle /> : <ErrorIcon />}
              label={`${mappedCount} / ${selectedFiles.length} files mapped`}
              color={mappedCount === selectedFiles.length ? 'success' : 'warning'}
              size="small"
            />
            <Button
              size="small"
              startIcon={<AutoFixHigh />}
              onClick={handleAutoMatch}
              variant="outlined"
            >
              Auto Match
            </Button>
            <Button
              size="small"
              startIcon={<Clear />}
              onClick={onClearAll}
              variant="outlined"
              color="error"
            >
              Clear All
            </Button>
          </Stack>

          {loading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
              <CircularProgress />
            </Box>
          ) : (
            <Box sx={{ display: 'flex', gap: 2 }}>
              {/* Unmapped Files Column */}
              <Box sx={{ flex: '0 0 42%' }}>
                <Paper variant="outlined" sx={{ p: 2, minHeight: 400 }}>
                  <Typography variant="subtitle2" gutterBottom>
                    Files ({unmappedFiles.length} unmapped)
                  </Typography>
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 2 }}>
                    Drag files to episodes to create mappings
                  </Typography>
                  
                  <Stack spacing={1}>
                    {selectedFiles.map(file => {
                      const isMapped = fileEpisodeMappings.has(file.id);
                      const mappedEpisodeId = fileEpisodeMappings.get(file.id);
                      const mappedEpisode = episodes.find(e => e.id === mappedEpisodeId);
                      
                      return (
                        <Card
                          key={file.id}
                          draggable={!isMapped}
                          onDragStart={(e) => handleDragStart(e, file.id)}
                          onDragEnd={onDragEnd}
                          sx={{
                            cursor: isMapped ? 'default' : 'grab',
                            opacity: draggedFileId === file.id ? 0.5 : 1,
                            bgcolor: isMapped ? 'success.light' : 'background.paper',
                            borderColor: isMapped ? 'success.main' : 'divider',
                            '&:hover': !isMapped ? { bgcolor: 'action.hover' } : {},
                          }}
                          variant="outlined"
                        >
                          <CardContent sx={{ p: 1.5, '&:last-child': { pb: 1.5 } }}>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                              {!isMapped && <DragIndicator fontSize="small" color="action" />}
                              {isMapped && <LinkIcon fontSize="small" color="success" />}
                              <Box sx={{ flex: 1 }}>
                                <Typography variant="body2" noWrap>
                                  {file.fileName}
                                </Typography>
                                {isMapped && mappedEpisode && (
                                  <Typography variant="caption" color="success.main">
                                    → E{mappedEpisode.episodeNumber}: {mappedEpisode.title}
                                  </Typography>
                                )}
                              </Box>
                              {isMapped && (
                                <Tooltip title="Unmap">
                                  <IconButton
                                    size="small"
                                    onClick={() => onMapFile(file.id, null)}
                                    color="error"
                                  >
                                    <LinkOff fontSize="small" />
                                  </IconButton>
                                </Tooltip>
                              )}
                            </Box>
                          </CardContent>
                        </Card>
                      );
                    })}
                  </Stack>
                </Paper>
              </Box>

              {/* Episodes Column */}
              <Box sx={{ flex: '1 1 58%' }}>
                <Paper variant="outlined" sx={{ p: 2, minHeight: 400 }}>
                  <Typography variant="subtitle2" gutterBottom>
                    Episodes (Season {selectedSeason.seasonNumber})
                  </Typography>
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 2 }}>
                    Drop files onto episodes to map them
                  </Typography>
                  
                  <Stack spacing={1} sx={{ maxHeight: 450, overflowY: 'auto' }}>
                    {episodes.map(episode => {
                      const mappedFile = getFileForEpisode(episode.id);
                      const isDragOver = dragOverEpisodeId === episode.id;
                      
                      return (
                        <Card
                          key={episode.id}
                          onDragOver={(e) => handleDragOver(e, episode.id)}
                          onDragLeave={handleDragLeave}
                          onDrop={(e) => handleDrop(e, episode.id)}
                          sx={{
                            bgcolor: isDragOver 
                              ? 'primary.light' 
                              : mappedFile 
                                ? 'success.light' 
                                : 'background.paper',
                            borderColor: isDragOver 
                              ? 'primary.main' 
                              : mappedFile 
                                ? 'success.main' 
                                : 'divider',
                            borderWidth: isDragOver ? 2 : 1,
                            transition: 'all 0.2s',
                          }}
                          variant="outlined"
                        >
                          <CardContent sx={{ p: 1.5, '&:last-child': { pb: 1.5 } }}>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                              <Chip
                                label={`E${episode.episodeNumber}`}
                                size="small"
                                color={mappedFile ? 'success' : 'default'}
                              />
                              <Box sx={{ flex: 1 }}>
                                <Typography variant="body2" fontWeight={mappedFile ? 600 : 400}>
                                  {episode.title}
                                </Typography>
                                {mappedFile && (
                                  <Typography variant="caption" color="text.secondary">
                                    📄 {mappedFile.fileName}
                                  </Typography>
                                )}
                              </Box>
                              {mappedFile && (
                                <CheckCircle fontSize="small" color="success" />
                              )}
                            </Box>
                          </CardContent>
                        </Card>
                      );
                    })}
                  </Stack>
                </Paper>
              </Box>
            </Box>
          )}
        </>
      )}
    </Box>
  );
}
