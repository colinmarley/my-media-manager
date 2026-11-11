'use client';

import React from 'react';

import DiskReassignDialog from '@/app/dashboard/my-library/_components/DiskReassignDialog';
import RenameCanonicalDialog from '@/app/dashboard/my-library/_components/detail/RenameCanonicalDialog';
import { useNotify } from '@/context/NotificationContext';
import DismissNoteDialog from './DismissNoteDialog';
import LinkDiscLauncher from './LinkDiscLauncher';
import QueueAssignLauncher from './QueueAssignLauncher';
import type { TodoActions } from './useTodoActions';

interface Props {
  actions: TodoActions;
  refetch: () => Promise<unknown>;
}

/** The one dialog a To-Do row has open, reusing the title page's and the ingest queue's dialogs. */
const TodoDialogs = ({ actions, refetch }: Props) => {
  const notify = useNotify();
  const { dialog, closeDialog } = actions;

  return (
    <>
      <RenameCanonicalDialog
        open={dialog?.type === 'rename'}
        files={dialog?.type === 'rename' ? dialog.files : []}
        onClose={closeDialog}
        onApplied={refetch}
        onUnavailable={() => {}}
      />

      {dialog?.type === 'reassign' && (
        <DiskReassignDialog
          open
          mode="file"
          sourcePath={dialog.filePath}
          sourceLabel={dialog.fileName}
          onClose={closeDialog}
          onReassigned={(newPath) => {
            closeDialog();
            notify(`File moved to: ${newPath}`, 'success');
            void refetch();
          }}
        />
      )}

      {dialog?.type === 'assign-queue' && (
        <QueueAssignLauncher
          queueItemId={dialog.queueItemId}
          queueStatus={dialog.queueStatus}
          onClose={closeDialog}
          onAssigned={refetch}
        />
      )}

      {dialog?.type === 'link-disc' && (
        <LinkDiscLauncher
          mediaType={dialog.mediaType}
          mediaId={dialog.mediaId}
          discId={dialog.discId}
          discTitle={dialog.discTitle}
          onClose={closeDialog}
          onLinked={refetch}
        />
      )}

      <DismissNoteDialog
        item={dialog?.type === 'dismiss-note' ? dialog.item : null}
        onClose={closeDialog}
        onDismiss={(item, days, note) => {
          closeDialog();
          void actions.dismiss(item, days, note);
        }}
      />
    </>
  );
};

export default TodoDialogs;
