import { describe, expect, it } from 'vitest';

import { getMediaType } from '@/app/dashboard/my-library/_components/libraryHelpers';

describe('libraryHelpers.getMediaType', () => {
  it('treats direct TV Shows folder paths as series even when seasons are not populated', () => {
    const media = {
      id: 'series-1',
      title: 'It',
      folderPath: '/ark/media/jellyfin/TV Shows/It (1990) [imdbid-tt0099864]',
    } as any;

    expect(getMediaType(media)).toBe('series');
  });
});
