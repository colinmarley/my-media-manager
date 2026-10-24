'use client';

import React from 'react';
import { Stack, TextField } from '@mui/material';
import { LoanFields, todayIso } from '@/utils/loanUtils';

/** "Lent to" / "since" / "returned on" row shared by the disc and tape edit dialogs. */
export default function LoanInputs({
  value,
  onChange,
}: {
  value: LoanFields;
  onChange: (value: LoanFields) => void;
}) {
  return (
    <Stack direction="row" spacing={2}>
      <TextField
        label="Lent to" value={value.lentTo}
        onChange={(e) => onChange({ ...value, lentTo: e.target.value })} fullWidth size="small"
      />
      <TextField
        label="Since" type="date" value={value.since}
        onChange={(e) => onChange({ ...value, since: e.target.value })} fullWidth size="small"
        slotProps={{ inputLabel: { shrink: true }, htmlInput: { max: todayIso() } }}
      />
      <TextField
        label="Returned on" type="date" value={value.returnedOn}
        onChange={(e) => onChange({ ...value, returnedOn: e.target.value })} fullWidth size="small"
        slotProps={{ inputLabel: { shrink: true }, htmlInput: { min: value.since || undefined } }}
      />
    </Stack>
  );
}
