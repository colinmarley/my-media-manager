'use client';

import { Alert, Box, Grid, Typography } from '@mui/material';
import { useParams } from 'next/navigation';
import { useCallback, useState } from 'react';

import DiskReassignDialog from '../../_components/DiskReassignDialog';
import MediaAssociatedFilesCard from '../../_components/detail/MediaAssociatedFilesCard';
import MediaDetailHeaderBar from '../../_components/detail/MediaDetailHeaderBar';
import MediaOverviewCard from '../../_components/detail/MediaOverviewCard';
import MediaProcessingSummaryCard from '../../_components/detail/MediaProcessingSummaryCard';
import CatalogMetadataCard, { NfoMetadataCard } from '../../_components/detail/MetadataCards';
import PosterGalleryCard from '../../_components/detail/PosterGalleryCard';
import PosterToolsCard from '../../_components/detail/PosterToolsCard';
import RemoveFromLibraryDialog from '../../_components/detail/RemoveFromLibraryDialog';
import EpisodeAssignDialog from '../../_components/detail/EpisodeAssignDialog';
import ReassignFilesDialog from '../../_components/ReassignFilesDialog';
import styles from '../../_components/detail/mediaDetailStyles';
import useMediaDetailRecord from '@/hooks/library/useMediaDetailRecord';
import useMediaFolderFiles from '@/hooks/library/useMediaFolderFiles';
import useMediaEffectiveness from '@/hooks/library/useMediaEffectiveness';
import useNfoFromDisk from '@/hooks/library/useNfoFromDisk';
import useMediaPoster from '@/hooks/library/useMediaPoster';
import useEpisodeAssignment from '@/hooks/library/useEpisodeAssignment';
import useMediaRemoval from '@/hooks/library/useMediaRemoval';
import useDiskReassign from '@/hooks/library/useDiskReassign';

