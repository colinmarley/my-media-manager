import { useCallback, useEffect, useRef, useState } from 'react';

import { useNotify } from '@/context/NotificationContext';
import { getInventoryStatus, triggerInventoryScan } from '@/service/library/MediaFilesService';

interface Params {
  /** Called once the scan finishes, to reload the title. */
  onFinished: () => Promise<unknown> | void;
  pollMs?: number;
}

/**
 * "Rescan files": starts the library inventory scan (or joins the one already running) and
 * polls its status until it stops, then refetches the title.
 */
const useInventoryScan = ({ onFinished, pollMs = 2000 }: Params) => {
  const notify = useNotify();
  const [scanning, setScanning] = useState(false);
  const [phase, setPhase] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  const onFinishedRef = useRef(onFinished);
  onFinishedRef.current = onFinished;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const poll = useCallback(async () => {
    if (!mountedRef.current) return;
    try {
      const status = await getInventoryStatus();
      if (!mountedRef.current) return;
      setPhase(status.phase);
      if (status.running) {
        timerRef.current = setTimeout(poll, pollMs);
        return;
      }
      setScanning(false);
      notify('Library scan finished.', 'success');
      await onFinishedRef.current();
    } catch (err) {
      if (!mountedRef.current) return;
      setScanning(false);
      notify(`Could not read the scan status: ${err instanceof Error ? err.message : 'unknown error'}`, 'error');
    }
  }, [notify, pollMs]);

  const startScan = useCallback(async () => {
    if (scanning) return;
    setScanning(true);
    setPhase(null);
    try {
      const result = await triggerInventoryScan();
      notify(result === 'already-running' ? 'A library scan is already running; waiting for it.' : 'Library scan started.', 'info');
      timerRef.current = setTimeout(poll, pollMs);
    } catch (err) {
      setScanning(false);
      notify(`Could not start the scan: ${err instanceof Error ? err.message : 'unknown error'}`, 'error');
    }
  }, [notify, poll, pollMs, scanning]);

  return { scanning, phase, startScan };
};

export default useInventoryScan;
