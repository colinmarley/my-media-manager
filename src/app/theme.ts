import { alpha, createTheme, type TypographyVariantsOptions } from '@mui/material/styles';
import {
  accent,
  borders,
  fontFamilies,
  radii,
  spacingUnit,
  status,
  surfaces,
  text,
  typeScale,
} from '@/theme/tokens';

function typeVariants(): TypographyVariantsOptions {
  const variants: Record<string, object> = {};
  for (const [name, [size, line, weight]] of Object.entries(typeScale)) {
    variants[name] = {
      fontSize: `${size / 16}rem`,
      lineHeight: `${line}px`,
      fontWeight: weight,
      letterSpacing: size >= 18 ? '-0.01em' : 0,
    };
  }
  return {
    fontFamily: fontFamilies.sans,
    fontSize: 14,
    ...variants,
    button: { ...variants.button, textTransform: 'none' },
    overline: { ...variants.overline, letterSpacing: '0.04em', textTransform: 'none' },
  };
}

const theme = createTheme({
  spacing: spacingUnit,
  shape: { borderRadius: radii.sm },
  palette: {
    mode: 'dark',
    background: { default: surfaces.canvas, paper: surfaces.paper },
    primary: { main: accent.main, light: accent.light, dark: accent.dark, contrastText: accent.contrastText },
    secondary: { main: text.secondary, contrastText: surfaces.canvas },
    success: { main: status.success.fg },
    warning: { main: status.warning.fg },
    error: { main: status.error.fg },
    info: { main: status.info.fg },
    text: { primary: text.primary, secondary: text.secondary, disabled: text.disabled },
    divider: borders.subtle,
    action: {
      hover: alpha(text.primary, 0.05),
      selected: accent.tint,
      focus: alpha(accent.main, 0.24),
    },
  },
  typography: typeVariants(),
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        body: { backgroundColor: surfaces.canvas, color: text.primary },
        'code, pre, kbd': { fontFamily: fontFamilies.mono },
      },
    },
    MuiPaper: {
      defaultProps: { elevation: 0 },
      styleOverrides: {
        root: { backgroundImage: 'none' },
        outlined: { borderColor: borders.default },
      },
    },
    MuiCard: {
      defaultProps: { variant: 'outlined' },
      styleOverrides: { root: { borderRadius: radii.md, borderColor: borders.default } },
    },
    MuiCardContent: {
      styleOverrides: { root: { padding: 16, '&:last-child': { paddingBottom: 16 } } },
    },
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: {
        root: { borderRadius: radii.sm, minHeight: 32, paddingInline: 12 },
        sizeSmall: { minHeight: 28, paddingInline: 10 },
        sizeLarge: { minHeight: 40, paddingInline: 16 },
        outlined: { borderColor: borders.strong },
      },
    },
    MuiIconButton: {
      styleOverrides: { root: { borderRadius: radii.sm } },
    },
    MuiButtonBase: {
      styleOverrides: {
        root: {
          '&.Mui-focusVisible': { outline: `2px solid ${accent.main}`, outlineOffset: 2 },
        },
      },
    },
    MuiTextField: { defaultProps: { size: 'small' } },
    MuiFormControl: { defaultProps: { size: 'small' } },
    MuiSelect: { defaultProps: { size: 'small' } },
    MuiOutlinedInput: {
      styleOverrides: {
        root: {
          backgroundColor: surfaces.raised,
          '& .MuiOutlinedInput-notchedOutline': { borderColor: borders.default },
          '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: borders.strong },
        },
      },
    },
    MuiChip: {
      styleOverrides: { root: { borderRadius: radii.sm, fontWeight: 500 } },
    },
    MuiTabs: {
      styleOverrides: {
        root: { minHeight: 40, borderBottom: `1px solid ${borders.subtle}` },
        indicator: { height: 2 },
      },
    },
    MuiTab: {
      styleOverrides: {
        root: { minHeight: 40, paddingInline: 12, minWidth: 0, fontWeight: 500, textTransform: 'none' },
      },
    },
    MuiTableCell: {
      styleOverrides: {
        root: { borderColor: borders.subtle },
        head: { color: text.secondary, fontWeight: 600, fontSize: '0.8125rem' },
        sizeSmall: { paddingBlock: 6 },
      },
    },
    MuiDialog: {
      styleOverrides: { paper: { borderRadius: radii.lg, border: `1px solid ${borders.default}` } },
    },
    MuiMenu: {
      styleOverrides: { paper: { border: `1px solid ${borders.default}` } },
    },
    MuiTooltip: {
      styleOverrides: {
        tooltip: { backgroundColor: surfaces.selected, color: text.primary, fontSize: '0.75rem', border: `1px solid ${borders.strong}` },
      },
    },
    MuiAlert: {
      styleOverrides: { root: { borderRadius: radii.md } },
    },
    MuiLinearProgress: {
      styleOverrides: { root: { borderRadius: 2 } },
    },
  },
});

export default theme;
