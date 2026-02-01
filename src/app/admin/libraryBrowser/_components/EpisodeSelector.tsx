/**
 * EpisodeSelector Component
 * Allows users to select a season and episode for TV series assignment
 */

import React, { useState, useEffect } from 'react';
import {
  Box,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Grid,
  Card,
  CardContent,
  CardActionArea,
  Typography,
  Chip,
  CircularProgress,
  Alert,
  Stack,
} from '@mui/material';
import {
  CheckCircle,
  RadioButtonUnchecked,
} from '@mui/icons-material';
import { Season } from '@/types/collections/Season.type';
import { Episode } from '@/types/collections/Episode.type';
import { collection, query, where, getDocs, orderBy } from 'firebase/firestore';
import { db } from '../../../../../firebaseConfig';

interface EpisodeSelectorProps {
  seriesId: string;
  selectedEpisode: Episode | null;
  onEpisodeSelect: (season: Season, episode: Episode) => void;
}

export default function EpisodeSelector({
  seriesId,
  selectedEpisode,
  onEpisodeSelect
}: EpisodeSelectorProps) {
  const [seasons, setSeasons] = useState<Season[]>([]);
  const [selectedSeason, setSelectedSeason] = useState<Season | null>(null);
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [loadingSeasons, setLoadingSeasons] = useState(false);
  const [loadingEpisodes, setLoadingEpisodes] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load seasons when series is selected
  useEffect(() => {
    const loadSeasons = async () => {
      if (!seriesId) return;
      
      setLoadingSeasons(true);
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
        
        console.log('Loaded seasons for seriesId:', seriesId);
        console.log('Found seasons:', seasonData.length);
        console.log('Season data:', seasonData);
        
        setSeasons(seasonData);
        
        // Auto-select first season if available
        if (seasonData.length > 0 && !selectedSeason) {
          setSelectedSeason(seasonData[0]);
        }
      } catch (err: any) {
        console.error('Error loading seasons:', err);
        console.error('Error code:', err.code);
        console.error('Error message:', err.message);
        setError('Failed to load seasons. Please try again.');
      } finally {
        setLoadingSeasons(false);
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
      
      setLoadingEpisodes(true);
      setError(null);
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
      } catch (err: any) {
        console.error('Error loading episodes:', err);
        setError('Failed to load episodes. Please try again.');
      } finally {
        setLoadingEpisodes(false);
      }
    };

    loadEpisodes();
  }, [selectedSeason]);

  const handleSeasonChange = (seasonId: string) => {
    const season = seasons.find(s => s.id === seasonId);
    setSelectedSeason(season || null);
  };

  const handleEpisodeClick = (episode: Episode) => {
    if (selectedSeason) {
      onEpisodeSelect(selectedSeason, episode);
    }
  };

  if (loadingSeasons) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', p: 3 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (error) {
    return (
      <Alert severity="error" onClose={() => setError(null)}>
        {error}
      </Alert>
    );
  }

  if (seasons.length === 0) {
    return (
      <Alert severity="info">
        No seasons found for this series. Please add seasons first.
      </Alert>
    );
  }

  return (
    <Stack spacing={2}>
      {/* Season Selector */}
      <FormControl fullWidth>
        <InputLabel>Season</InputLabel>
        <Select
          value={selectedSeason?.id || ''}
          onChange={(e) => handleSeasonChange(e.target.value)}
          label="Season"
        >
          {seasons.map((season) => (
            <MenuItem key={season.id} value={season.id}>
              Season {season.seasonNumber}
              {season.alternateTitle && ` - ${season.alternateTitle}`}
              {' '}
              <Chip 
                label={`${season.totalEpisodes} episodes`} 
                size="small" 
                sx={{ ml: 1 }}
              />
            </MenuItem>
          ))}
        </Select>
      </FormControl>

      {/* Episode Grid */}
      {selectedSeason && (
        <Box>
          <Typography variant="subtitle2" gutterBottom>
            Select Episode
          </Typography>
          
          {loadingEpisodes ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', p: 2 }}>
              <CircularProgress size={24} />
            </Box>
          ) : episodes.length === 0 ? (
            <Alert severity="info">
              No episodes found for this season. Please add episodes first.
            </Alert>
          ) : (
            <Grid container spacing={1}>
              {episodes.map((episode) => {
                const isSelected = selectedEpisode?.id === episode.id;
                
                return (
                  <Grid size={{ xs: 6, sm: 4, md: 3 }} key={episode.id}>
                    <Card 
                      variant={isSelected ? "elevation" : "outlined"}
                      sx={{ 
                        bgcolor: isSelected ? 'primary.main' : 'background.paper',
                        color: isSelected ? 'primary.contrastText' : 'text.primary',
                        transition: 'all 0.2s',
                        '&:hover': {
                          boxShadow: 3
                        }
                      }}
                    >
                      <CardActionArea onClick={() => handleEpisodeClick(episode)}>
                        <CardContent sx={{ p: 1.5 }}>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                            {isSelected ? (
                              <CheckCircle fontSize="small" />
                            ) : (
                              <RadioButtonUnchecked fontSize="small" />
                            )}
                            <Typography variant="body2" fontWeight="bold">
                              E{episode.episodeNumber.toString().padStart(2, '0')}
                            </Typography>
                          </Box>
                          <Typography 
                            variant="caption" 
                            sx={{ 
                              display: '-webkit-box',
                              WebkitLineClamp: 2,
                              WebkitBoxOrient: 'vertical',
                              overflow: 'hidden',
                              lineHeight: 1.3
                            }}
                          >
                            {episode.title}
                          </Typography>
                        </CardContent>
                      </CardActionArea>
                    </Card>
                  </Grid>
                );
              })}
            </Grid>
          )}
        </Box>
      )}
    </Stack>
  );
}
