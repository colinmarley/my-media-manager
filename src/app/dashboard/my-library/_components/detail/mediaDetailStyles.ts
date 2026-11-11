import { borders, fontFamilies, surfaces, text } from '@/theme/tokens';

/**
 * Shared section styling for the library title detail page, on the app theme's tokens
 * (src/theme/tokens.ts). Colours come from the theme, so these only set structure.
 */
export const styles = {
  sectionCard: {
    p: 2,
    bgcolor: surfaces.paper,
    border: `1px solid ${borders.default}`,
    borderRadius: 1.5,
  },
  sectionTitle: {
    mb: 1,
  },
  posterCard: {
    p: 1.5,
    bgcolor: surfaces.paper,
    border: `1px solid ${borders.default}`,
    borderRadius: 1.5,
  },
  poster: {
    width: '100%',
    borderRadius: 1,
    maxHeight: 640,
    objectFit: 'cover',
    display: 'block',
  },
  metaLabel: {
    color: text.secondary,
  },
  preBlock: {
    m: 0,
    overflowX: 'auto',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    p: 1.5,
    borderRadius: 1,
    bgcolor: surfaces.canvas,
    border: `1px solid ${borders.subtle}`,
    fontFamily: fontFamilies.mono,
    fontSize: '0.75rem',
    maxHeight: 420,
  },
  listItem: {
    borderBottom: `1px solid ${borders.subtle}`,
  },
  mono: {
    fontFamily: fontFamilies.mono,
  },
} as const;

export default styles;
