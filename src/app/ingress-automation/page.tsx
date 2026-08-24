"use client";

import React from 'react';
import { Box } from '@mui/material';
import IngressAutomationPanel from '@/app/admin/_components/IngressAutomationPanel';

const IngressAutomationPage: React.FC = () => {
  return (
    <Box sx={{ p: 2 }}>
      <IngressAutomationPanel />
    </Box>
  );
};

export default IngressAutomationPage;
