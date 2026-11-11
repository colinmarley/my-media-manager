'use client';

import React, { useMemo, useState } from 'react';
import { Alert, Box, Button, Skeleton, Tab, Tabs } from '@mui/material';
import { useParams } from 'next/navigation';
import Link from 'next/link';

import { PageContainer } from '@/components/ui/PageHeader';
import TitleAttentionBanner from '@/components/attention/TitleAttentionBanner';
import { useNotify } from '@/context/NotificationContext';
import ReassignFilesDialog from '../../_components/ReassignFilesDialog';
import DiskReassignDialog from '../../_components/DiskReassignDialog';
import MediaDetailHeaderBar from '../../_components/detail/MediaDetailHeaderBar';
import TitleHeader from '../../_components/detail/TitleHeader';
import FilesTab from '../../_components/detail/FilesTab';
import DiscsTapesTab from '../../_components/detail/DiscsTapesTab';
import MetadataTab from '../../_components/detail/MetadataTab';
import ArtworkTab from '../../_components/detail/ArtworkTab';
import MediaFolderFileList from '../../_components/detail/MediaFolderFileList';
import LinkFileToDiscDialog, { SourceOption } from '../../_components/detail/LinkFileToDiscDialog';
import RenameCanonicalDialog from '../../_components/detail/RenameCanonicalDialog';
import EpisodeAssignDialog from '../../_components/detail/EpisodeAssignDialog';
import RemoveFromLibraryDialog from '../../_components/detail/RemoveFromLibraryDialog';
import { FileActionHandlers } from '../../_components/detail/fileActionTypes';
import useMediaDetailRecord from '@/hooks/library/useMediaDetailRecord';
import useMediaPoster from '@/hooks/library/useMediaPoster';
import useMediaFolderFiles from '@/hooks/library/useMediaFolderFiles';
import useNfoFromDisk from '@/hooks/library/useNfoFromDisk';
import useDiskReassign from '@/hooks/library/useDiskReassign';
import useEpisodeAssignment from '@/hooks/library/useEpisodeAssignment';
import useMediaRemoval from '@/hooks/library/useMediaRemoval';
import useFileActions from '@/hooks/library/useFileActions';
import useInventoryScan from '@/hooks/library/useInventoryScan';
import useDetailTab, { DetailTab } from '@/hooks/library/useDetailTab';
import { currentFilePath, fileSource, TitleSource, titleSources } from '@/service/library/mediaFileModel';
import { MediaFile } from '@/types/library/MediaFile.type';

const TAB_LABELS: Record<DetailTab, string> = {
  files: 'Files',
  discs: 'Discs & Tapes',
  metadata: 'Metadata',
  artwork: 'Artwork',
};

const toOption = (source: TitleSource): SourceOption => ({
  kind: source.kind,
  id: source.id,
  title: source.title,
  format: source.format,
});

/**
 * Library title detail: a header (poster, facts, inventory stats, actions) over four
 * URL-addressable tabs — Files, Discs & Tapes, Metadata, Artwork. This file is the composition
 * root: data lives in the hooks/library hooks, sections in _components/detail, and the display
 * rules in service/library/mediaFileModel.
 */
