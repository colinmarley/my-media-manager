import { useEffect, useState } from 'react';

import { PLACEHOLDER_POSTER } from '@/service/library/mediaDetailModel';

interface Params {
  mediaTypeFromRoute?: string;
  mediaIdFromRoute?: string;
  currentPosterSource: string;
}

type PosterSourceStatus = { type: 'success' | 'error'; message: string } | null;

/**
 * Poster gallery paging plus the "poster source" URL editor. They share state because saving a
 * new source re-counts the cached images and jumps to the freshly fetched one.
 */
const useMediaPoster = ({ mediaTypeFromRoute, mediaIdFromRoute, currentPosterSource }: Params) => {
  const [posterIndex, setPosterIndex] = useState(0);
  const [posterCount, setPosterCount] = useState(1);
  const [posterRefreshAttempted, setPosterRefreshAttempted] = useState(false);
  const [posterLoadFailed, setPosterLoadFailed] = useState(false);
  const [posterSourceInput, setPosterSourceInput] = useState('');
  const [posterSourceSaving, setPosterSourceSaving] = useState(false);
  const [posterSourceStatus, setPosterSourceStatus] = useState<PosterSourceStatus>(null);
  const [posterCacheBust, setPosterCacheBust] = useState(() => Date.now());

  useEffect(() => {
    if (!mediaTypeFromRoute || !mediaIdFromRoute) return;
    setPosterIndex(0);
    setPosterRefreshAttempted(false);
    setPosterLoadFailed(false);
    fetch(`/api/backend/api/posters/${mediaTypeFromRoute}/${encodeURIComponent(mediaIdFromRoute)}/list`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => { if (data?.count > 0) setPosterCount(data.count); })
      .catch(() => {});
  }, [mediaTypeFromRoute, mediaIdFromRoute]);

  const handlePosterLoadError = async (img: HTMLImageElement) => {
    if (!mediaTypeFromRoute || !mediaIdFromRoute || posterRefreshAttempted) {
      setPosterLoadFailed(true);
      img.onerror = null;
      img.src = PLACEHOLDER_POSTER;
      return;
    }

    setPosterRefreshAttempted(true);

    try {
      const response = await fetch(
        `/api/backend/api/posters/${mediaTypeFromRoute}/${encodeURIComponent(mediaIdFromRoute)}/refresh`,
        {
          method: 'POST',
          credentials: 'include',
        }
      );

      if (response.ok) {
        setPosterLoadFailed(false);
        img.src = `/api/backend/api/posters/${mediaTypeFromRoute}/${encodeURIComponent(mediaIdFromRoute)}?index=${posterIndex}&retry=${Date.now()}`;
        fetch(`/api/backend/api/posters/${mediaTypeFromRoute}/${encodeURIComponent(mediaIdFromRoute)}/list`)
          .then((r) => (r.ok ? r.json() : null))
          .then((data) => {
            if (data?.count > 0) {
              setPosterCount(data.count);
            }
          })
          .catch(() => {});
        return;
      }
    } catch {
      // Fallback below
    }

    setPosterLoadFailed(true);
    img.onerror = null;
    img.src = PLACEHOLDER_POSTER;
  };

  useEffect(() => {
    setPosterSourceInput(currentPosterSource);
    setPosterSourceStatus(null);
  }, [currentPosterSource]);

  const handlePosterSourceUpdate = async () => {
    if (!mediaTypeFromRoute || !mediaIdFromRoute) {
      return;
    }

    const sourceUrl = posterSourceInput.trim();
    if (!/^https?:\/\//i.test(sourceUrl)) {
      setPosterSourceStatus({ type: 'error', message: 'Enter a full http or https poster image URL.' });
      return;
    }

    setPosterSourceSaving(true);
    setPosterSourceStatus(null);

    try {
      const response = await fetch(
        `/api/backend/api/posters/${mediaTypeFromRoute}/${encodeURIComponent(mediaIdFromRoute)}/source`,
        {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sourceUrl }),
        }
      );

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.detail ?? 'Poster source update failed.');
      }

      const totalPosters = typeof data.total_posters === 'number' && data.total_posters > 0
        ? data.total_posters
        : 1;
      const activeIndex = typeof data.activeIndex === 'number' ? data.activeIndex : totalPosters - 1;

      setPosterCount(totalPosters);
      setPosterIndex(Math.max(0, activeIndex));
      setPosterLoadFailed(false);
      setPosterRefreshAttempted(false);
      setPosterCacheBust(Date.now());
      setPosterSourceStatus({ type: 'success', message: data.message ?? 'Poster source updated.' });
    } catch (err) {
      setPosterSourceStatus({
        type: 'error',
        message: err instanceof Error ? err.message : 'Poster source update failed.',
      });
    } finally {
      setPosterSourceSaving(false);
    }
  };

  return {
    posterIndex,
    posterCount,
    posterLoadFailed,
    posterCacheBust,
    setPosterIndex,
    handlePosterLoadError,
    posterSourceInput,
    setPosterSourceInput,
    posterSourceSaving,
    posterSourceStatus,
    handlePosterSourceUpdate,
  };
};

export default useMediaPoster;
