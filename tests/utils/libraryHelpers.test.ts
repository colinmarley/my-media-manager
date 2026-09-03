import { describe, expect, it } from 'vitest';

import { getFileCount, getMediaType } from '@/app/dashboard/my-library/_components/libraryHelpers';
import { CatalogDisc } from '@/types/catalog/Disc.type';

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

describe('libraryHelpers.getFileCount (legacy releases/discIds fallback)', () => {
  const mediaWithOneLegacyDisc = (discId: string) =>
    ({
      id: 'movie-1',
      title: 'Test Movie',
      releases: [{ discIds: [discId] }],
    }) as any;

  it('uses the real linkedFileCount, including zero, instead of guessing 1 per disc', () => {
    const discMap = new Map<string, CatalogDisc>([
      ['d1', { id: 'd1', title: 'Disc', videoFiles: [], imageFiles: [], isPartOfSet: false, isRentalDisc: false, containsSpecialFeatures: false, linkedFileCount: 0 } as CatalogDisc],
    ]);

    // Not yet ripped (0 linked files) must read as 0, not the old "count the
    // disc as 1 file" guess — that guess is exactly the bug this fixes.
    expect(getFileCount(mediaWithOneLegacyDisc('d1'), discMap)).toBe(0);
  });

  it('reports a nonzero linkedFileCount accurately', () => {
    const discMap = new Map<string, CatalogDisc>([
      ['d1', { id: 'd1', title: 'Disc', videoFiles: [], imageFiles: [], isPartOfSet: false, isRentalDisc: false, containsSpecialFeatures: false, linkedFileCount: 3 } as CatalogDisc],
    ]);

    expect(getFileCount(mediaWithOneLegacyDisc('d1'), discMap)).toBe(3);
  });

  it('falls back to the legacy videoFiles-length guess when linkedFileCount is absent', () => {
    const discMap = new Map<string, CatalogDisc>([
      ['d1', { id: 'd1', title: 'Disc', videoFiles: [{ fileName: 'a.mkv' }, { fileName: 'b.mkv' }], imageFiles: [], isPartOfSet: false, isRentalDisc: false, containsSpecialFeatures: false } as CatalogDisc],
    ]);

    expect(getFileCount(mediaWithOneLegacyDisc('d1'), discMap)).toBe(2);
  });
});
