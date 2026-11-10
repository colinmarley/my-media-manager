/**
 * Destination-folder browsing helpers shared by the library media details screen.
 *
 * These talk to the same three `/api/files/dest-folder/*` endpoints the details page used
 * before it was split up, and keep the counting rules identical.
 */

export type BrowseEntry = { name: string; path: string; isDirectory: boolean; size: number };
export type FolderFileEntry = { name: string; path: string; size: number };
export type SeasonFolderEntry = { name: string; path: string };

const VIDEO_FILE_EXTENSION = /\.(mkv|mp4|avi|mov|wmv|m4v|flv|webm|m2ts|mts|ts|mpg|mpeg|iso|strm)$/i;
const SIDECAR_FILE_EXTENSION = /\.(nfo|srt|vtt|ass|ssa|sub|idx|jpg|jpeg|png|webp|gif|bmp|tbn|txt)$/i;
const SEASON_FOLDER_NAME = /^Season\s+\d+$/i;

export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0, v = bytes;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(1)} ${units[i]}`;
}

export function isVideoFileName(name: string): boolean {
  return VIDEO_FILE_EXTENSION.test(name);
}

export function isSeasonFolderName(name: string): boolean {
  return SEASON_FOLDER_NAME.test(name);
}

export async function browseDestFolder(path: string): Promise<BrowseEntry[]> {
  const response = await fetch('/api/backend/api/files/dest-folder/browse', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path }),
  });

  if (!response.ok) {
    throw new Error(`Failed to browse folder (${response.status})`);
  }

  const data = await response.json();
  return Array.isArray(data.data) ? (data.data as BrowseEntry[]) : [];
}

export async function loadMovieFolderFiles(path: string): Promise<FolderFileEntry[]> {
  const rootEntries = await browseDestFolder(path);
  const rootFiles = toFolderFileEntries(rootEntries);

  const subfolderFiles = await Promise.all(
    rootEntries
      .filter((entry) => entry.isDirectory)
      .map(async (entry) => {
        try {
          const nestedEntries = await browseDestFolder(entry.path);
          return nestedEntries
            .filter((nestedEntry) => !nestedEntry.isDirectory)
            .map((nestedEntry) => ({
              name: `${entry.name} / ${nestedEntry.name}`,
              path: nestedEntry.path,
              size: nestedEntry.size,
            }));
        } catch {
          return [] as FolderFileEntry[];
        }
      })
  );

  return [...rootFiles, ...subfolderFiles.flat()].sort((a, b) => a.name.localeCompare(b.name));
}

export function toFolderFileEntries(entries: BrowseEntry[]): FolderFileEntry[] {
  return entries
    .filter((entry) => !entry.isDirectory)
    .map((entry) => ({ name: entry.name, path: entry.path, size: entry.size }));
}

export function getSeasonFolders(entries: BrowseEntry[]): SeasonFolderEntry[] {
  return entries
    .filter((entry) => entry.isDirectory && isSeasonFolderName(entry.name))
    .map((entry) => ({ name: entry.name, path: entry.path }))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
}

/**
 * Count primary video files first; if none found, fall back to any non-sidecar file.
 * Last resort: at least surface that files exist in the folder.
 */
export function countMediaFilesInFolder(folderFiles: FolderFileEntry[]): number {
  if (folderFiles.length === 0) {
    return 0;
  }

  const videoCount = folderFiles.filter((file) => VIDEO_FILE_EXTENSION.test(file.name)).length;
  if (videoCount > 0) {
    return videoCount;
  }

  const nonSidecarCount = folderFiles.filter((file) => !SIDECAR_FILE_EXTENSION.test(file.name)).length;
  if (nonSidecarCount > 0) {
    return nonSidecarCount;
  }

  return folderFiles.length;
}
