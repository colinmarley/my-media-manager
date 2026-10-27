"use client";

import React, { useState } from 'react';
import { Box, Tab, Tabs } from '@mui/material';
import IngressAutomationPanel from '@/app/admin/_components/IngressAutomationPanel';
import IngressTriageGroups from '@/app/admin/_components/IngressTriageGroups';

const IngressAutomationPage: React.FC = () => {
  const [tab, setTab] = useState<'queue' | 'groups'>('queue');

  return (
    <Box sx={{ p: 2 }}>
      <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 2 }}>
        <Tabs value={tab} onChange={(_, value) => setTab(value)} aria-label="Ingress triage views">
          <Tab label="Queue" value="queue" />
          <Tab label="Review by folder" value="groups" />
        </Tabs>
      </Box>
      {/* Only one view mounts at a time: the flat table pages /queue/items, the grouped view pages /queue/groups. */}
      {tab === 'queue' ? <IngressAutomationPanel /> : <IngressTriageGroups />}
    </Box>
  );
};

export default IngressAutomationPage;
