import { useState } from 'react';

import { DiskReassignMode } from '@/app/dashboard/my-library/_components/DiskReassignDialog';

interface Params {
  onReassigned: (info: { mode: DiskReassignMode; newPath: string }) => void;
}

/** Tracks which disk/file reassign dialog is open and what it points at. */
const useDiskReassign = ({ onReassigned }: Params) => {
  const [diskReassignOpen, setDiskReassignOpen] = useState(false);
  const [diskReassignMode, setDiskReassignMode] = useState<DiskReassignMode>('folder');
  const [diskReassignSource, setDiskReassignSource] = useState<string>('');
  const [diskReassignLabel, setDiskReassignLabel] = useState<string>('');

  const openDiskReassign = (mode: DiskReassignMode, sourcePath: string, sourceLabel: string) => {
    setDiskReassignMode(mode);
    setDiskReassignSource(sourcePath);
    setDiskReassignLabel(sourceLabel);
    setDiskReassignOpen(true);
  };

  const closeDiskReassign = () => setDiskReassignOpen(false);

  const handleReassigned = (newPath: string) => {
    setDiskReassignOpen(false);
    onReassigned({ mode: diskReassignMode, newPath });
  };

  return {
    diskReassignOpen,
    diskReassignMode,
    diskReassignSource,
    diskReassignLabel,
    openDiskReassign,
    closeDiskReassign,
    handleReassigned,
  };
};

export default useDiskReassign;
