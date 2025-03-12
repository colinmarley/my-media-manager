import React from 'react';
import TextField from '@mui/material/TextField';

const FormTextField = (
  props: { 
    label: string,
    value: string,
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => void,
    error?: string | null,
    required?: boolean,
    multiline?: boolean
  }) => {
  const { label, value, onChange, error, required = true, multiline = false } = props;
  return (
    <TextField
      label={label}
      value={value}
      onChange={onChange}
      sx={{ input: { color: 'white' }, label: { color: 'white' } }}
      fullWidth
      multiline={multiline}
      required={required}
      error={!!error}
      helperText={error}
    />
  );
};

export default FormTextField;