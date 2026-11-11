"use client";

import React, { useState } from 'react';
import Link from 'next/link';
import { Button, Tab, Tabs } from '@mui/material';
import { SettingsOutlined } from '@mui/icons-material';
import IngressAutomationPanel from '@/app/admin/_components/IngressAutomationPanel';
import IngressTriageGroups from '@/app/admin/_components/IngressTriageGroups';
import { PageContainer, PageHeader } from '@/components/ui/PageHeader';

const IngressAutomationPage: React.FC = () => {
  const [tab, setTab] = useState<'queue' | 'groups'>('queue');

  return (
    <PageContainer>
      <PageHeader
        title="Queue & Review"
        subtitle="Files the watcher picked up, how they matched, and the ones waiting for your decision."
        actions={(
          <Button variant="outlined" component={Link} href="/settings?tab=ingest" startIcon={<SettingsOutlined />}>
            Ingest settings
          </Button>
        )}
      >
        <Tabs value={tab} onChange={(_, value) => setTab(value)} aria-label="Ingest triage views">
          <Tab label="Queue" value="queue" />
          <Tab label="Review by folder" value="groups" />
        </Tabs>
      </PageHeader>
      {/* Only one view mounts at a time: the flat table pages /queue/items, the grouped view pages /queue/groups. */}
      {tab === 'queue' ? <IngressAutomationPanel /> : <IngressTriageGroups />}
    </PageContainer>
  );
};

export default IngressAutomationPage;
