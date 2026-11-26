'use client';

import React, { useEffect, useRef, useState } from 'react';
import {
  Box, Button, FormControl, InputLabel, MenuItem, Select, Slider, Stack, Typography,
} from '@mui/material';
import ExtrasReviewService from '@/service/library/ExtrasReviewService';
import { ExtraAudioTrack } from '@/types/library/ExtrasReview.type';

export function formatClock(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(total / 60);
  const secs = String(total % 60).padStart(2, '0');
  return minutes >= 60
    ? `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}:${secs}`
    : `${minutes}:${secs}`;
}

function trackLabel(track: ExtraAudioTrack): string {
  const parts = [
    track.title,
    track.commentary && !/commentary/i.test(track.title ?? '') ? 'Commentary' : null,
    track.language && track.language !== 'und' ? track.language : null,
    track.channels ? `${track.channels}ch` : null,
    track.codec,
  ].filter(Boolean);
  return `Track ${track.index + 1}${parts.length ? ` · ${parts.join(' · ')}` : ''}`;
}

interface ExtraPlayerProps {
  id: string;
  fileName: string;
  /** Where in the file this stream starts, in seconds. */
  start: number;
  /** The length the queue knows, used until the file has been probed. */
  durationSeconds: number | null;
  onJump: (seconds: number) => void;
  onClose: () => void;
}

/**
 * Plays a held extra, transcoded by the backend, for when its frames are not enough to tell the
 * type (a deleted scene or a commentary looks like the episode). The stream cannot be seeked past
 * what has arrived, so the "Jump to" slider and the contact sheet's frames start a new one.
 */
export default function ExtraPlayer({ id, fileName, start, durationSeconds, onJump, onClose }: ExtraPlayerProps) {
  const [tracks, setTracks] = useState<ExtraAudioTrack[]>([]);
  const [probedDuration, setProbedDuration] = useState<number | null>(null);
  const [audio, setAudio] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [dragging, setDragging] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    ExtrasReviewService.playbackInfo(id)
      .then((info) => {
        if (!live) return;
        setTracks(info.audioTracks);
        setProbedDuration(info.durationSeconds);
      })
      .catch(() => { /* The player still works with the first track and the queue's length. */ });
    return () => { live = false; };
  }, [id]);

  // A new stream starts at 0 on the video element's own clock.
  useEffect(() => {
    setElapsed(0);
    setFailed(false);
  }, [start, audio]);

  const duration = probedDuration ?? durationSeconds;
  const position = start + elapsed;
  const src = ExtrasReviewService.previewUrl(id, start, audio);

  // Each stream is a live transcode on the server, and a <video> taken off the page keeps
  // downloading. So the source is set here and let go of on a jump, a track change or close
  // (set here rather than as a prop, so React's dev double-run of effects puts it back).
  const videoRef = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return undefined;
    video.src = src;
    return () => {
      video.removeAttribute('src');
      try {
        video.pause();
        video.load();
      } catch { /* not a real media element (tests) */ }
    };
  }, [src]);

  return (
    <Box sx={{ mb: 1.5 }}>
      <video
        ref={videoRef}
        controls
        autoPlay
        playsInline
        preload="auto"
        aria-label={`Playing ${fileName}`}
        onTimeUpdate={(e) => setElapsed(e.currentTarget.currentTime)}
        onError={() => setFailed(true)}
        style={{ display: 'block', width: '100%', maxHeight: 420, background: '#000', borderRadius: 4 }}
      />
      {failed && (
        <Typography variant="caption" color="error" component="p" sx={{ mt: 0.5 }}>
          This file could not be played.
        </Typography>
      )}

      <Stack direction="row" spacing={2} alignItems="center" flexWrap="wrap" useFlexGap sx={{ mt: 1 }}>
        {duration ? (
          <Stack direction="row" spacing={1.5} alignItems="center" sx={{ flex: '1 1 260px', minWidth: 0 }}>
            <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: 'nowrap' }}>
              {formatClock(dragging ?? position)} / {formatClock(duration)}
            </Typography>
            <Slider
              size="small"
              aria-label="Jump to"
              min={0}
              max={Math.max(1, Math.floor(duration))}
              value={Math.min(dragging ?? position, duration)}
              valueLabelDisplay="auto"
              valueLabelFormat={formatClock}
              onChange={(_, value) => setDragging(value as number)}
              onChangeCommitted={(_, value) => {
                setDragging(null);
                onJump(value as number);
              }}
            />
          </Stack>
        ) : (
          <Typography variant="caption" color="text.secondary" sx={{ flex: '1 1 auto' }}>
            From {formatClock(position)}
          </Typography>
        )}

        {tracks.length > 1 && (
          <FormControl size="small" sx={{ minWidth: 220 }}>
            <InputLabel id={`audio-${id}`}>Audio</InputLabel>
            <Select
              labelId={`audio-${id}`}
              label="Audio"
              value={audio}
              onChange={(e) => {
                // Keep the place: the new track's stream starts where this one is now.
                onJump(position);
                setAudio(Number(e.target.value));
              }}
            >
              {tracks.map((t) => (
                <MenuItem key={t.index} value={t.index}>{trackLabel(t)}</MenuItem>
              ))}
            </Select>
          </FormControl>
        )}

        <Button size="small" onClick={onClose}>Close player</Button>
      </Stack>
    </Box>
  );
}