const LibraryMediaDetailPage = () => {
  const params = useParams<{ mediaType?: string; mediaId?: string }>();
  const mediaTypeFromRoute = params?.mediaType;
  const mediaIdFromRoute = params?.mediaId || '';

  const {
    loading,
    error,
    matchedMedia,
    computed,
    nfoMetadata,
    associatedDiscs,
    associatedTapes,
    mediaLinksLoading,
    processingSummary,
    externalIds,
    folderPath,
    isSeries,
    effectiveFolderPath,
    seriesEpisodeOptions,
    legacyOmdbData,
    currentPosterSource,
  } = useMediaDetailRecord({ mediaTypeFromRoute, mediaIdFromRoute });

  const {
    folderFiles,
    folderFilesLoading,
    seasonFolders,
    selectedSeasonPath,
    setSelectedSeasonPath,
    refreshFolderFiles,
    clearFolderFiles,
  } = useMediaFolderFiles({ effectiveFolderPath, isSeries });

  const { effectiveFileCount, effectiveInLibrary, effectiveProcessingSummary } = useMediaEffectiveness({
    computed,
    processingSummary,
    folderFiles,
  });

  const diskNfoData = useNfoFromDisk({ folderPath, nfoMetadata });

  const {
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
  } = useMediaPoster({ mediaTypeFromRoute, mediaIdFromRoute, currentPosterSource });

  const [selectedDiscIds, setSelectedDiscIds] = useState<Set<string>>(new Set());
  const [reassignOpen, setReassignOpen] = useState(false);
  const [reassignSuccessMsg, setReassignSuccessMsg] = useState<string | null>(null);
  const [diskReassignMsg, setDiskReassignMsg] = useState<string | null>(null);

  const {
    episodeAssignOpen,
    episodeAssignFile,
    episodeAssignSeason,
    setEpisodeAssignSeason,
    episodeAssignEpisode,
    setEpisodeAssignEpisode,
    episodeAssignSaving,
    episodeAssignError,
    episodesForSelectedSeason,
    openEpisodeAssignDialog,
    closeEpisodeAssignDialog,
    selectEpisodeSeason,
    handleEpisodeAssign,
  } = useEpisodeAssignment({
    matchedMedia,
    effectiveFolderPath,
    seriesEpisodeOptions,
    selectedSeasonPath,
    onAssigned: ({ targetDir, message }) => {
      if (targetDir) {
        setSelectedSeasonPath(targetDir);
      }
      setDiskReassignMsg(message);
      refreshFolderFiles(targetDir);
    },
  });

  const { deleteConfirmOpen, setDeleteConfirmOpen, closeDeleteConfirm, deleting, deleteError, handleDelete } =
    useMediaRemoval({ mediaTypeFromRoute, mediaIdFromRoute });

  const {
    diskReassignOpen,
    diskReassignMode,
    diskReassignSource,
    diskReassignLabel,
    openDiskReassign,
    closeDiskReassign,
    handleReassigned,
  } = useDiskReassign({
    onReassigned: ({ mode, newPath }) => {
      setDiskReassignMsg(
        mode === 'folder'
          ? `Folder reassigned. New path: ${newPath}`
          : `File moved to: ${newPath}`
      );
      clearFolderFiles();
      // Keep this details page scoped to the currently viewed media entry.
      // For file reassignments, loading `newPath` here shows destination-title files
      // on the source-title page until a manual reload.
      refreshFolderFiles();
    },
  });

  const toggleDisc = useCallback((discId: string) => {
    setSelectedDiscIds((prev) => {
      const next = new Set(prev);
      if (next.has(discId)) {
        next.delete(discId);
      } else {
        next.add(discId);
      }
      return next;
    });
  }, []);

  const openFolderReassign = () => {
    if (!folderPath) {
      return;
    }

    openDiskReassign('folder', folderPath, folderPath.split('/').pop() || folderPath);
  };

  return (
    <Box sx={styles.page}>
      <MediaDetailHeaderBar
        hasMedia={Boolean(matchedMedia)}
        onRemoveFromLibrary={() => setDeleteConfirmOpen(true)}
      />

      {error && <Alert severity="error">Unable to load details: {error}</Alert>}

      {loading && <Typography>Loading media details...</Typography>}

      {!loading && !matchedMedia && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          This title was not found. It may have been removed or its identifier has changed.
        </Alert>
      )}

      {!loading && mediaTypeFromRoute && mediaIdFromRoute && (
        <PosterToolsCard
          posterSourceInput={posterSourceInput}
          onPosterSourceInputChange={setPosterSourceInput}
          posterSourceSaving={posterSourceSaving}
          posterSourceStatus={posterSourceStatus}
          hasPosterSource={Boolean(currentPosterSource)}
          onSavePosterSource={() => void handlePosterSourceUpdate()}
        />
      )}

      {!loading && matchedMedia && computed && (
        <Grid container spacing={2.5}>
          <Grid size={{ xs: 12, md: 4 }}>
            <PosterGalleryCard
              mediaTypeFromRoute={mediaTypeFromRoute}
              mediaIdFromRoute={mediaIdFromRoute}
              title={matchedMedia.title || ''}
              posterIndex={posterIndex}
              posterCount={posterCount}
              posterLoadFailed={posterLoadFailed}
              posterCacheBust={posterCacheBust}
              setPosterIndex={setPosterIndex}
              onPosterLoadError={(img) => void handlePosterLoadError(img)}
            />
          </Grid>

          <Grid size={{ xs: 12, md: 8 }}>
            <MediaOverviewCard
              media={matchedMedia}
              mediaType={computed.mediaType}
              inLibrary={effectiveInLibrary}
              fileCount={effectiveFileCount}
              folderPath={folderPath}
              externalIds={externalIds}
              legacyImdbId={legacyOmdbData?.imdbID}
            />
          </Grid>

          <Grid size={{ xs: 12 }}>
            <MediaProcessingSummaryCard summary={effectiveProcessingSummary} />
          </Grid>

          <Grid size={{ xs: 12, md: 6 }}>
            <CatalogMetadataCard media={matchedMedia} />
          </Grid>

          <Grid size={{ xs: 12, md: 6 }}>
            <NfoMetadataCard nfoMetadata={nfoMetadata} diskNfoData={diskNfoData} />
          </Grid>

          <Grid size={{ xs: 12 }}>
            <MediaAssociatedFilesCard
              folderPath={folderPath}
              selectedDiscCount={selectedDiscIds.size}
              onOpenReassign={() => setReassignOpen(true)}
              reassignSuccessMsg={reassignSuccessMsg}
              onCloseReassignSuccessMsg={() => setReassignSuccessMsg(null)}
              diskReassignMsg={diskReassignMsg}
              onCloseDiskReassignMsg={() => setDiskReassignMsg(null)}
              associatedDiscs={associatedDiscs}
              associatedTapes={associatedTapes}
              mediaLinksLoading={mediaLinksLoading}
              selectedDiscIds={selectedDiscIds}
              onToggleDisc={toggleDisc}
              folderSection={{
                loading: folderFilesLoading,
                files: folderFiles,
                isSeries,
                seasonFolders,
                selectedSeasonPath,
                onSeasonChange: setSelectedSeasonPath,
                onReassignFolder: openFolderReassign,
                onReassignFile: (path, name) => openDiskReassign('file', path, name),
                onAssignEpisode: openEpisodeAssignDialog,
              }}
            />
          </Grid>
        </Grid>
      )}

      {diskReassignOpen && (
        <DiskReassignDialog
          open={diskReassignOpen}
          mode={diskReassignMode}
          sourcePath={diskReassignSource}
          sourceLabel={diskReassignLabel}
          currentMediaType={mediaTypeFromRoute}
          onClose={closeDiskReassign}
          onReassigned={handleReassigned}
        />
      )}

      {matchedMedia && reassignOpen && (
        <ReassignFilesDialog
          open={reassignOpen}
          fromMediaId={mediaIdFromRoute}
          fromMediaTitle={matchedMedia.title || 'this entry'}
          selectedDiscs={associatedDiscs
            .filter((d) => selectedDiscIds.has(d.id))
            .map((d) => ({
              id: d.id,
              title: d.title || d.id,
              fileNames: Array.isArray(d.videoFiles) ? d.videoFiles.map((f) => f.fileName) : [],
            }))}
          onClose={() => setReassignOpen(false)}
          onReassigned={(toMediaId, toMediaTitle) => {
            setReassignOpen(false);
            setSelectedDiscIds(new Set());
            setReassignSuccessMsg(
              `${selectedDiscIds.size} disc record${selectedDiscIds.size !== 1 ? 's' : ''} successfully reassigned to "${toMediaTitle}".`
            );
          }}
        />
      )}

      <EpisodeAssignDialog
        open={episodeAssignOpen}
        onClose={closeEpisodeAssignDialog}
        file={episodeAssignFile}
        season={episodeAssignSeason}
        onSeasonChange={setEpisodeAssignSeason}
        onSeasonSelectChange={selectEpisodeSeason}
        episode={episodeAssignEpisode}
        onEpisodeChange={setEpisodeAssignEpisode}
        seasonOptions={seriesEpisodeOptions}
        episodeOptions={episodesForSelectedSeason}
        saving={episodeAssignSaving}
        error={episodeAssignError}
        onAssign={(keepOriginalName) => void handleEpisodeAssign(keepOriginalName)}
      />

      <RemoveFromLibraryDialog
        open={deleteConfirmOpen}
        onClose={closeDeleteConfirm}
        title={matchedMedia?.title}
        error={deleteError}
        deleting={deleting}
        onConfirm={handleDelete}
      />
    </Box>
  );
};

export default LibraryMediaDetailPage;
