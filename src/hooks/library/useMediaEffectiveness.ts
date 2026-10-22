import { useMemo } from 'react';

import {
  LibraryMediaWithComputed,
  LibraryProcessingSummary,
} from '@/app/dashboard/my-library/_components/libraryHelpers';
import { countMediaFilesInFolder, FolderFileEntry } from '@/service/library/mediaFolderFiles';
import { withFallbackFileCounts } from '@/service/library/mediaDetailModel';

interface Params {
  computed: LibraryMediaWithComputed | null;
  processingSummary: LibraryProcessingSummary | null;
  folderFiles: FolderFileEntry[];
}

/**
 * The catalog record and the folder on disk can each be missing counts, so the page shows the
 * best available signal: catalog counts first, folder counts as the fallback.
 */
const useMediaEffectiveness = ({ computed, processingSummary, folderFiles }: Params) => {
  const folderMediaFileCount = useMemo(() => countMediaFilesInFolder(folderFiles), [folderFiles]);

  const effectiveFileCount = useMemo(() => {
    if (!computed) {
      return 0;
    }
    return computed.fileCount > 0 ? computed.fileCount : folderMediaFileCount;
  }, [computed, folderMediaFileCount]);

  const effectiveInLibrary = useMemo(() => {
    if (!computed) {
      return false;
    }
    return computed.inLibrary || effectiveFileCount > 0 || folderFiles.length > 0;
  }, [computed, effectiveFileCount, folderFiles.length]);

  const effectiveProcessingSummary = useMemo(() => {
    if (!processingSummary) {
      return null;
    }

    return withFallbackFileCounts(processingSummary, effectiveFileCount);
  }, [processingSummary, effectiveFileCount]);

  return { folderMediaFileCount, effectiveFileCount, effectiveInLibrary, effectiveProcessingSummary };
};

export default useMediaEffectiveness;
