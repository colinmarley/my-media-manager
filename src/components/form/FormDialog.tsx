'use client';

import React, { useEffect, useRef, useState } from 'react';
import {
  Alert, Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, DialogProps,
} from '@mui/material';
import { FieldErrors, FieldValues, FormProvider, get, UseFormReturn, useFormState } from 'react-hook-form';
import { UNSAVED_CHANGES_MESSAGE, useUnsavedChangesGuard } from './useUnsavedChangesGuard';

export function getErrorMessage(e: unknown, fallback: string): string {
  return e instanceof Error && e.message ? e.message : fallback;
}

/** Focus and scroll to the first invalid field in DOM order (not schema order). */
function focusFirstInvalid<T extends FieldValues>(
  container: HTMLElement | null,
  form: UseFormReturn<T, any, any>,
  errors: FieldErrors<T>,
) {
  if (!container) return;
  const el = Array.from(container.querySelectorAll<HTMLElement>('[name]'))
    .find((node) => get(errors, node.getAttribute('name')!));
  if (!el) return;
  form.setFocus(el.getAttribute('name') as never);
  el.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
}

export interface FormDialogProps<TIn extends FieldValues, TOut extends FieldValues> {
  open: boolean;
  title: React.ReactNode;
  form: UseFormReturn<TIn, any, TOut>;
  /** Called with schema-parsed values. Throw to show the error at the top of the form. */
  onSubmit: (values: TOut) => Promise<void> | void;
  onClose: () => void;
  submitLabel: React.ReactNode;
  cancelLabel?: React.ReactNode;
  /** Error text used when the thrown value has no message. */
  submitErrorFallback?: string;
  maxWidth?: DialogProps['maxWidth'];
  children: React.ReactNode;
}

/**
 * Dialog shell for react-hook-form forms: submit shows progress and is
 * disabled while saving, the first invalid field is focused on a failed
 * submit, unsaved changes are confirmed before closing or navigating away,
 * and errors thrown by onSubmit are shown at the top of the form.
 */
export default function FormDialog<TIn extends FieldValues, TOut extends FieldValues>({
  open, title, form, onSubmit, onClose, submitLabel, cancelLabel = 'Cancel',
  submitErrorFallback = 'Failed to save', maxWidth = 'sm', children,
}: FormDialogProps<TIn, TOut>) {
  const { isDirty, isSubmitting } = useFormState({ control: form.control });
  const [serverError, setServerError] = useState('');
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (open) setServerError('');
  }, [open]);

  useUnsavedChangesGuard(open && isDirty);

  const requestClose = () => {
    if (isSubmitting) return;
    if (isDirty && !window.confirm(UNSAVED_CHANGES_MESSAGE)) return;
    onClose();
  };

  const submit = form.handleSubmit(
    async (values) => {
      setServerError('');
      try {
        await onSubmit(values);
      } catch (e: unknown) {
        setServerError(getErrorMessage(e, submitErrorFallback));
      }
    },
    (errors) => focusFirstInvalid(formRef.current, form, errors),
  );

  return (
    <Dialog open={open} onClose={requestClose} maxWidth={maxWidth} fullWidth>
      <FormProvider {...form}>
        <Box component="form" ref={formRef} noValidate onSubmit={submit} sx={{ display: 'contents' }}>
          <DialogTitle>{title}</DialogTitle>
          <DialogContent>
            {serverError && <Alert severity="error" sx={{ mt: 1 }}>{serverError}</Alert>}
            {children}
          </DialogContent>
          <DialogActions>
            <Button onClick={requestClose} disabled={isSubmitting}>{cancelLabel}</Button>
            <Button
              type="submit"
              variant="contained"
              disabled={isSubmitting}
              startIcon={isSubmitting ? <CircularProgress size={16} color="inherit" /> : undefined}
            >
              {isSubmitting ? 'Saving…' : submitLabel}
            </Button>
          </DialogActions>
        </Box>
      </FormProvider>
    </Dialog>
  );
}
