import { useCallback, useState } from 'react';

import { useNotify } from '@/context/NotificationContext';
import {
  forEachFile,
  isEndpointUnavailable,
  linkFile,
  setFileReview,
  unlinkFile,
} from '@/service/library/MediaFilesService';
import { fileSource } from '@/service/library/mediaFileModel';
import { MediaFile, SourceRef } from '@/types/library/MediaFile.type';

interface Params {
  /** Reloads /detail; every mutation ends with it. */
  refetch: () => Promise<unknown> | void;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

const firstError = (failed: { error: unknown }[]) => {
  const error = failed[0]?.error;
  return error instanceof Error ? error.message : 'Request failed';
};

/**
 * The file mutations the title detail page offers (link / unlink a source, the review flag),
 * each followed by a /detail refetch and a toast. The review endpoint arrives with a later
 * backend PR: a 404 / 405 marks it unavailable and the page disables the action.
 */
const useFileActions = ({ refetch }: Params) => {
  const notify = useNotify();
  const [busy, setBusy] = useState(false);
  const [reviewUnavailable, setReviewUnavailable] = useState(false);
  const [renameUnavailable, setRenameUnavailable] = useState(false);

  const run = useCallback(
    async (
      fileIds: string[],
      action: (fileId: string) => Promise<unknown>,
      describe: (count: number) => string,
    ) => {
      if (fileIds.length === 0) return { succeeded: [], failed: [] };
      setBusy(true);
      try {
        const result = await forEachFile(fileIds, action);
        if (result.failed.length === 0) {
          notify(describe(result.succeeded.length), 'success');
        } else if (result.succeeded.length > 0) {
          notify(`${describe(result.succeeded.length)} ${plural(result.failed.length, 'file')} failed: ${firstError(result.failed)}`, 'error');
        } else {
          notify(`Failed: ${firstError(result.failed)}`, 'error');
        }
        await refetch();
        return result;
      } finally {
        setBusy(false);
      }
    },
    [notify, refetch],
  );

  const link = useCallback(
    (fileIds: string[], target: SourceRef & { title?: string }) =>
      run(
        fileIds,
        (id) => linkFile(id, target),
        (n) => `Linked ${plural(n, 'file')} to ${target.title ? `"${target.title}"` : `the ${target.kind}`}.`,
      ),
    [run],
  );

  const unlink = useCallback(
    (files: MediaFile[]) => {
      const linked = files.filter((file) => fileSource(file));
      const kinds = new Map(linked.map((file) => [file.id, fileSource(file)!.kind]));
      return run(
        linked.map((file) => file.id),
        (id) => unlinkFile(id, kinds.get(id)!),
        (n) => `Unlinked ${plural(n, 'file')} from its source.`,
      );
    },
    [run],
  );

  const setReview = useCallback(
    async (fileIds: string[], needsReview: boolean, note?: string) => {
      if (reviewUnavailable || fileIds.length === 0) return;
      setBusy(true);
      try {
        const result = await forEachFile(fileIds, (id) => setFileReview(id, needsReview, note));
        if (result.failed.length > 0 && result.failed.every((f) => isEndpointUnavailable(f.error))) {
          setReviewUnavailable(true);
          notify('Flagging files is not available on this server yet.', 'info');
          return;
        }
        if (result.failed.length > 0) {
          notify(`Could not update ${plural(result.failed.length, 'file')}: ${firstError(result.failed)}`, 'error');
        } else {
          notify(
            needsReview
              ? `Flagged ${plural(result.succeeded.length, 'file')} for a second look.`
              : `Cleared the flag on ${plural(result.succeeded.length, 'file')}.`,
            'success',
          );
        }
        await refetch();
      } finally {
        setBusy(false);
      }
    },
    [notify, refetch, reviewUnavailable],
  );

  return {
    busy,
    link,
    unlink,
    setReview,
    reviewUnavailable,
    renameUnavailable,
    markRenameUnavailable: () => setRenameUnavailable(true),
  };
};

export type FileActions = ReturnType<typeof useFileActions>;

export default useFileActions;
