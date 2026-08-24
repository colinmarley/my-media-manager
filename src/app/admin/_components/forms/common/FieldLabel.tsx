import React from 'react';
import { Stack, Typography } from '@mui/material';
import InfoTooltip from './InfoTooltip';

interface FieldLabelProps {
  label: string;
  tooltip: string;
}

const FieldLabel: React.FC<FieldLabelProps> = ({ label, tooltip }) => {
  return (
    <Stack direction="row" spacing={0.5} alignItems="center">
      <Typography component="span" sx={{ fontSize: 'inherit', color: 'inherit' }}>
        {label}
      </Typography>
      <InfoTooltip title={tooltip} />
    </Stack>
  );
};

export default FieldLabel;
