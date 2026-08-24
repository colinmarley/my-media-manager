'use client';
import React, { useState } from 'react';
import { Box, Button, Card, CardContent, Collapse, Stack, Tooltip, Typography } from '@mui/material';
import {
  TapeIngestItem, HomeVideoMetadata, ContentType, PromoMetadata,
  TapePhysicalMetadata, TapeBrand, TapeCondition, RecordingSpeed,
} from '@/types/tape-ingest/TapeIngest.type';
import { useTapeIngestStore } from '@/store/useTapeIngestStore';
import HomeVideoForm from './HomeVideoForm';
import PromoMetadataForm from './PromoMetadataForm';
import ContentTypeSelector from './ContentTypeSelector';
import FileMetadataChips from './FileMetadataChips';
import TapePhysicalMetadataForm from './TapePhysicalMetadataForm';
import TapeIngestService from '@/service/tape-ingest/TapeIngestService';
import { buildDestinationPreview } from './destinationUtils';

const DEFAULT_HOME_VIDEO: HomeVideoMetadata = { title: '', dateMode: 'exact', dateApproximate: false, people: [] };
const DEFAULT_PROMO: PromoMetadata = { title: '', targetType: 'company', targetName: '' };

function itemToPhysicalMeta(item: TapeIngestItem): TapePhysicalMetadata {
  return {
    brand: item.tapeBrand ?? 'Unknown',
    condition: item.tapeCondition ?? 'unknown',
    recordingSpeed: item.recordingSpeed ?? 'unknown',
    labelNotes: item.labelNotes ?? '',
  };
}

interface Props {
  item: TapeIngestItem;
  onMovieAssign: (filePath: string) => void;
  onTvShowAssign: (filePath: string) => void;
}

