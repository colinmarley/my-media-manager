'use client';

import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Snackbar,
} from '@mui/material';

export type NotifySeverity = 'success' | 'error' | 'info';

export type NotifyFn = (message: string, severity?: NotifySeverity) => void;

export interface ConfirmOptions {
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
}

export type ConfirmFn = (options: ConfirmOptions | string) => Promise<boolean>;

interface NotificationContextValue {
  notify: NotifyFn;
  confirm: ConfirmFn;
}

interface QueuedNotification {
  key: number;
  message: string;
  severity: NotifySeverity;
}

interface PendingConfirm extends ConfirmOptions {
  resolve: (result: boolean) => void;
}

const NotificationContext = createContext<NotificationContextValue | null>(null);

// Bridge for non-React code (e.g. services) that needs to surface a message.
// The mounted provider registers itself here; without one, messages go to the console.
let globalNotify: NotifyFn | null = null;

export const notify: NotifyFn = (message, severity = 'info') => {
  if (globalNotify) {
    globalNotify(message, severity);
    return;
  }
  if (severity === 'error') {
    console.error(message);
  } else {
    console.info(message);
  }
};

export const NotificationProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [queue, setQueue] = useState<QueuedNotification[]>([]);
  const [open, setOpen] = useState(false);
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm | null>(null);
  const keyRef = useRef(0);

  const current = queue[0];

  const notifyFn = useCallback<NotifyFn>((message, severity = 'info') => {
    keyRef.current += 1;
    setQueue((prev) => [...prev, { key: keyRef.current, message, severity }]);
  }, []);

  const confirmFn = useCallback<ConfirmFn>((options) => {
    const normalized = typeof options === 'string' ? { message: options } : options;
    return new Promise<boolean>((resolve) => {
      setPendingConfirm({ ...normalized, resolve });
    });
  }, []);

  useEffect(() => {
    globalNotify = notifyFn;
    return () => {
      if (globalNotify === notifyFn) {
        globalNotify = null;
      }
    };
  }, [notifyFn]);

  useEffect(() => {
    if (current && !open) {
      setOpen(true);
    }
  }, [current, open]);

  const handleClose = (_event?: React.SyntheticEvent | Event, reason?: string) => {
    if (reason === 'clickaway') {
      return;
    }
    setOpen(false);
  };

  const handleExited = () => {
    setQueue((prev) => prev.slice(1));
  };

  const settleConfirm = (result: boolean) => {
    pendingConfirm?.resolve(result);
    setPendingConfirm(null);
  };

  return (
    <NotificationContext.Provider value={{ notify: notifyFn, confirm: confirmFn }}>
      {children}
      <Snackbar
        key={current?.key}
        open={open && !!current}
        autoHideDuration={current?.severity === 'error' ? 8000 : 4000}
        onClose={handleClose}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
        TransitionProps={{ onExited: handleExited }}
      >
        <Alert onClose={handleClose} severity={current?.severity ?? 'info'} variant="filled" sx={{ width: '100%' }}>
          {current?.message}
        </Alert>
      </Snackbar>
      <Dialog open={!!pendingConfirm} onClose={() => settleConfirm(false)}>
        {pendingConfirm?.title && <DialogTitle>{pendingConfirm.title}</DialogTitle>}
        <DialogContent>
          <DialogContentText>{pendingConfirm?.message}</DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => settleConfirm(false)}>{pendingConfirm?.cancelLabel ?? 'Cancel'}</Button>
          <Button onClick={() => settleConfirm(true)} variant="contained" autoFocus>
            {pendingConfirm?.confirmLabel ?? 'Confirm'}
          </Button>
        </DialogActions>
      </Dialog>
    </NotificationContext.Provider>
  );
};

// Outside a provider (e.g. isolated component tests) notifications fall back to the
// console and confirmations resolve to false.
const fallbackConfirm: ConfirmFn = async () => {
  console.warn('useConfirm called without a NotificationProvider; treating as cancelled');
  return false;
};

export const useNotify = (): NotifyFn => useContext(NotificationContext)?.notify ?? notify;

export const useConfirm = (): ConfirmFn => useContext(NotificationContext)?.confirm ?? fallbackConfirm;
