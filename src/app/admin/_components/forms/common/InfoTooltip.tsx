import React from 'react';
import InfoOutlined from '@mui/icons-material/InfoOutlined';
import { Box, Tooltip } from '@mui/material';

interface InfoTooltipProps {
  title: string;
}

const InfoTooltip: React.FC<InfoTooltipProps> = ({ title }) => {
  return (
    <Tooltip title={title} arrow enterTouchDelay={0}>
      <Box
        component="span"
        sx={{
          color: 'rgba(255,255,255,0.72)',
          display: 'inline-flex',
          alignItems: 'center',
          lineHeight: 0,
        }}
        aria-hidden="true"
      >
        <InfoOutlined fontSize="inherit" />
      </Box>
    </Tooltip>
  );
};

export default InfoTooltip;