export default function TapeIngestFileCard({ item, onMovieAssign, onTvShowAssign }: Props) {
  const {
    updateItemContentType, updateItemHomeVideoMetadata, updateItemPromoMetadata,
    updateItemPhysicalMeta, updateItemTapeId, destinationBase,
  } = useTapeIngestStore();

  const [homeVideoExpanded, setHomeVideoExpanded] = useState(false);
  const [trailerExpanded, setTrailerExpanded] = useState(false);
  const [commercialExpanded, setCommercialExpanded] = useState(false);
  const [tapeDetailsExpanded, setTapeDetailsExpanded] = useState(false);
  const [homeVideoMeta, setHomeVideoMeta] = useState<HomeVideoMetadata>(
    item.homeVideoMetadata ?? { ...DEFAULT_HOME_VIDEO }
  );
  const [trailerMeta, setTrailerMeta] = useState<PromoMetadata>(
    item.promoMetadata ?? { ...DEFAULT_PROMO }
  );
  const [commercialMeta, setCommercialMeta] = useState<PromoMetadata>(
    item.promoMetadata ?? { ...DEFAULT_PROMO }
  );

  const collapseAll = () => {
    setHomeVideoExpanded(false);
    setTrailerExpanded(false);
    setCommercialExpanded(false);
  };

  const handleContentType = (type: ContentType) => {
    collapseAll();
    if (type === 'movie') { onMovieAssign(item.filePath); return; }
    if (type === 'tv_show') { onTvShowAssign(item.filePath); return; }
    if (type === 'home_video') { setHomeVideoExpanded(true); updateItemContentType(item.filePath, 'home_video'); return; }
    if (type === 'trailer') { setTrailerExpanded(true); updateItemPromoMetadata(item.filePath, trailerMeta, 'trailer'); return; }
    if (type === 'commercial') { setCommercialExpanded(true); updateItemPromoMetadata(item.filePath, commercialMeta, 'commercial'); return; }
    updateItemContentType(item.filePath, type);
  };

  const handlePhysicalMetaChange = (meta: TapePhysicalMetadata) => {
    updateItemPhysicalMeta(
      item.filePath,
      meta.brand as TapeBrand,
      meta.condition as TapeCondition,
      meta.recordingSpeed as RecordingSpeed,
      meta.labelNotes,
    );
  };

  const statusLabel =
    item.contentType === 'movie' && item.movieMetadata
      ? `${item.movieMetadata.title} (${item.movieMetadata.year})`
      : item.contentType === 'tv_show' && item.tvShowMetadata
      ? `${item.tvShowMetadata.seriesTitle} S${String(item.tvShowMetadata.seasonNumber).padStart(2,'0')}E${String(item.tvShowMetadata.episodeNumber).padStart(2,'0')}`
      : (item.contentType === 'trailer' || item.contentType === 'commercial') && item.promoMetadata
      ? `${item.promoMetadata.title} (${item.promoMetadata.targetType}: ${item.promoMetadata.targetName})`
      : item.contentType.replace('_', ' ');

  const destinationPreview = buildDestinationPreview(item, destinationBase);
  const thumbUrl = TapeIngestService.getThumbnailUrl(item.filePath);

  const tapeDetailsSummary = [
    item.tapeId || null,
    item.tapeBrand && item.tapeBrand !== 'Unknown' ? item.tapeBrand : null,
    item.tapeCondition && item.tapeCondition !== 'unknown'
      ? item.tapeCondition.charAt(0).toUpperCase() + item.tapeCondition.slice(1) : null,
    item.recordingSpeed && item.recordingSpeed !== 'unknown' ? item.recordingSpeed.toUpperCase() : null,
  ].filter(Boolean).join(' · ');

  return (
    <Card variant="outlined" sx={{ mb: 2 }}>
      <CardContent sx={{ pb: '12px !important' }}>
        <Stack direction="row" spacing={2} alignItems="flex-start">
          <Box
            component="img"
            src={thumbUrl}
            alt={item.fileName}
            sx={{ width: 120, height: 80, objectFit: 'cover', borderRadius: 1, flexShrink: 0, bgcolor: 'action.hover' }}
            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
          />
          <Box flex={1} minWidth={0}>
            <Tooltip title={item.filePath}>
              <Typography variant="subtitle2" noWrap sx={{ mb: 0.5, cursor: 'default' }}>
                {item.fileName}
              </Typography>
            </Tooltip>
            <FileMetadataChips item={item} />
            <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" gap={1}>
              <ContentTypeSelector
                selected={item.contentType}
                statusLabel={statusLabel}
                onSelect={handleContentType}
              />
            </Stack>
            <Box sx={{ mt: 1 }}>
              <Button
                size="small"
                variant="text"
                onClick={() => setTapeDetailsExpanded((v) => !v)}
                sx={{ textTransform: 'none', px: 0, color: 'text.secondary', fontSize: 12 }}
              >
                {tapeDetailsExpanded ? '▲ Hide tape details' : '▼ Tape details'}
                {tapeDetailsSummary && !tapeDetailsExpanded && (
                  <Typography component="span" variant="caption" sx={{ ml: 1, color: 'text.secondary' }}>
                    ({tapeDetailsSummary})
                  </Typography>
                )}
              </Button>
            </Box>
          </Box>
        </Stack>

        {/* Per-file physical metadata + tape ID + image uploader */}
        <Collapse in={tapeDetailsExpanded} unmountOnExit>
          <TapePhysicalMetadataForm
            value={itemToPhysicalMeta(item)}
            tapeType="vhs"
            tapeId={item.tapeId ?? ''}
            onChange={handlePhysicalMetaChange}
            onTapeIdChange={(id) => updateItemTapeId(item.filePath, id)}
          />
        </Collapse>

        <Collapse in={homeVideoExpanded} unmountOnExit>
          <Box sx={{ mt: 1, pl: '136px' }}>
            <HomeVideoForm
              value={homeVideoMeta}
              onChange={(m) => { setHomeVideoMeta(m); updateItemHomeVideoMetadata(item.filePath, m); }}
            />
          </Box>
        </Collapse>
        <Collapse in={trailerExpanded} unmountOnExit>
          <Box sx={{ mt: 1, pl: '136px' }}>
            <PromoMetadataForm
              value={trailerMeta}
              type="trailer"
              onChange={(m) => { setTrailerMeta(m); updateItemPromoMetadata(item.filePath, m, 'trailer'); }}
            />
          </Box>
        </Collapse>
        <Collapse in={commercialExpanded} unmountOnExit>
          <Box sx={{ mt: 1, pl: '136px' }}>
            <PromoMetadataForm
              value={commercialMeta}
              type="commercial"
              onChange={(m) => { setCommercialMeta(m); updateItemPromoMetadata(item.filePath, m, 'commercial'); }}
            />
          </Box>
        </Collapse>

        {item.contentType !== 'unclassified' && destinationPreview && (
          <Box sx={{ mt: 1, ml: '136px', p: 1, bgcolor: 'action.hover', borderRadius: 1 }}>
            <Typography variant="caption" color="text.secondary">Destination preview:</Typography>
            <Typography variant="body2" sx={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>
              {destinationPreview}
            </Typography>
          </Box>
        )}
      </CardContent>
    </Card>
  );
}
