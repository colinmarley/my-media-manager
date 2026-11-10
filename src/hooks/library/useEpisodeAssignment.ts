import { useMemo, useState } from 'react';

import { LibraryMedia } from '@/app/dashboard/my-library/_components/libraryHelpers';
import {
  getEpisodeHintFromFileName,
  getSeasonNumberFromFolderPath,
  SeriesEpisodeOption,
} from '@/service/library/mediaDetailModel';

interface Params {
  matchedMedia: LibraryMedia | null;
  effectiveFolderPath: string | null;
  seriesEpisodeOptions: SeriesEpisodeOption[];
  selectedSeasonPath: string;
  /** Lets the page refresh the folder listing and surface the result message. */
  onAssigned: (info: { targetDir?: string; message: string }) => void;
}

/**
 * Assigns one loose file in a series folder to a catalogued episode (or to the unknown-season
 * folder with its original filename).
 */
const useEpisodeAssignment = ({
  matchedMedia,
  effectiveFolderPath,
  seriesEpisodeOptions,
  selectedSeasonPath,
  onAssigned,
}: Params) => {
  const [episodeAssignOpen, setEpisodeAssignOpen] = useState(false);
  const [episodeAssignFile, setEpisodeAssignFile] = useState<{ path: string; name: string } | null>(null);
  const [episodeAssignSeason, setEpisodeAssignSeason] = useState('');
  const [episodeAssignEpisode, setEpisodeAssignEpisode] = useState('');
  const [episodeAssignSaving, setEpisodeAssignSaving] = useState(false);
  const [episodeAssignError, setEpisodeAssignError] = useState<string | null>(null);

  const episodesForSelectedSeason = useMemo(() => {
    return seriesEpisodeOptions.find((season) => String(season.seasonNumber) === episodeAssignSeason)?.episodes ?? [];
  }, [seriesEpisodeOptions, episodeAssignSeason]);

  const openEpisodeAssignDialog = (file: { path: string; name: string }) => {
    setEpisodeAssignFile(file);
    setEpisodeAssignError(null);

    const { season: episodeSeason, episode: episodeFromFile } = getEpisodeHintFromFileName(file.name);
    const seasonFromFile = episodeSeason || getSeasonNumberFromFolderPath(selectedSeasonPath) || '';

    setEpisodeAssignSeason(
      seasonFromFile || (seriesEpisodeOptions[0] ? String(seriesEpisodeOptions[0].seasonNumber) : '')
    );
    setEpisodeAssignEpisode(episodeFromFile);
    setEpisodeAssignOpen(true);
  };

  const closeEpisodeAssignDialog = () => {
    if (!episodeAssignSaving) {
      setEpisodeAssignOpen(false);
    }
  };

  // Picking a season from the show metadata invalidates the current episode selection.
  const selectEpisodeSeason = (seasonNumber: string) => {
    setEpisodeAssignSeason(seasonNumber);
    setEpisodeAssignEpisode('');
  };

  const handleEpisodeAssign = async (keepOriginalName = false) => {
    if (!episodeAssignFile || !effectiveFolderPath || !matchedMedia) {
      return;
    }

    if (!keepOriginalName && (!episodeAssignSeason || !episodeAssignEpisode)) {
      setEpisodeAssignError('Select both a season and an episode, or use the unknown-folder option.');
      return;
    }

    setEpisodeAssignSaving(true);
    setEpisodeAssignError(null);

    const selectedEpisode = episodesForSelectedSeason.find((episode) => String(episode.episodeNumber) === episodeAssignEpisode);

    try {
      const response = await fetch('/api/backend/api/files/dest-folder/assign-episode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filePath: episodeAssignFile.path,
          seriesFolderPath: effectiveFolderPath,
          seriesTitle: matchedMedia.title || 'Unknown Series',
          seasonNumber: keepOriginalName ? undefined : (episodeAssignSeason ? Number(episodeAssignSeason) : undefined),
          episodeNumber: keepOriginalName ? undefined : Number(episodeAssignEpisode),
          episodeTitle: keepOriginalName ? undefined : selectedEpisode?.title,
          keepOriginalName,
        }),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.detail ?? 'Episode assignment failed.');
      }

      const targetDir = data?.data?.targetDir as string | undefined;
      onAssigned({
        targetDir,
        message: keepOriginalName
          ? `Moved ${episodeAssignFile.name} to the unknown season folder and kept the original filename.`
          : `Assigned ${episodeAssignFile.name} to S${episodeAssignSeason.padStart(2, '0')}E${episodeAssignEpisode.padStart(2, '0')}.`,
      });
      setEpisodeAssignOpen(false);
    } catch (err) {
      setEpisodeAssignError(err instanceof Error ? err.message : 'Episode assignment failed.');
    } finally {
      setEpisodeAssignSaving(false);
    }
  };

  return {
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
    setEpisodeAssignOpen,
    handleEpisodeAssign,
  };
};

export default useEpisodeAssignment;
