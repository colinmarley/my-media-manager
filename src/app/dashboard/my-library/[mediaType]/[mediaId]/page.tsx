'use client';

import { useEffect, useState } from 'react';
import { Box, Alert, Grid, Typography } from '@mui/material';
import { useParams } from 'next/navigation';

import ReassignFilesDialog from '../../_components/ReassignFilesDialog';
import DiskReassignDialog from '../../_components/DiskReassignDialog';
import MediaDetailHeaderBar from '../../_components/detail/MediaDetailHeaderBar';
import MediaOverviewCard from '../../_components/detail/MediaOverviewCard';
import MediaProcessingSummaryCard from '../../_components/detail/MediaProcessingSummaryCard';
import MediaAssociatedFilesCard from '../../_components/detail/MediaAssociatedFilesCard';
import PosterToolsCard from '../../_components/detail/PosterToolsCard';
import PosterGalleryCard from '../../_components/detail/PosterGalleryCard';
import CatalogMetadataCard, { NfoMetadataCard } from '../../_components/detail/MetadataCards';
import EpisodeAssignDialog from '../../_components/detail/EpisodeAssignDialog';
import RemoveFromLibraryDialog from '../../_components/detail/RemoveFromLibraryDialog';
import styles from '../../_components/detail/mediaDetailStyles';
import useMediaDetailRecord from '@/hooks/library/useMediaDetailRecord';
import useMediaPoster from '@/hooks/library/useMediaPoster';
import useMediaFolderFiles from '@/hooks/library/useMediaFolderFiles';
import useMediaEffectiveness from '@/hooks/library/useMediaEffectiveness';
import useNfoFromDisk from '@/hooks/library/useNfoFromDisk';
import useDiskReassign from '@/hooks/library/useDiskReassign';
import useEpisodeAssignment from '@/hooks/library/useEpisodeAssignment';
import useMediaRemoval from '@/hooks/library/useMediaRemoval';

/**
 * Library media details screen. This file is the composition root only: the data loading lives
 * in the hooks, the sections live in the detail components, and the pure rules live in
 * service/library/mediaDetailModel + service/library/mediaFolderFiles.
 */
