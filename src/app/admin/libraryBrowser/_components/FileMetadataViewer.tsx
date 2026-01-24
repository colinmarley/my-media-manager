/**
 * FileMetadataViewer Component
 * Displays comprehensive technical specifications for media files
 * Shows video codec, resolution, audio tracks, subtitle tracks, and file info
 */

import React from 'react';
import {
  Box,
  Typography,
  Chip,
  Divider,
  Grid,
  Paper,
  Stack,
  Accordion,
  AccordionSummary,
  AccordionDetails,
} from '@mui/material';
import {
  ExpandMore,
  Videocam,
  Audiotrack,
  Subtitles,
  FolderOpen,
  HighQuality,
  Hd,
  FourK,
} from '@mui/icons-material';
import { MediaFile, AudioTrack as AudioTrackType, SubtitleTrack, VideoMetadata } from '@/types/library';

interface FileMetadataViewerProps {
  file: MediaFile | null;
  compact?: boolean;
}

export default function FileMetadataViewer({ file, compact = false }: FileMetadataViewerProps) {
  if (!file) {
    return (
      <Box sx={{ p: 2, textAlign: 'center', color: 'text.secondary' }}>
        <Typography variant="body2">No file selected</Typography>
      </Box>
    );
  }

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  };

  const formatDuration = (milliseconds: number | null | undefined): string => {
    if (!milliseconds) return 'Unknown';
    const seconds = Math.floor(milliseconds / 1000);
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    
    if (hours > 0) {
      return `${hours}h ${minutes}m ${secs}s`;
    }
    return `${minutes}m ${secs}s`;
  };

  const formatBitrate = (bitrate: number | null | undefined): string => {
    if (!bitrate) return 'Unknown';
    if (bitrate < 1000) return `${bitrate} bps`;
    if (bitrate < 1000000) return `${(bitrate / 1000).toFixed(0)} kbps`;
    return `${(bitrate / 1000000).toFixed(2)} Mbps`;
  };

  const getResolutionIcon = (resolutionLabel: string | undefined) => {
    switch (resolutionLabel) {
      case '4K':
      case '8K':
        return <FourK fontSize="small" />;
      case '1080p':
      case '1440p':
        return <Hd fontSize="small" />;
      case '720p':
        return <HighQuality fontSize="small" />;
      default:
        return <Videocam fontSize="small" />;
    }
  };

  const renderVideoMetadata = (video: VideoMetadata) => (
    <Accordion defaultExpanded={!compact}>
      <AccordionSummary expandIcon={<ExpandMore />}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          {getResolutionIcon(video.resolutionLabel)}
          <Typography variant="subtitle1">Video Track</Typography>
          {video.resolutionLabel && (
            <Chip label={video.resolutionLabel} size="small" color="primary" />
          )}
          {video.hdr && video.hdrFormat && (
            <Chip label={video.hdrFormat} size="small" color="secondary" />
          )}
          {video.is3D && (
            <Chip label="3D" size="small" color="info" />
          )}
        </Box>
      </AccordionSummary>
      <AccordionDetails>
        <Grid container spacing={2}>
          <Grid size={6}>
            <Typography variant="caption" color="text.secondary">Codec</Typography>
            <Typography variant="body2">{video.codec || 'Unknown'}</Typography>
          </Grid>
          <Grid size={6}>
            <Typography variant="caption" color="text.secondary">Container</Typography>
            <Typography variant="body2">{video.containerFormat || 'N/A'}</Typography>
          </Grid>
          <Grid size={6}>
            <Typography variant="caption" color="text.secondary">Resolution</Typography>
            <Typography variant="body2">{video.resolution || 'Unknown'}</Typography>
          </Grid>
          <Grid size={6}>
            <Typography variant="caption" color="text.secondary">Aspect Ratio</Typography>
            <Typography variant="body2">{video.aspectRatio || 'N/A'}</Typography>
          </Grid>
          <Grid size={6}>
            <Typography variant="caption" color="text.secondary">Frame Rate</Typography>
            <Typography variant="body2">
              {video.frameRate ? `${video.frameRate} fps` : 'Unknown'}
            </Typography>
          </Grid>
          <Grid size={6}>
            <Typography variant="caption" color="text.secondary">Bitrate</Typography>
            <Typography variant="body2">{formatBitrate(video.bitrate)}</Typography>
          </Grid>
          {video.colorSpace && (
            <Grid size={6}>
              <Typography variant="caption" color="text.secondary">Color Space</Typography>
              <Typography variant="body2">{video.colorSpace}</Typography>
            </Grid>
          )}
          {video.hdr && video.hdrFormat && (
            <Grid size={6}>
              <Typography variant="caption" color="text.secondary">HDR Format</Typography>
              <Typography variant="body2">{video.hdrFormat}</Typography>
            </Grid>
          )}
          {video.is3D && video.format3D && (
            <Grid size={6}>
              <Typography variant="caption" color="text.secondary">3D Format</Typography>
              <Typography variant="body2">{video.format3D}</Typography>
            </Grid>
          )}
        </Grid>
      </AccordionDetails>
    </Accordion>
  );

  const renderAudioTracks = (audioTracks: AudioTrackType[]) => (
    <Accordion>
      <AccordionSummary expandIcon={<ExpandMore />}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Audiotrack fontSize="small" />
          <Typography variant="subtitle1">
            Audio Tracks ({audioTracks.length})
          </Typography>
        </Box>
      </AccordionSummary>
      <AccordionDetails>
        <Stack spacing={2}>
          {audioTracks.map((track, index) => (
            <Paper key={index} variant="outlined" sx={{ p: 2 }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                <Typography variant="subtitle2">
                  Track {track.index ?? index + 1}
                  {track.title && ` - ${track.title}`}
                </Typography>
                <Box sx={{ display: 'flex', gap: 0.5 }}>
                  {track.isDefault && <Chip label="Default" size="small" color="primary" />}
                  {track.isForced && <Chip label="Forced" size="small" color="warning" />}
                </Box>
              </Box>
              <Grid container spacing={1}>
                <Grid size={6}>
                  <Typography variant="caption" color="text.secondary">Codec</Typography>
                  <Typography variant="body2">{track.codec || 'Unknown'}</Typography>
                </Grid>
                <Grid size={6}>
                  <Typography variant="caption" color="text.secondary">Language</Typography>
                  <Typography variant="body2">
                    {track.languageName || track.language || 'Unknown'}
                  </Typography>
                </Grid>
                <Grid size={6}>
                  <Typography variant="caption" color="text.secondary">Channels</Typography>
                  <Typography variant="body2">
                    {track.channelsLayout || track.channels || 'Unknown'}
                  </Typography>
                </Grid>
                <Grid size={6}>
                  <Typography variant="caption" color="text.secondary">Bitrate</Typography>
                  <Typography variant="body2">{formatBitrate(track.bitrate)}</Typography>
                </Grid>
                {track.sampleRate && (
                  <Grid size={6}>
                    <Typography variant="caption" color="text.secondary">Sample Rate</Typography>
                    <Typography variant="body2">{track.sampleRate} Hz</Typography>
                  </Grid>
                )}
              </Grid>
            </Paper>
          ))}
        </Stack>
      </AccordionDetails>
    </Accordion>
  );

  const renderSubtitleTracks = (subtitleTracks: SubtitleTrack[]) => (
    <Accordion>
      <AccordionSummary expandIcon={<ExpandMore />}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Subtitles fontSize="small" />
          <Typography variant="subtitle1">
            Subtitle Tracks ({subtitleTracks.length})
          </Typography>
        </Box>
      </AccordionSummary>
      <AccordionDetails>
        <Stack spacing={1}>
          {subtitleTracks.map((track, index) => (
            <Paper key={index} variant="outlined" sx={{ p: 1.5 }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Box>
                  <Typography variant="body2">
                    {track.languageName || track.language || 'Unknown'}
                    {track.title && ` - ${track.title}`}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {track.format}
                  </Typography>
                </Box>
                <Box sx={{ display: 'flex', gap: 0.5 }}>
                  {track.isSDH && <Chip label="SDH" size="small" />}
                  {track.isForced && <Chip label="Forced" size="small" color="warning" />}
                  {track.isDefault && <Chip label="Default" size="small" color="primary" />}
                  {track.isExternal && <Chip label="External" size="small" color="info" />}
                </Box>
              </Box>
            </Paper>
          ))}
        </Stack>
      </AccordionDetails>
    </Accordion>
  );

  const renderFileInfo = () => (
    <Accordion>
      <AccordionSummary expandIcon={<ExpandMore />}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <FolderOpen fontSize="small" />
          <Typography variant="subtitle1">File Information</Typography>
        </Box>
      </AccordionSummary>
      <AccordionDetails>
        <Grid container spacing={2}>
          <Grid size={12}>
            <Typography variant="caption" color="text.secondary">Path</Typography>
            <Typography variant="body2" sx={{ wordBreak: 'break-all' }}>
              {file.filePath}
            </Typography>
          </Grid>
          <Grid size={6}>
            <Typography variant="caption" color="text.secondary">File Size</Typography>
            <Typography variant="body2">{file.fileSizeFormatted || formatFileSize(file.fileSize)}</Typography>
          </Grid>
          <Grid size={6}>
            <Typography variant="caption" color="text.secondary">Extension</Typography>
            <Typography variant="body2">{file.fileExtension || 'Unknown'}</Typography>
          </Grid>
          {file.videoMetadata?.duration && (
            <Grid size={6}>
              <Typography variant="caption" color="text.secondary">Duration</Typography>
              <Typography variant="body2">{file.videoMetadata.durationFormatted || formatDuration(file.videoMetadata.duration * 1000)}</Typography>
            </Grid>
          )}
          {file.videoMetadata?.bitrate && (
            <Grid size={6}>
              <Typography variant="caption" color="text.secondary">Video Bitrate</Typography>
              <Typography variant="body2">{formatBitrate(file.videoMetadata.bitrate * 1000)}</Typography>
            </Grid>
          )}
          {file.checksum && (
            <Grid size={12}>
              <Typography variant="caption" color="text.secondary">Checksum (SHA256)</Typography>
              <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>
                {file.checksum}
              </Typography>
            </Grid>
          )}
        </Grid>
      </AccordionDetails>
    </Accordion>
  );

  return (
    <Box>
      {file.videoMetadata && renderVideoMetadata(file.videoMetadata)}
      {file.audioTracks && file.audioTracks.length > 0 && renderAudioTracks(file.audioTracks)}
      {file.subtitleTracks && file.subtitleTracks.length > 0 && renderSubtitleTracks(file.subtitleTracks)}
      {renderFileInfo()}
    </Box>
  );
}
