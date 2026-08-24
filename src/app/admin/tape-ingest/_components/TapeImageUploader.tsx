'use client';
import React, { useEffect, useRef, useState } from 'react';
import {
  Alert, Box, CircularProgress, IconButton,
  ImageList, ImageListItem, ImageListItemBar,
  Stack, Tooltip, Typography, Button,
} from '@mui/material';
import { Delete as DeleteIcon, Upload as UploadIcon, ZoomIn as ZoomIcon } from '@mui/icons-material';
import TapeIngestService from '@/service/tape-ingest/TapeIngestService';
import { TapeImageInfo } from '@/types/tape-ingest/TapeIngest.type';

interface TapeImageUploaderProps {
  tapeId: string;
}

export default function TapeImageUploader({ tapeId }: TapeImageUploaderProps) {
  const [images, setImages] = useState<TapeImageInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    setLoading(true);
    try {
      setImages(await TapeIngestService.listTapeImages(tapeId));
      setError(null);
    } catch (e) {
      setError('Could not load images.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [tapeId]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;
    setUploading(true);
    setError(null);
    try {
      for (const file of files) {
        await TapeIngestService.uploadTapeImage(tapeId, file);
      }
      await load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Upload failed.');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const handleDelete = async (filename: string) => {
    try {
      await TapeIngestService.deleteTapeImage(tapeId, filename);
      setImages((prev) => prev.filter((img) => img.filename !== filename));
    } catch {
      setError('Delete failed.');
    }
  };

  return (
    <Box sx={{ mt: 1.5 }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
        <Typography variant="caption" color="text.secondary" fontWeight={500}>
          Photos — {tapeId}
        </Typography>
        <Box>
          <input
            ref={fileRef}
            type="file"
            multiple
            accept="image/*"
            style={{ display: 'none' }}
            onChange={handleUpload}
          />
          <Button
            size="small"
            variant="outlined"
            startIcon={uploading ? <CircularProgress size={14} /> : <UploadIcon />}
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            sx={{ fontSize: 11 }}
          >
            {uploading ? 'Uploading…' : 'Add Photos'}
          </Button>
        </Box>
      </Stack>

      {error && <Alert severity="error" sx={{ mb: 1, py: 0 }}>{error}</Alert>}

      {loading ? (
        <Box sx={{ textAlign: 'center', py: 1 }}><CircularProgress size={20} /></Box>
      ) : images.length === 0 ? (
        <Typography variant="caption" color="text.disabled">
          No photos yet. Upload a scan of the tape label and case.
        </Typography>
      ) : (
        <ImageList cols={4} gap={6} sx={{ mt: 0, mb: 0, maxHeight: 220, overflowY: 'auto' }}>
          {images.map((img) => (
            <ImageListItem key={img.filename} sx={{ border: 1, borderColor: 'divider', borderRadius: 1, overflow: 'hidden' }}>
              <Box
                component="img"
                src={img.url}
                alt={img.filename}
                sx={{ width: '100%', height: 90, objectFit: 'cover', display: 'block' }}
              />
              <ImageListItemBar
                sx={{ background: 'rgba(0,0,0,0.6)' }}
                actionIcon={
                  <Stack direction="row">
                    <Tooltip title="Open full size">
                      <IconButton size="small" sx={{ color: 'white' }} onClick={() => window.open(img.url, '_blank')}>
                        <ZoomIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title="Delete">
                      <IconButton size="small" sx={{ color: 'white' }} onClick={() => handleDelete(img.filename)}>
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </Stack>
                }
              />
            </ImageListItem>
          ))}
        </ImageList>
      )}
    </Box>
  );
}
