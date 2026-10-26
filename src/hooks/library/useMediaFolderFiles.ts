import { useEffect, useState } from 'react';

import {
  BrowseEntry,
  browseDestFolder,
  FolderFileEntry,
  getSeasonFolders,
  loadMovieFolderFiles,
  SeasonFolderEntry,
  toFolderFileEntries,
} from '@/service/library/mediaFolderFiles';

interface Params {
  effectiveFolderPath: string | null;
  isSeries: boolean;
}

/**
 * Browses the organized destination folder so the details page can list the files that
 * actually exist on disk (plus the season folders for a series).
 */
const useMediaFolderFiles = ({ effectiveFolderPath, isSeries }: Params) => {
  const [folderFiles, setFolderFiles] = useState<FolderFileEntry[]>([]);
  const [folderFilesLoading, setFolderFilesLoading] = useState(false);
  const [seasonFolders, setSeasonFolders] = useState<SeasonFolderEntry[]>([]);
  const [selectedSeasonPath, setSelectedSeasonPath] = useState<string>('');

  const refreshFolderFiles = (pathOverride?: string) => {
    const browsePath = pathOverride || (isSeries && selectedSeasonPath ? selectedSeasonPath : effectiveFolderPath);
    if (!browsePath) {
      return;
    }

    setFolderFilesLoading(true);
    (isSeries ? browseDestFolder(browsePath) : loadMovieFolderFiles(browsePath))
      .then((entries) => {
        const files = isSeries
          ? toFolderFileEntries(entries as BrowseEntry[])
          : (entries as FolderFileEntry[]);
        setFolderFiles(files);
      })
      .catch(() => setFolderFiles([]))
      .finally(() => setFolderFilesLoading(false));
  };

  const clearFolderFiles = () => setFolderFiles([]);

  // Browse the organized folder path to show the actual files on disk.
  useEffect(() => {
    if (!effectiveFolderPath) {
      setFolderFiles([]);
      setSeasonFolders([]);
      setSelectedSeasonPath('');
      return;
    }

    setFolderFilesLoading(true);
    browseDestFolder(effectiveFolderPath)
      .then(async (entries) => {
        if (!isSeries) {
          const files = await loadMovieFolderFiles(effectiveFolderPath);
          setFolderFiles(files);
          setSeasonFolders([]);
          setSelectedSeasonPath('');
          return;
        }

        const seasons = getSeasonFolders(entries);
        setSeasonFolders(seasons);

        const rootFiles = toFolderFileEntries(entries);
        if (seasons.length > 0) {
          setSelectedSeasonPath((prev) => (seasons.some((s) => s.path === prev) ? prev : seasons[0].path));
          setFolderFiles([]);
        } else {
          setSelectedSeasonPath('');
          setFolderFiles(rootFiles);
        }
      })
      .catch(() => {
        setFolderFiles([]);
        setSeasonFolders([]);
        setSelectedSeasonPath('');
      })
      .finally(() => setFolderFilesLoading(false));
  }, [effectiveFolderPath, isSeries]);

  useEffect(() => {
    if (!isSeries || !selectedSeasonPath) {
      return;
    }

    setFolderFilesLoading(true);
    browseDestFolder(selectedSeasonPath)
      .then((entries) => {
        const files = toFolderFileEntries(entries);
        setFolderFiles(files);
      })
      .catch(() => setFolderFiles([]))
      .finally(() => setFolderFilesLoading(false));
  }, [isSeries, selectedSeasonPath]);

  return {
    folderFiles,
    folderFilesLoading,
    seasonFolders,
    selectedSeasonPath,
    setSelectedSeasonPath,
    refreshFolderFiles,
    clearFolderFiles,
  };
};

export default useMediaFolderFiles;
