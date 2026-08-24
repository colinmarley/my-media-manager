import { TapeIngestItem } from '@/types/tape-ingest/TapeIngest.type';

function slugify(text: string): string {
  return text.replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '_');
}

function buildHomeVideoDatePart(item: TapeIngestItem): string {
  const meta = item.homeVideoMetadata;
  if (!meta?.date) return '';
  if (meta.dateEnd) return `${meta.date}_to_${meta.dateEnd}`;
  return meta.date;
}

export function buildDestinationPreview(item: TapeIngestItem, destinationBase: string): string | null {
  if (item.contentType === 'movie' && item.movieMetadata) {
    const name = `${item.movieMetadata.title} (${item.movieMetadata.year})`;
    return `${destinationBase}/Movies/${name}/${name}.mp4`;
  }
  if (item.contentType === 'tv_show' && item.tvShowMetadata) {
    const series = item.tvShowMetadata.seriesYear
      ? `${item.tvShowMetadata.seriesTitle} (${item.tvShowMetadata.seriesYear})`
      : item.tvShowMetadata.seriesTitle;
    const s = String(item.tvShowMetadata.seasonNumber).padStart(2, '0');
    const e = String(item.tvShowMetadata.episodeNumber).padStart(2, '0');
    return `${destinationBase}/TV Shows/${series}/Season ${s}/${item.tvShowMetadata.seriesTitle} - S${s}E${e} - ${item.tvShowMetadata.episodeTitle}.mp4`;
  }
  if (item.contentType === 'home_video' && item.homeVideoMetadata) {
    const datePart = buildHomeVideoDatePart(item);
    const titleSlug = slugify(item.homeVideoMetadata.title);
    const folderName = datePart ? `${datePart}_${titleSlug}` : titleSlug;
    return `${destinationBase}/Home Videos/${folderName}/${folderName}.mp4`;
  }
  if (item.contentType === 'trailer' && item.promoMetadata) {
    const targetFolder = slugify(item.promoMetadata.targetName) || 'Unknown';
    const title = slugify(item.promoMetadata.title) || 'Trailer';
    const targetType = item.promoMetadata.targetType.charAt(0).toUpperCase() + item.promoMetadata.targetType.slice(1);
    return `${destinationBase}/Extras/Trailers/${targetType}/${targetFolder}/${title}.mp4`;
  }
  if (item.contentType === 'commercial' && item.promoMetadata) {
    const targetFolder = slugify(item.promoMetadata.targetName) || 'Unknown';
    const title = slugify(item.promoMetadata.title) || 'Commercial';
    const targetType = item.promoMetadata.targetType.charAt(0).toUpperCase() + item.promoMetadata.targetType.slice(1);
    return `${destinationBase}/Extras/Commercials/${targetType}/${targetFolder}/${title}.mp4`;
  }
  if (item.contentType === 'skip') return 'Skipped — file will not be processed';
  if (item.contentType === 'unclassified') return `${destinationBase}/_NeedsReview/${item.fileName}`;
  return null;
}