const LibraryMediaDetailPage = () => {
  const params = useParams<{ mediaType?: string; mediaId?: string }>();
  const mediaTypeFromRoute = params?.mediaType;
  const mediaIdFromRoute = decodeURIComponent(params?.mediaId || '');
  const notify = useNotify();
  const { tab, setTab } = useDetailTab();

  const record = useMediaDetailRecord({ mediaTypeFromRoute, mediaIdFromRoute });
  const hasInventory = record.source === 'detail';
  const poster = useMediaPoster({ mediaTypeFromRoute, mediaIdFromRoute, currentPosterSource: record.currentPosterSource });
  // The on-disk listing is only the fallback for a title with no inventory rows.
  const folderFiles = useMediaFolderFiles({
    effectiveFolderPath: !record.loading && record.allFiles.length === 0 ? record.effectiveFolderPath : null,
    isSeries: record.isSeries,
  });
  const diskNfoData = useNfoFromDisk({ folderPath: record.folderPath, nfoMetadata: record.nfoMetadata });

  const refreshAll = async () => {
    await record.refetch();
    folderFiles.refreshFolderFiles();
  };

  const fileActions = useFileActions({ refetch: record.refetch });
  const scan = useInventoryScan({ onFinished: record.refetch });

  const [linkDialog, setLinkDialog] = useState<{ files: MediaFile[]; target?: SourceOption } | null>(null);
  const [renameFiles, setRenameFiles] = useState<MediaFile[] | null>(null);
  const [reassignDisc, setReassignDisc] = useState<TitleSource | null>(null);

  const diskReassign = useDiskReassign({
    onReassigned: ({ mode, newPath }) => {
      notify(mode === 'folder' ? `Folder reassigned. New path: ${newPath}` : `File moved to: ${newPath}`, 'success');
      void refreshAll();
    },
  });

  const episodeAssignment = useEpisodeAssignment({
    matchedMedia: record.matchedMedia,
    effectiveFolderPath: record.effectiveFolderPath,
    seriesEpisodeOptions: record.seriesEpisodeOptions,
    selectedSeasonPath: folderFiles.selectedSeasonPath,
    onAssigned: ({ targetDir, message }) => {
      notify(message, 'success');
      if (targetDir) folderFiles.setSelectedSeasonPath(targetDir);
      void record.refetch();
      folderFiles.refreshFolderFiles(targetDir);
    },
  });

  const removal = useMediaRemoval({ mediaTypeFromRoute, mediaIdFromRoute });

  const sources = useMemo(
    () => titleSources(record.associatedDiscs, record.associatedTapes, record.allFiles),
    [record.associatedDiscs, record.associatedTapes, record.allFiles],
  );

  const handlers: FileActionHandlers = {
    onLink: (files) => files.length > 0 && setLinkDialog({ files }),
    onUnlink: (files) => void fileActions.unlink(files),
    onReassign: (file) => diskReassign.openDiskReassign('file', currentFilePath(file), file.fileName),
    onAssignEpisode: record.isSeries
      ? (file) => episodeAssignment.openEpisodeAssignDialog({ path: currentFilePath(file), name: file.fileName })
      : undefined,
    onSetFlag: (files, needsReview) => void fileActions.setReview(files.map((f) => f.id), needsReview),
    onRename: (files) => files.length > 0 && setRenameFiles(files),
    reviewUnavailable: fileActions.reviewUnavailable,
    renameUnavailable: fileActions.renameUnavailable,
    busy: fileActions.busy,
  };

  const media = record.matchedMedia;
  const folderPath = record.folderPath;
  const reassignFolder = folderPath
    ? () => diskReassign.openDiskReassign('folder', folderPath, folderPath.split('/').pop() || folderPath)
    : undefined;

  const folderFallback = folderFiles.folderFilesLoading ? (
    <Skeleton variant="rounded" height={120} aria-label="Loading folder listing" />
  ) : folderFiles.folderFiles.length > 0 ? (
    <MediaFolderFileList
      files={folderFiles.folderFiles}
      isSeries={record.isSeries}
      seasonFolders={folderFiles.seasonFolders}
      selectedSeasonPath={folderFiles.selectedSeasonPath}
      onSeasonChange={folderFiles.setSelectedSeasonPath}
      folderPath={folderPath}
      onReassignFolder={reassignFolder ?? (() => {})}
      onReassignFile={(path, name) => diskReassign.openDiskReassign('file', path, name)}
      onAssignEpisode={episodeAssignment.openEpisodeAssignDialog}
    />
  ) : folderPath ? (
    <Alert severity="info">No files were found in the title&apos;s folder on disk ({folderPath}).</Alert>
  ) : (
    <Alert severity="info">This title has no folder in the library yet.</Alert>
  );

  return (
    <PageContainer>
      <TitleHeader
        media={media}
        loading={record.loading}
        mediaType={record.detailMediaType ?? record.computed?.mediaType ?? null}
        posterSrc={
          mediaTypeFromRoute
            ? `/api/backend/api/posters/${mediaTypeFromRoute}/${encodeURIComponent(mediaIdFromRoute)}?index=0&v=${poster.posterCacheBust}`
            : null
        }
        summary={record.summary}
        sourceCount={sources.length}
        hasInventory={hasInventory}
        attentionBanner={
          <TitleAttentionBanner
            catalogType={record.catalogType}
            mediaId={record.detail?.record.id ?? (mediaIdFromRoute || null)}
            refreshKey={record.detail}
          />
        }
        actions={
          <MediaDetailHeaderBar
            hasMedia={Boolean(media)}
            onRemoveFromLibrary={() => removal.setDeleteConfirmOpen(true)}
            onRescan={hasInventory ? scan.startScan : undefined}
            scanning={scan.scanning}
          />
        }
      />

      {record.error && (
        <Alert
          severity="error"
          sx={{ mb: 2 }}
          action={<Button color="inherit" size="small" onClick={() => void record.refetch()}>Retry</Button>}
        >
          Unable to load this title: {record.error}
        </Alert>
      )}

      {!record.loading && !record.error && !media && (
        <Alert
          severity="warning"
          sx={{ mb: 2 }}
          action={<Button component={Link} href="/dashboard/my-library" color="inherit" size="small">My Library</Button>}
        >
          This title was not found. It may have been removed or its identifier has changed.
        </Alert>
      )}

      {record.loading && !media && <Skeleton variant="rounded" height={240} aria-label="Loading files" />}

      {media && (
        <>
          <Tabs
            value={tab}
            onChange={(_e, next: DetailTab) => setTab(next)}
            aria-label="Title sections"
            sx={{ mb: 2, borderBottom: 1, borderColor: 'divider' }}
          >
            {(Object.keys(TAB_LABELS) as DetailTab[]).map((key) => (
              <Tab
                key={key}
                value={key}
                id={`detail-tab-${key}`}
                aria-controls={`detail-tabpanel-${key}`}
                label={key === 'files' && hasInventory ? `Files (${record.summary.fileCount})` : key === 'discs' ? `${TAB_LABELS[key]} (${sources.length})` : TAB_LABELS[key]}
              />
            ))}
          </Tabs>

          <Box role="tabpanel" id={`detail-tabpanel-${tab}`} aria-labelledby={`detail-tab-${tab}`} aria-busy={record.refreshing || undefined}>
            {tab === 'files' && (
              <FilesTab
                groups={record.files}
                allFiles={record.allFiles}
                actions={handlers}
                hasInventory={hasInventory}
                onScan={scan.startScan}
                scanning={scan.scanning}
                onReassignFolder={reassignFolder}
                folderFallback={folderFallback}
              />
            )}
            {tab === 'discs' && (
              <DiscsTapesTab
                sources={sources}
                allFiles={record.allFiles}
                actions={handlers}
                onLinkFilesTo={(source) =>
                  setLinkDialog({ files: record.allFiles.filter((file) => !fileSource(file)), target: toOption(source) })
                }
                onReassignDisc={setReassignDisc}
              />
            )}
            {tab === 'metadata' && (
              <MetadataTab
                media={media}
                catalogType={record.catalogType}
                folderPath={folderPath}
                externalIds={record.externalIds}
                legacyImdbId={record.legacyOmdbData?.imdbID}
                nfoMetadata={record.nfoMetadata}
                diskNfoData={diskNfoData}
              />
            )}
            {tab === 'artwork' && (
              <ArtworkTab
                mediaTypeFromRoute={mediaTypeFromRoute}
                mediaIdFromRoute={mediaIdFromRoute}
                title={media.title || ''}
                hasPosterSource={Boolean(record.currentPosterSource)}
                poster={poster}
              />
            )}
          </Box>
        </>
      )}

      <LinkFileToDiscDialog
        open={Boolean(linkDialog)}
        onClose={() => setLinkDialog(null)}
        files={linkDialog?.files ?? []}
        target={linkDialog?.target ?? null}
        sources={sources.map(toOption)}
        onLink={(fileIds, target) => fileActions.link(fileIds, target)}
      />

      <RenameCanonicalDialog
        open={Boolean(renameFiles)}
        files={renameFiles ?? []}
        onClose={() => setRenameFiles(null)}
        onApplied={record.refetch}
        onUnavailable={fileActions.markRenameUnavailable}
      />

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

      {media && reassignDisc && (
        <ReassignFilesDialog
          open
          fromMediaId={mediaIdFromRoute}
          fromMediaTitle={media.title || 'this entry'}
          selectedDiscs={[{ id: reassignDisc.id, title: reassignDisc.title, fileNames: reassignDisc.files.map((f) => f.fileName) }]}
          onClose={() => setReassignDisc(null)}
          onReassigned={(_toMediaId, toMediaTitle) => {
            setReassignDisc(null);
            notify(`Disc record moved to "${toMediaTitle}".`, 'success');
            void record.refetch();
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
        title={media?.title}
        error={removal.deleteError}
        deleting={removal.deleting}
        onConfirm={removal.handleDelete}
      />
    </PageContainer>
  );
};

export default LibraryMediaDetailPage;
