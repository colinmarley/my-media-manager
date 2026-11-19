/**
 * Design tokens for the web app. Every colour, radius and type size the theme
 * (src/app/theme.ts) and the shell use comes from here, so a palette change is
 * one edit. Components should read these through the MUI theme
 * (`theme.palette.*`, `theme.shape`, `sx` spacing) rather than importing hex
 * values; import this module directly only for things MUI has no slot for
 * (sidebar widths, status colours keyed by our own status names).
 */

/**
 * Neutral graphite, darkest at the back. Each step up is one level of
 * elevation: canvas < chrome < paper < raised < selected.
 */
export const surfaces = {
  /** Wells: log output, code, poster placeholders. */
  sunken: '#090a0b',
  /** App background behind everything. */
  canvas: '#0d0e10',
  /** Sidebar and top bar. */
  chrome: '#111215',
  /** Cards, panels, dialogs. */
  paper: '#16181b',
  /** Menus, hovered rows, nested panels, secondary buttons. */
  raised: '#1d2024',
  /** Selected nav item / selected rows. */
  selected: '#262a30',
} as const;

export const borders = {
  subtle: '#1f2226',
  default: '#2a2e34',
  strong: '#3d424a',
} as const;

export const text = {
  primary: '#eceef2',
  secondary: '#a1a7b3',
  disabled: '#666c77',
} as const;

/**
 * One accent. `main` is a fill (primary buttons, checked controls) and carries
 * white text; `light` is the accent as text or an icon on a dark surface.
 */
export const accent = {
  main: '#3570e6',
  light: '#8fb4ff',
  dark: '#2a5cc4',
  contrastText: '#ffffff',
  /** Translucent fill for selected / hovered accent surfaces. */
  tint: 'rgba(79, 134, 247, 0.16)',
  /** Focus ring around inputs. */
  ring: 'rgba(79, 134, 247, 0.32)',
} as const;

/** Shadows for things that float above the page. Flat panels use borders instead. */
export const shadows = {
  menu: '0 10px 28px rgba(0, 0, 0, 0.55), 0 2px 6px rgba(0, 0, 0, 0.35)',
  dialog: '0 28px 72px rgba(0, 0, 0, 0.65), 0 4px 12px rgba(0, 0, 0, 0.4)',
} as const;

export type StatusTone = 'success' | 'warning' | 'error' | 'info' | 'neutral';

export interface StatusColor {
  /** Text / icon / dot colour. */
  fg: string;
  /** Translucent chip / badge background. */
  bg: string;
  /** Hairline border for outlined chips. */
  border: string;
}

export const status: Record<StatusTone, StatusColor> = {
  success: { fg: '#5fbf8f', bg: 'rgba(95, 191, 143, 0.14)', border: 'rgba(95, 191, 143, 0.35)' },
  warning: { fg: '#e2b04f', bg: 'rgba(226, 176, 79, 0.14)', border: 'rgba(226, 176, 79, 0.35)' },
  error: { fg: '#e86a64', bg: 'rgba(232, 106, 100, 0.14)', border: 'rgba(232, 106, 100, 0.38)' },
  info: { fg: '#62b0dc', bg: 'rgba(98, 176, 220, 0.14)', border: 'rgba(98, 176, 220, 0.35)' },
  neutral: { fg: '#9ba5b3', bg: 'rgba(155, 165, 179, 0.12)', border: 'rgba(155, 165, 179, 0.3)' },
};

/** MUI spacing unit in px (`sx={{ p: 2 }}` = 16px). */
export const spacingUnit = 8;

export const radii = {
  /** Chips, inputs, buttons. */
  sm: 6,
  /** Cards, panels, menus. */
  md: 8,
  /** Dialogs. */
  lg: 12,
} as const;

export const layout = {
  sidebarWidth: 236,
  railWidth: 60,
  topBarHeight: 52,
  /** Horizontal page gutter, in spacing units, per breakpoint. */
  pageGutter: { xs: 2, md: 3 },
} as const;

export const fontFamilies = {
  sans: 'var(--font-sans), "Segoe UI", system-ui, -apple-system, sans-serif',
  mono: 'var(--font-mono), ui-monospace, "Cascadia Mono", Consolas, monospace',
} as const;

/**
 * Type scale: a 1.2 ratio around a 14px body, which keeps data tables dense
 * while headings stay clearly ranked. [fontSize px, lineHeight px, weight]
 */
export const typeScale = {
  h1: [28, 36, 600],
  h2: [24, 32, 600],
  h3: [20, 28, 600],
  h4: [18, 26, 600],
  h5: [16, 24, 600],
  h6: [14, 20, 600],
  subtitle1: [14, 20, 500],
  subtitle2: [13, 18, 500],
  body1: [14, 21, 400],
  body2: [13, 19, 400],
  caption: [12, 16, 400],
  overline: [11, 16, 600],
  button: [13, 20, 500],
} as const satisfies Record<string, readonly [number, number, number]>;

export const tokens = {
  surfaces,
  borders,
  text,
  accent,
  status,
  spacingUnit,
  shadows,
  radii,
  layout,
  fontFamilies,
  typeScale,
} as const;

export default tokens;
