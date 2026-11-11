/**
 * Design tokens for the web app. Every colour, radius and type size the theme
 * (src/app/theme.ts) and the shell use comes from here, so a palette change is
 * one edit. Components should read these through the MUI theme
 * (`theme.palette.*`, `theme.shape`, `sx` spacing) rather than importing hex
 * values; import this module directly only for things MUI has no slot for
 * (sidebar widths, status colours keyed by our own status names).
 */

/** Neutral greys with a slight blue cast — the "rack-mounted equipment" base. */
export const surfaces = {
  /** App background behind everything. */
  canvas: '#121519',
  /** Sidebar and top bar. */
  chrome: '#171b20',
  /** Cards, panels, dialogs. */
  paper: '#1c2127',
  /** Inputs, hovered rows, nested panels. */
  raised: '#232931',
  /** Selected nav item / selected rows. */
  selected: '#2a323d',
} as const;

export const borders = {
  subtle: '#262c34',
  default: '#313844',
  strong: '#434c5a',
} as const;

export const text = {
  primary: '#e4e8ee',
  secondary: '#9ba5b3',
  disabled: '#6a7380',
} as const;

/** One accent. Used for primary actions, focus rings and the active nav item. */
export const accent = {
  main: '#6e9fe8',
  light: '#97bbf0',
  dark: '#4f80c9',
  contrastText: '#0e1622',
  /** Translucent fill for selected / hovered accent surfaces. */
  tint: 'rgba(110, 159, 232, 0.14)',
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
  sm: 4,
  /** Cards, panels, menus. */
  md: 6,
  /** Dialogs. */
  lg: 10,
} as const;

export const layout = {
  sidebarWidth: 232,
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
  radii,
  layout,
  fontFamilies,
  typeScale,
} as const;

export default tokens;
