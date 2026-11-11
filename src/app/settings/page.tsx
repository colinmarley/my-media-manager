'use client';

import React, { Suspense } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Box, Tab, Tabs } from '@mui/material';
import { PageContainer, PageHeader } from '@/components/ui/PageHeader';
import IngestSettingsTab from './_components/IngestSettingsTab';
import TapeSettingsTab from './_components/TapeSettingsTab';
import LibraryNamingTab from './_components/LibraryNamingTab';

const SETTINGS_TABS = [
  { value: 'ingest', label: 'Ingest', Panel: IngestSettingsTab },
  { value: 'tape', label: 'Tape', Panel: TapeSettingsTab },
  { value: 'library', label: 'Library & Naming', Panel: LibraryNamingTab },
] as const;

type SettingsTab = (typeof SETTINGS_TABS)[number]['value'];

function resolveTab(value: string | null | undefined): SettingsTab {
  return SETTINGS_TABS.some((t) => t.value === value) ? (value as SettingsTab) : 'ingest';
}

function SettingsTabs() {
  const router = useRouter();
  const pathname = usePathname();
  const tab = resolveTab(useSearchParams()?.get('tab'));
  const active = SETTINGS_TABS.find((t) => t.value === tab) ?? SETTINGS_TABS[0];

  return (
    <>
      <Tabs
        value={tab}
        onChange={(_event, next: SettingsTab) => router.replace(`${pathname}?tab=${next}`, { scroll: false })}
        aria-label="Settings sections"
        sx={{ mb: 3 }}
      >
        {SETTINGS_TABS.map((t) => (
          <Tab key={t.value} value={t.value} label={t.label} id={`settings-tab-${t.value}`} aria-controls={`settings-panel-${t.value}`} />
        ))}
      </Tabs>
      <Box role="tabpanel" id={`settings-panel-${tab}`} aria-labelledby={`settings-tab-${tab}`}>
        <active.Panel />
      </Box>
    </>
  );
}

export default function SettingsPage() {
  return (
    <PageContainer maxWidth={880}>
      <PageHeader title="Settings" subtitle="Ingest automation, tape capture and library naming." />
      <Suspense fallback={null}>
        <SettingsTabs />
      </Suspense>
    </PageContainer>
  );
}
