import { useEffect, useState } from 'react';

interface Params {
  folderPath: string | null;
  nfoMetadata: Record<string, unknown> | null;
}

/**
 * Read NFO from disk when the catalog record has no NFO metadata but a folderPath is known.
 */
const useNfoFromDisk = ({ folderPath, nfoMetadata }: Params) => {
  const [diskNfoData, setDiskNfoData] = useState<Record<string, unknown> | null>(null);

  useEffect(() => {
    if (!folderPath || nfoMetadata) {
      setDiskNfoData(null);
      return;
    }
    fetch('/api/backend/api/files/dest-folder/nfo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folderPath }),
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((data) => setDiskNfoData(data.data ?? null))
      .catch(() => setDiskNfoData(null));
  }, [folderPath, nfoMetadata]);

  return diskNfoData;
};

export default useNfoFromDisk;
