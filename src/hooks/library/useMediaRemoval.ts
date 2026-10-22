import { useRouter } from 'next/navigation';
import { useState } from 'react';

/**
 * "Remove from library" (send the organized folder to _NeedsReview) plus its confirm dialog.
 */
const useMediaRemoval = ({ mediaTypeFromRoute, mediaIdFromRoute }: { mediaTypeFromRoute?: string; mediaIdFromRoute: string }) => {
  const router = useRouter();
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const closeDeleteConfirm = () => setDeleteConfirmOpen(false);

  const handleDelete = async () => {
    setDeleting(true);
    setDeleteError(null);
    const collection = mediaTypeFromRoute === 'series' ? 'series' : 'movies';
    try {
      const res = await fetch(
        `/api/backend/api/catalog/${collection}/${encodeURIComponent(mediaIdFromRoute)}/remove-to-review`,
        { method: 'POST' }
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail ?? `Server error ${res.status}`);
      }
      router.push('/dashboard/my-library');
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Remove failed.');
      setDeleting(false);
    }
  };

  return {
    deleteConfirmOpen,
    setDeleteConfirmOpen,
    closeDeleteConfirm,
    deleting,
    deleteError,
    handleDelete,
  };
};

export default useMediaRemoval;
