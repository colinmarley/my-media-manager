'use client';

import React from 'react';
import {
  Checkbox, FormControlLabel, MenuItem, TextField, TextFieldProps,
} from '@mui/material';
import { useController, useFormContext } from 'react-hook-form';

type BaseTextProps = Omit<TextFieldProps, 'name' | 'value' | 'onChange' | 'onBlur' | 'error' | 'select'>;

/** MUI TextField bound to the surrounding form; shows the field's error under it. */
export function FormTextField({ name, helperText, ...props }: BaseTextProps & { name: string }) {
  const { control } = useFormContext();
  const { field, fieldState } = useController({ name, control });
  return (
    <TextField
      {...props}
      name={field.name}
      value={field.value ?? ''}
      onChange={field.onChange}
      onBlur={field.onBlur}
      inputRef={field.ref}
      error={!!fieldState.error}
      helperText={fieldState.error?.message ?? helperText}
    />
  );
}

export interface SelectOption {
  value: string;
  label?: React.ReactNode;
}

/** MUI select bound to the surrounding form. `emptyLabel` adds a leading "no value" option. */
export function FormSelectField({
  name, options, emptyLabel, helperText, ...props
}: BaseTextProps & { name: string; options: readonly SelectOption[]; emptyLabel?: React.ReactNode }) {
  const { control } = useFormContext();
  const { field, fieldState } = useController({ name, control });
  return (
    <TextField
      {...props}
      select
      name={field.name}
      value={field.value ?? ''}
      onChange={field.onChange}
      onBlur={field.onBlur}
      inputRef={field.ref}
      error={!!fieldState.error}
      helperText={fieldState.error?.message ?? helperText}
    >
      {emptyLabel !== undefined && <MenuItem value=""><em>{emptyLabel}</em></MenuItem>}
      {options.map((o) => <MenuItem key={o.value} value={o.value}>{o.label ?? o.value}</MenuItem>)}
    </TextField>
  );
}

/** MUI checkbox bound to a boolean field of the surrounding form. */
export function FormCheckbox({ name, label }: { name: string; label: React.ReactNode }) {
  const { control } = useFormContext();
  const { field } = useController({ name, control });
  return (
    <FormControlLabel
      label={label}
      control={(
        <Checkbox
          name={field.name}
          checked={!!field.value}
          onChange={(e) => field.onChange(e.target.checked)}
          onBlur={field.onBlur}
          inputRef={field.ref}
        />
      )}
    />
  );
}
