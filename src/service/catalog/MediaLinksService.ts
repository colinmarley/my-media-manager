import { api } from '@/service/api/apiClient';
import { CatalogDisc } from '@/types/catalog/Disc.type';
import { CatalogTape } from '@/types/catalog/Tape.type';

export async function getDiscsAndTapesForMedia(
  mediaType: 'movie' | 'series',
  mediaId: string
): Promise<{ discs: CatalogDisc[]; tapes: CatalogTape[] }> {
  return api.get(`/api/catalog/media/${mediaType}/${mediaId}/discs`);
}
