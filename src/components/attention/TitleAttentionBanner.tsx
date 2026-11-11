'use client';

import React from 'react';
import Link from 'next/link';
import { Alert, Button } from '@mui/material';
import { ChecklistOutlined } from '@mui/icons-material';

import useAttentionItems from '@/hooks/attention/useAttentionItems';
import { summarizeItems, todoHref } from '@/service/attention/attentionModel';

interface Props {
  /** The title's catalog type ('movie' | 'series'); nothing loads until it is known. */
  catalogType: string | null;
  mediaId: string | null;
  /** Bump to refetch (e.g. after the page renamed or flagged a file). */
  refreshKey?: unknown;
}

/**
 * The title page's To-Do summary: "2 files need renaming · 1 flagged for a second look", with a
 * link to the To-Do list filtered to this title. Renders nothing when the title has no items
 * or the server has no To-Do list.
 */
const TitleAttentionBanner = ({ catalogType, mediaId, refreshKey }: Props) => {
  const enabled = Boolean(catalogType && mediaId);
  const { items, refetch, unsupported, error } = useAttentionItems({
    mediaType: catalogType,
    mediaId,
    pageSize: 500,
    enabled,
  });

  const first = React.useRef(true);
  React.useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (enabled) void refetch();
    // Only a change of refreshKey triggers this; the initial load is the hook's own.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  if (!enabled || unsupported || error || items.length === 0) return null;
  const text = summarizeItems(items);

  return (
    <Alert
      severity="warning"
      icon={<ChecklistOutlined fontSize="small" />}
      sx={{ mt: 2, py: 0.25, alignItems: 'center' }}
      action={(
        <Button color="inherit" size="small" component={Link} href={todoHref({ mediaType: catalogType, mediaId })}>
          Open To-Do
        </Button>
      )}
    >
      {text}
    </Alert>
  );
};

export default TitleAttentionBanner;
