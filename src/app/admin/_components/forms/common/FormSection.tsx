import React from 'react';
import { Paper, Stack, Typography } from '@mui/material';
import InfoTooltip from './InfoTooltip';

interface FormSectionProps {
  title: string;
  description?: string;
  titleTooltip?: string;
  children: React.ReactNode;
}

const FormSection: React.FC<FormSectionProps> = ({ title, description, titleTooltip, children }) => {
  return (
    <Paper
      elevation={0}
      sx={{
        p: 2,
        backgroundColor: 'rgba(255, 255, 255, 0.03)',
        border: '1px solid rgba(255, 255, 255, 0.12)',
        borderRadius: 2,
      }}
    >
      <Stack spacing={2}>
        <Stack spacing={0.5}>
          <Stack direction="row" spacing={0.75} alignItems="center">
            <Typography variant="h6" color="white">
              {title}
            </Typography>
            {titleTooltip && <InfoTooltip title={titleTooltip} />}
          </Stack>
          {description && (
            <Typography variant="body2" color="rgba(255, 255, 255, 0.7)">
              {description}
            </Typography>
          )}
        </Stack>
        {children}
      </Stack>
    </Paper>
  );
};

export default FormSection;
