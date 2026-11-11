'use client';

import { useCallback, useState } from 'react';

import { useNotify } from '@/context/NotificationContext';
import useInventoryScan from '@/hooks/library/useInventoryScan';
import { apiErrorStatus } from '@/service/api/apiClient';
import AttentionService from '@/service/attention/AttentionService';
import { itemFile, type AttentionAction } from '@/service/attention/attentionModel';
import { isEndpointUnavailable } from '@/service/library/MediaFilesService';
import type { AttentionDismissal, AttentionItem } from '@/types/attention/Attention.type';
import type { MediaFile } from '@/types/library/MediaFile.type';
import type { DismissChoice } from './TodoRowActions';

export type TodoDialog =
  | { type: 'rename'; files: MediaFile[] }
  | { type: 'reassign'; filePath: string; fileName: string }
  | { type: 'assign-queue'; queueItemId: string; queueStatus: string | null }
  | { type: 'link-disc'; mediaType: string; mediaId: string; discId: string; discTitle: string }
  | { type: 'dismiss-note'; item: AttentionItem }
  | null;

const errorText = (error: unknown) => (error instanceof Error && error.message ? error.message : 'Request failed');

/**
 * What the To-Do rows do: open the dialog that fixes an item, clear a review flag, start a
 * library scan, dismiss / undo / restore. Every finished action calls `refetch` (the items and
 * the shared summary).
 */
export default function useTodoActions({ refetch }: { refetch: () => Promise<unknown> }) {
  const notify = useNotify();
  const [dialog, setDialog] = useState<TodoDialog>(null);
  const [busy, setBusy] = useState(false);
  const scan = useInventoryScan({ onFinished: refetch });
  const closeDialog = useCallback(() => setDialog(null), []);

  const clearFlag = useCallback(
    async (item: AttentionItem, fileId: string) => {
      setBusy(true);
      try {
        await AttentionService.clearReviewFlag(fileId);
        notify(`Cleared the flag on ${item.file?.fileName ?? item.title}.`, 'success');
        await refetch();
      } catch (error) {
        notify(
          isEndpointUnavailable(error) ? 'Clearing the flag is not available on this server yet.' : `Could not clear the flag: ${errorText(error)}`,
          'error',
        );
      } finally {
        setBusy(false);
      }
    },
    [notify, refetch],
  );

  const perform = useCallback(
    (item: AttentionItem, action: AttentionAction) => {
      switch (action.type) {
        case 'rename': {
          const file = itemFile(item);
          if (file) setDialog({ type: 'rename', files: [file] });
          return;
        }
        case 'reassign-file':
          setDialog({ type: 'reassign', filePath: action.filePath, fileName: action.fileName });
          return;
        case 'assign-queue':
          setDialog({ type: 'assign-queue', queueItemId: action.queueItemId, queueStatus: action.queueStatus });
          return;
        case 'link-disc':
          setDialog({ type: 'link-disc', mediaType: action.mediaType, mediaId: action.mediaId, discId: action.discId, discTitle: action.discTitle });
          return;
        case 'clear-flag':
          void clearFlag(item, action.fileId);
          return;
        case 'rescan':
          void scan.startScan();
          return;
        default:
          // Links are rendered as anchors by the row.
          return;
      }
    },
    [clearFlag, scan],
  );

  const renameMany = useCallback((items: AttentionItem[]) => {
    const files = items.map(itemFile).filter((file): file is MediaFile => file !== null);
    if (files.length > 0) setDialog({ type: 'rename', files });
  }, []);

  const undo = useCallback(
    async (dismissal: Pick<AttentionDismissal, 'id'>): Promise<boolean> => {
      setBusy(true);
      try {
        await AttentionService.undoDismissal(dismissal.id);
        await refetch();
        return true;
      } catch (error) {
        notify(`Could not restore the item: ${errorText(error)}`, 'error');
        return false;
      } finally {
        setBusy(false);
      }
    },
    [notify, refetch],
  );

  const dismiss = useCallback(
    async (item: AttentionItem, days: number | null, note?: string) => {
      setBusy(true);
      try {
        const dismissal = await AttentionService.dismiss({ kind: item.kind, subjectType: item.subjectType, subjectId: item.subjectId, days, note });
        notify(days ? `Dismissed for ${days} days.` : 'Dismissed until it changes.', 'success', {
          action: {
            label: 'Undo',
            onClick: () => {
              void undo(dismissal).then((ok) => ok && notify('Restored.', 'success'));
            },
          },
        });
        await refetch();
      } catch (error) {
        const status = apiErrorStatus(error);
        if (status === 404) {
          notify('This item is already resolved.', 'info');
          await refetch();
        } else if (status === 422) {
          notify('This item cannot be dismissed. Resolve it instead.', 'error');
        } else {
          notify(`Could not dismiss: ${errorText(error)}`, 'error');
        }
      } finally {
        setBusy(false);
      }
    },
    [notify, refetch, undo],
  );

  const onDismiss = useCallback(
    (item: AttentionItem, choice: DismissChoice) => {
      if (choice.withNote) setDialog({ type: 'dismiss-note', item });
      else void dismiss(item, choice.days);
    },
    [dismiss],
  );

  const restore = useCallback(
    async (dismissal: AttentionDismissal) => {
      const ok = await undo(dismissal);
      if (ok) notify('Restored to the To-Do list.', 'success');
      return ok;
    },
    [notify, undo],
  );

  return { dialog, closeDialog, busy: busy || scan.scanning, scanning: scan.scanning, perform, renameMany, dismiss, onDismiss, restore };
}

export type TodoActions = ReturnType<typeof useTodoActions>;
