'use client';

import React, { useEffect, useRef, useState } from 'react';

import LinkFileToDiscDialog, { type SourceOption } from '@/app/dashboard/my-library/_components/detail/LinkFileToDiscDialog';
import { useNotify } from '@/context/NotificationContext';
import { flattenFileGroups, forEachFile, getMediaFiles, linkFile } from '@/service/library/MediaFilesService';
import { fileSource } from '@/service/library/mediaFileModel';
import type { MediaFile } from '@/types/library/MediaFile.type';

interface Props {
  mediaType: string;
  mediaId: string;
  discId: string;
  discTitle: string;
  onClose: () => void;
  onLinked: () => Promise<unknown> | void;
}

const plural = (n: number) => `${n} file${n === 1 ? '' : 's'}`;

/**
 * "No source disc": loads the title's files that have no disc or tape yet (main feature first)
 * and opens the title page's link dialog with the disc as the target.
 */
const LinkDiscLauncher = ({ mediaType, mediaId, discId, discTitle, onClose, onLinked }: Props) => {
  const notify = useNotify();
  const [files, setFiles] = useState<MediaFile[] | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await getMediaFiles(mediaType, mediaId);
        if (!cancelled) setFiles(flattenFileGroups(response).filter((file) => !fileSource(file)));
      } catch (error) {
        if (cancelled) return;
        notify(`Could not load the title's files: ${error instanceof Error ? error.message : 'unknown error'}`, 'error');
        onCloseRef.current();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [mediaType, mediaId, notify]);

  const target: SourceOption = { kind: 'disc', id: discId, title: discTitle };

  const link = async (fileIds: string[], to: SourceOption) => {
    const { succeeded, failed } = await forEachFile(fileIds, (id) => linkFile(id, to));
    if (failed.length === 0) notify(`Linked ${plural(succeeded.length)} to "${to.title}".`, 'success');
    else notify(`Linked ${plural(succeeded.length)}; ${plural(failed.length)} failed.`, 'error');
    await onLinked();
  };

  if (!files) return null;
  return (
    <LinkFileToDiscDialog
      open
      onClose={onClose}
      files={files}
      target={target}
      sources={[target]}
      onLink={link}
    />
  );
};

export default LinkDiscLauncher;
