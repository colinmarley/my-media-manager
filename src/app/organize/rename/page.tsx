'use client';

import React, { Suspense } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Box, ToggleButton, ToggleButtonGroup } from '@mui/material';
import { PageContainer, PageHeader } from '@/components/ui/PageHeader';
import MovieOrganizationPage from '@/app/dashboard/movie-organization/page';
import ShowOrganizationPage from '@/app/dashboard/show-organization/page';

type OrganizerKind = 'movies' | 'shows';

function RenameOrganize() {
  const router = useRouter();
  const pathname = usePathname();
  const kind: OrganizerKind = useSearchParams()?.get('type') === 'shows' ? 'shows' : 'movies';

  return (
    <>
      <PageContainer>
        <PageHeader
          title="Rename & Organize"
          subtitle="Preview and apply Jellyfin folder and file names for processed movies and shows."
          actions={(
            <ToggleButtonGroup
              exclusive
              size="small"
              value={kind}
              onChange={(_event, next: OrganizerKind | null) => {
                if (next) router.replace(`${pathname}?type=${next}`, { scroll: false });
              }}
              aria-label="Organizer"
            >
              <ToggleButton value="movies">Movies</ToggleButton>
              <ToggleButton value="shows">Shows</ToggleButton>
            </ToggleButtonGroup>
          )}
        />
      </PageContainer>
      {/* The organizers bring their own padding; they are the pages at
          /dashboard/movie-organization and /dashboard/show-organization. */}
      <Box sx={{ mt: -3 }}>
        {kind === 'shows' ? <ShowOrganizationPage /> : <MovieOrganizationPage />}
      </Box>
    </>
  );
}

export default function RenameOrganizePage() {
  return (
    <Suspense fallback={null}>
      <RenameOrganize />
    </Suspense>
  );
}