const LibraryMediaDetailPage = () => {
  const params = useParams<{ mediaType?: string; mediaId?: string }>();
  const mediaTypeFromRoute = params?.mediaType;
  const mediaIdFromRoute = decodeURIComponent(params?.mediaId || '');

  const record = useMediaDetailRecord({ mediaTypeFromRoute, mediaIdFromRoute });
  const poster = useMediaPoster({
    mediaTypeFromRoute,
    mediaIdFromRoute,
    currentPosterSource: record.currentPosterSource,
  });
  const folderFiles = useMediaFolderFiles({
    effectiveFolderPath: record.effectiveFolderPath,
    isSeries: record.isSeries,
  });
  const effectiveness = useMediaEffectiveness({
    computed: record.computed,
    processingSummary: record.processingSummary,
    folderFiles: folderFiles.folderFiles,
  });
  const diskNfoData = useNfoFromDisk({
    folderPath: record.folderPath,
    nfoMetadata: record.nfoMetadata,
  });

  const [selectedDiscIds, setSelectedDiscIds] = useState<Set<string>>(new Set());
  const [reassignOpen, setReassignOpen] = useState(false);
  const [reassignSuccessMsg, setReassignSuccessMsg] = useState<string | null>(null);
  const [folderMessages, setFolderMessages] = useState<string | null>(null);

  const clearSelectedDiscIds = () => setSelectedDiscIds(new Set());
  const toggleDisc = (id: string) =>
    setSelectedDiscIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const diskReassign = useDiskReassign({
    onReassigned: ({ newPath }) => {
      setFolderMessages(
        diskReassign.diskReassignMode === 'folder'
          ? `Folder reassigned. New path: ${newPath}`
          : `File moved to: ${newPath}`
      );
      folderFiles.clearFolderFiles();
      // Keep this details page scoped to the currently viewed media entry.
      // For file reassignments, loading `newPath` here shows destination-title files
      // on the source-title page until a manual reload.
      folderFiles.refreshFolderFiles();
    },
  });

  const episodeAssignment = useEpisodeAssignment({
    matchedMedia: record.matchedMedia,
    effectiveFolderPath: record.effectiveFolderPath,
    seriesEpisodeOptions: record.seriesEpisodeOptions,
    selectedSeasonPath: folderFiles.selectedSeasonPath,
    onAssigned: ({ targetDir, message }) => {
      setFolderMessages(message);
      if (targetDir) {
        folderFiles.setSelectedSeasonPath(targetDir);
      }
      folderFiles.refreshFolderFiles(targetDir);
    },
  });

  const removal = useMediaRemoval({ mediaTypeFromRoute, mediaIdFromRoute });

  // Clear reassignment feedback after the same fixed delay the folder tools used before.
  useEffect(() => {
    if (!folderMessages) {
      return;
    }

    const timer = setTimeout(() => setFolderMessages(null), 30000);
    return () => clearTimeout(timer);
  }, [folderMessages]);

  return (
    <Box sx={styles.page}>
      <MediaDetailHeaderBar
        hasMedia={Boolean(record.matchedMedia)}
        onRemoveFromLibrary={() => removal.setDeleteConfirmOpen(true)}
      />

      {record.error && <Alert severity="error">Unable to load details: {record.error}</Alert>}

      {record.loading && <Typography>Loading media details...</Typography>}

      {!record.loading && !record.matchedMedia && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          This title was not found. It may have been removed or its identifier has changed.
        </Alert>
      )}

      {!record.loading && mediaTypeFromRoute && mediaIdFromRoute && (
        <PosterToolsCard
          posterSourceInput={poster.posterSourceInput}
          onPosterSourceInputChange={poster.setPosterSourceInput}
          posterSourceSaving={poster.posterSourceSaving}
          posterSourceStatus={poster.posterSourceStatus}
          hasPosterSource={Boolean(record.currentPosterSource)}
          onSavePosterSource={poster.handlePosterSourceUpdate}
        />
      )}

      {!record.loading && record.matchedMedia && record.computed && (
        <Grid container spacing={2.5}>
          <Grid size={{ xs: 12, md: 4 }}>
            <PosterGalleryCard
              mediaTypeFromRoute={mediaTypeFromRoute}
              mediaIdFromRoute={mediaIdFromRoute}
              title={record.matchedMedia.title || ''}
              posterIndex={poster.posterIndex}
              posterCount={poster.posterCount}
              posterLoadFailed={poster.posterLoadFailed}
              posterCacheBust={poster.posterCacheBust}
              setPosterIndex={poster.setPosterIndex}
              onPosterLoadError={poster.handlePosterLoadError}
            />
          </Grid>

          <Grid size={{ xs: 12, md: 8 }}>
            <MediaOverviewCard
              media={record.matchedMedia}
              mediaType={record.computed.mediaType}
              inLibrary={effectiveness.effectiveInLibrary}
              fileCount={effectiveness.effectiveFileCount}
              folderPath={record.folderPath}
              externalIds={record.externalIds}
              legacyImdbId={record.legacyOmdbData?.imdbID}
            />
          </Grid>

          <Grid size={{ xs: 12 }}>
            <MediaProcessingSummaryCard summary={effectiveness.effectiveProcessingSummary} />
          </Grid>

          <Grid size={{ xs: 12, md: 6 }}>
            <CatalogMetadataCard media={record.matchedMedia} />
          </Grid>

          <Grid size={{ xs: 12, md: 6 }}>
            <NfoMetadataCard nfoMetadata={record.nfoMetadata} diskNfoData={diskNfoData} />
          </Grid>

          <Grid size={{ xs: 12 }}>
            <MediaAssociatedFilesCard
              folderPath={record.folderPath}
              selectedDiscCount={selectedDiscIds.size}
              onOpenReassign={() => setReassignOpen(true)}
              reassignSuccessMsg={reassignSuccessMsg}
              onCloseReassignSuccessMsg={() => setReassignSuccessMsg(null)}
              diskReassignMsg={folderMessages}
              onCloseDiskReassignMsg={() => setFolderMessages(null)}
              associatedDiscs={record.associatedDiscs}
              associatedTapes={record.associatedTapes}
              mediaLinksLoading={record.mediaLinksLoading}
              selectedDiscIds={selectedDiscIds}
              onToggleDisc={toggleDisc}
              folderSection={{
                loading: folderFiles.folderFilesLoading,
                files: folderFiles.folderFiles,
                isSeries: record.isSeries,
                seasonFolders: folderFiles.seasonFolders,
                selectedSeasonPath: folderFiles.selectedSeasonPath,
                onSeasonChange: folderFiles.setSelectedSeasonPath,
                onReassignFolder: () =>
                  diskReassign.openDiskReassign(
                    'folder',
                    record.folderPath || '',
                    (record.folderPath || '').split('/').pop() || record.folderPath || ''
                  ),
                onReassignFile: (path, name) => diskReassign.openDiskReassign('file', path, name),
                onAssignEpisode: episodeAssignment.openEpisodeAssignDialog,
              }}
            />
          </Grid>
        </Grid>
      )}

      {diskReassign.diskReassignOpen && (
        <DiskReassignDialog
          open={diskReassign.diskReassignOpen}
          mode={diskReassign.diskReassignMode}
          sourcePath={diskReassign.diskReassignSource}
          sourceLabel={diskReassign.diskReassignLabel}
          currentMediaType={mediaTypeFromRoute}
          onClose={diskReassign.closeDiskReassign}
          onReassigned={diskReassign.handleReassigned}
        />
      )}

      {record.matchedMedia && reassignOpen && (
        <ReassignFilesDialog
          open={reassignOpen}
          fromMediaId={mediaIdFromRoute}
          fromMediaTitle={record.matchedMedia.title || 'this entry'}
          selectedDiscs={record.associatedDiscs
            .filter((disc) => selectedDiscIds.has(disc.id))
            .map((disc) => ({
              id: disc.id,
              title: disc.title || disc.id,
              fileNames: Array.isArray(disc.videoFiles) ? disc.videoFiles.map((file) => file.fileName) : [],
            }))}
          onClose={() => setReassignOpen(false)}
          onReassigned={(_toMediaId, toMediaTitle) => {
            setReassignOpen(false);
            clearSelectedDiscIds();
            setReassignSuccessMsg(
              `${selectedDiscIds.size} disc record${selectedDiscIds.size !== 1 ? 's' : ''} successfully reassigned to "${toMediaTitle}".`
            );
          }}
        />
      )}

      <EpisodeAssignDialog
        open={episodeAssignment.episodeAssignOpen}
        onClose={episodeAssignment.closeEpisodeAssignDialog}
        file={episodeAssignment.episodeAssignFile}
        season={episodeAssignment.episodeAssignSeason}
        onSeasonChange={episodeAssignment.setEpisodeAssignSeason}
        onSeasonSelectChange={episodeAssignment.selectEpisodeSeason}
        episode={episodeAssignment.episodeAssignEpisode}
        onEpisodeChange={episodeAssignment.setEpisodeAssignEpisode}
        seasonOptions={record.seriesEpisodeOptions}
        episodeOptions={episodeAssignment.episodesForSelectedSeason}
        saving={episodeAssignment.episodeAssignSaving}
        error={episodeAssignment.episodeAssignError}
        onAssign={episodeAssignment.handleEpisodeAssign}
      />

      <RemoveFromLibraryDialog
        open={removal.deleteConfirmOpen}
        onClose={removal.closeDeleteConfirm}
        title={record.matchedMedia?.title}
        error={removal.deleteError}
        deleting={removal.deleting}
        onConfirm={removal.handleDelete}
      />
    </Box>
  );
};

export default LibraryMediaDetailPage;
