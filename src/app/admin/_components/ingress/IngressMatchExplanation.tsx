'use client';

import React from 'react';
import { Box, Tooltip, Typography } from '@mui/material';
import type { IngressQueueItem } from '@/service/ingress/IngressAutomationService';
import { isAwaitingDestination } from '@/service/ingress/ingressQueueModel';

/**
 * Why a queue item got the decision it has: how the best match scored, which alternatives were
 * considered, how the filename was parsed, why it is held for review and where it would go.
 * All of it already comes back from the API; this is the one place that renders it.
 */
export const IngressMatchExplanation: React.FC<{ item: IngressQueueItem }> = ({ item }) => {
  const best = item.best_match;
  const candidates = item.match_candidates || [];
  const parsed = item.parsed_info || {};
  const notes = parsed.parse_notes || [];
  const alternatives = candidates.filter(
    (candidate) => !best || candidate.media_id !== best.media_id || candidate.source !== best.source,
  );

  return (
    <Box sx={{ maxWidth: 420, fontSize: 12 }}>
      <Typography variant="caption" component="div" sx={{ fontWeight: 600 }}>
        {best?.title ? `Best match: ${best.title}${best.year ? ` (${best.year})` : ''}` : 'No match'}
        {best?.source ? ` · ${best.source}` : ''}
        {best?.imdb_id ? ` · ${best.imdb_id}` : ''}
      </Typography>
      {best?.score_breakdown && best.score_breakdown.length > 0 && (
        <Box component="ul" sx={{ m: 0, pl: 2 }}>
          {best.score_breakdown.map((entry, index) => (
            <li key={`${entry.rule}-${index}`}>
              {entry.rule.replace(/_/g, ' ')}
              {entry.points ? ` ${entry.points > 0 ? '+' : ''}${entry.points}` : ''}
              {entry.note ? ` — ${entry.note}` : ''}
            </li>
          ))}
        </Box>
      )}
      {!best?.score_breakdown?.length && best?.match_reason && (
        <Typography variant="caption" component="div">{best.match_reason}</Typography>
      )}
      {alternatives.length > 0 && (
        <>
          <Typography variant="caption" component="div" sx={{ fontWeight: 600, mt: 1 }}>
            Other candidates
          </Typography>
          <Box component="ul" sx={{ m: 0, pl: 2 }}>
            {alternatives.map((candidate, index) => (
              <li key={`${candidate.source}-${candidate.media_id || index}`}>
                {candidate.title}
                {candidate.year ? ` (${candidate.year})` : ''} — {candidate.confidence_score ?? '?'}
                {candidate.source ? ` · ${candidate.source}` : ''}
              </li>
            ))}
          </Box>
        </>
      )}
      <Typography variant="caption" component="div" sx={{ fontWeight: 600, mt: 1 }}>
        Parsed
      </Typography>
      <Typography variant="caption" component="div">
        {parsed.media_type || 'unknown'}
        {parsed.title ? ` · "${parsed.title}"` : ''}
        {parsed.year ? ` (${parsed.year})` : ''}
        {parsed.season != null ? ` · S${String(parsed.season).padStart(2, '0')}` : ''}
        {parsed.episode != null ? `E${String(parsed.episode).padStart(2, '0')}` : ''}
        {parsed.parse_quality != null ? ` · parse quality ${parsed.parse_quality}` : ''}
        {parsed.title_source ? ` · title from ${parsed.title_source}` : ''}
      </Typography>
      {notes.length > 0 && (
        <Box component="ul" sx={{ m: 0, pl: 2 }}>
          {notes.map((note, index) => (
            <li key={index}>{note}</li>
          ))}
        </Box>
      )}
      {/* The folder view has fixed-height rows with no room for captions, so the hold reason and the
          destination are repeated here. */}
      {parsed.review_reason && (
        <Typography variant="caption" component="div" sx={{ mt: 1 }}>
          Held for review: {parsed.review_reason}
        </Typography>
      )}
      {item.proposed_path ? (
        <Typography variant="caption" component="div" sx={{ mt: 1, wordBreak: 'break-all' }}>
          Destination: {item.proposed_path}
        </Typography>
      ) : isAwaitingDestination(item) ? (
        <Typography variant="caption" component="div" sx={{ mt: 1 }}>
          No destination yet, stays in place
        </Typography>
      ) : null}
    </Box>
  );
};

/** A confidence figure that explains itself on hover. */
export const IngressConfidenceWithExplanation: React.FC<{
  item: IngressQueueItem;
  children: React.ReactNode;
}> = ({ item, children }) => (
  <Tooltip arrow placement="left" title={<IngressMatchExplanation item={item} />}>
    <Box component="span" sx={{ cursor: 'help', textDecoration: 'underline dotted' }}>
      {children}
    </Box>
  </Tooltip>
);

export default IngressMatchExplanation;
