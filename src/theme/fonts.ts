import localFont from 'next/font/local';

/**
 * Self-hosted Geist (already in src/app/fonts). The CSS variables are read by
 * `fontFamilies` in ./tokens, so the theme never names a font file.
 */
export const sansFont = localFont({
  src: '../app/fonts/GeistVF.woff',
  variable: '--font-sans',
  weight: '100 900',
  display: 'swap',
});

export const monoFont = localFont({
  src: '../app/fonts/GeistMonoVF.woff',
  variable: '--font-mono',
  weight: '100 900',
  display: 'swap',
});

export const fontVariables = `${sansFont.variable} ${monoFont.variable}`;
