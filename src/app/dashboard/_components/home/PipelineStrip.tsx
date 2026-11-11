'use client';

import React from 'react';
import Link from 'next/link';
import { Box, Paper, Skeleton, Typography } from '@mui/material';
import { ChevronRight } from '@mui/icons-material';
import type { PipelineStage } from '@/service/home/homeOverviewModel';
import { borders, status as statusColors, surfaces, text } from '@/theme/tokens';

export interface PipelineStripProps {
  stages: PipelineStage[];
  loading: boolean;
  /** Where the "Needs review" stage links to. */
  reviewHref: string;
}

/**
 * Detected → Matched → Needs review → Organized → In library, as one strip.
 * The stage that needs attention is tinted; everything else stays quiet.
 */
const PipelineStrip: React.FC<PipelineStripProps> = ({ stages, loading, reviewHref }) => (
  <Paper
    variant="outlined"
    component="ol"
    aria-label="Ingest pipeline"
    sx={{
      listStyle: 'none',
      m: 0,
      p: 0,
      display: 'grid',
      gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', sm: 'repeat(3, minmax(0, 1fr))', md: 'repeat(5, minmax(0, 1fr))' },
      overflow: 'hidden',
    }}
  >
    {stages.map((stage, index) => {
      const tone = stage.tone !== 'neutral' ? statusColors[stage.tone] : null;
      const isReview = stage.id === 'needsReview' && Boolean(stage.count);
      const content = (
        <>
          <Typography variant="body2" color="text.secondary" component="span" sx={{ display: 'block' }}>
            {stage.label}
          </Typography>
          <Typography
            component="span"
            sx={{
              display: 'block',
              mt: 0.5,
              fontSize: '2rem',
              lineHeight: '40px',
              fontWeight: 600,
              fontVariantNumeric: 'tabular-nums',
              color: tone ? tone.fg : stage.count ? text.primary : text.disabled,
            }}
          >
            {loading ? <Skeleton width={48} /> : stage.count === null ? '—' : stage.count.toLocaleString()}
          </Typography>
          <Typography variant="caption" color="text.secondary" component="span" sx={{ display: 'block', mt: 0.5 }}>
            {stage.description}
          </Typography>
        </>
      );

      return (
        <Box
          component="li"
          key={stage.id}
          data-stage={stage.id}
          aria-label={`${stage.label}: ${stage.count ?? 'unavailable'}`}
          sx={{
            position: 'relative',
            borderLeft: { md: index === 0 ? 'none' : `1px solid ${borders.subtle}` },
            borderTop: tone ? `2px solid ${tone.fg}` : '2px solid transparent',
            bgcolor: tone ? tone.bg : 'transparent',
          }}
        >
          {index > 0 && (
            <Box
              aria-hidden
              sx={{
                display: { xs: 'none', md: 'flex' },
                position: 'absolute',
                left: -11,
                top: '50%',
                transform: 'translateY(-50%)',
                width: 20,
                height: 20,
                borderRadius: '50%',
                alignItems: 'center',
                justifyContent: 'center',
                bgcolor: surfaces.paper,
                border: `1px solid ${borders.subtle}`,
                color: text.disabled,
                zIndex: 1,
              }}
            >
              <ChevronRight sx={{ fontSize: 16 }} />
            </Box>
          )}
          {isReview ? (
            <Box
              component={Link}
              href={reviewHref}
              sx={{
                display: 'block',
                height: '100%',
                px: 2.5,
                py: 2,
                color: 'inherit',
                textDecoration: 'none',
                '&:hover': { bgcolor: surfaces.raised },
                '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: -2 },
              }}
            >
              {content}
            </Box>
          ) : (
            <Box sx={{ px: 2.5, py: 2 }}>{content}</Box>
          )}
        </Box>
      );
    })}
  </Paper>
);

export default PipelineStrip;
