import { alpha, createTheme, type TypographyVariantsOptions } from '@mui/material/styles';
import type {} from '@mui/x-data-grid/themeAugmentation';
import {
  accent,
  borders,
  fontFamilies,
  radii,
  shadows,
  spacingUnit,
  status,
  surfaces,
  text,
  typeScale,
  type StatusTone,
} from '@/theme/tokens';

function typeVariants(): TypographyVariantsOptions {
  const variants: Record<string, object> = {};
  for (const [name, [size, line, weight]] of Object.entries(typeScale)) {
    variants[name] = {
      fontSize: `${size / 16}rem`,
      lineHeight: `${line}px`,
      fontWeight: weight,
      letterSpacing: size >= 18 ? '-0.015em' : 0,
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

const SEVERITIES = ['success', 'warning', 'error', 'info'] as const;
const CHIP_TONES: Array<[StatusTone, 'success' | 'warning' | 'error' | 'info' | 'primary' | 'secondary']> = [
  ['success', 'success'],
  ['warning', 'warning'],
  ['error', 'error'],
  ['info', 'info'],
  ['info', 'primary'],
  ['neutral', 'secondary'],
];

/** Hairline + soft fill: the look every floating surface (menu, popover, select list) shares. */
const floating = {
  backgroundColor: surfaces.raised,
  backgroundImage: 'none',
  border: `1px solid ${borders.default}`,
  boxShadow: shadows.menu,
} as const;

const focusRing = { outline: `2px solid ${accent.light}`, outlineOffset: 2 } as const;

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
      selected: alpha(text.primary, 0.08),
      focus: alpha(accent.light, 0.24),
      disabled: text.disabled,
      disabledBackground: alpha(text.primary, 0.06),
    },
  },
  typography: typeVariants(),
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        html: { colorScheme: 'dark' },
        body: {
          backgroundColor: surfaces.canvas,
          color: text.primary,
          WebkitFontSmoothing: 'antialiased',
          MozOsxFontSmoothing: 'grayscale',
          textRendering: 'optimizeLegibility',
        },
        'code, pre, kbd': { fontFamily: fontFamilies.mono },
        '::selection': { backgroundColor: alpha(accent.main, 0.45), color: '#fff' },
        // Plain anchors (no component styling of their own) read as links, not browser-default blue.
        'a:where(:not([class]))': {
          color: accent.light,
          textDecorationColor: alpha(accent.light, 0.4),
          textUnderlineOffset: 3,
          '&:hover': { textDecorationColor: accent.light },
        },
        '*': { scrollbarWidth: 'thin', scrollbarColor: `${borders.strong} transparent` },
        '*::-webkit-scrollbar': { width: 10, height: 10 },
        '*::-webkit-scrollbar-track': { background: 'transparent' },
        '*::-webkit-scrollbar-thumb': {
          backgroundColor: borders.default,
          borderRadius: 8,
          border: '2px solid transparent',
          backgroundClip: 'content-box',
        },
        '*::-webkit-scrollbar-thumb:hover': { backgroundColor: borders.strong },
        '@media (prefers-reduced-motion: reduce)': {
          '*, *::before, *::after': { animationDuration: '0.01ms !important', transitionDuration: '0.01ms !important' },
        },
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
        root: {
          borderRadius: radii.sm,
          minHeight: 32,
          paddingInline: 12,
          fontWeight: 500,
          transition: 'background-color 120ms ease, border-color 120ms ease, color 120ms ease',
          variants: [
            {
              props: { variant: 'contained', color: 'primary' },
              style: {
                boxShadow: 'inset 0 1px 0 rgba(255, 255, 255, 0.14)',
                '&:hover': { backgroundColor: accent.dark, boxShadow: 'inset 0 1px 0 rgba(255, 255, 255, 0.14)' },
              },
            },
            {
              // The secondary button: a quiet neutral, so the one filled button on a page stands out.
              props: { variant: 'outlined', color: 'primary' },
              style: {
                color: text.primary,
                backgroundColor: surfaces.raised,
                borderColor: borders.default,
                '&:hover': { backgroundColor: surfaces.selected, borderColor: borders.strong },
              },
            },
            {
              props: { variant: 'text', color: 'primary' },
              style: { color: accent.light, '&:hover': { backgroundColor: accent.tint } },
            },
            {
              props: { variant: 'outlined', color: 'error' },
              style: { borderColor: status.error.border, '&:hover': { backgroundColor: status.error.bg, borderColor: status.error.fg } },
            },
          ],
          '&.Mui-disabled': { color: text.disabled },
          '&.MuiButton-contained.Mui-disabled': { backgroundColor: alpha(text.primary, 0.06), boxShadow: 'none' },
          '&.MuiButton-outlined.Mui-disabled': { borderColor: borders.subtle, backgroundColor: 'transparent' },
        },
        sizeSmall: { minHeight: 28, paddingInline: 10 },
        sizeLarge: { minHeight: 40, paddingInline: 16, fontSize: '0.875rem' },
        startIcon: { marginRight: 6, '& > *:nth-of-type(1)': { fontSize: 18 } },
        endIcon: { marginLeft: 6, '& > *:nth-of-type(1)': { fontSize: 18 } },
      },
    },
    MuiIconButton: {
      styleOverrides: {
        root: { borderRadius: radii.sm, '&:hover': { backgroundColor: alpha(text.primary, 0.07) } },
        colorPrimary: { color: accent.light },
      },
    },
    MuiButtonBase: {
      styleOverrides: {
        root: { '&.Mui-focusVisible': focusRing },
      },
    },
    MuiLink: {
      defaultProps: { underline: 'hover' },
      styleOverrides: { root: { color: accent.light, textUnderlineOffset: 3 } },
    },
    MuiTextField: { defaultProps: { size: 'small' } },
    MuiFormControl: { defaultProps: { size: 'small' } },
    MuiSelect: { defaultProps: { size: 'small' } },
    MuiOutlinedInput: {
      styleOverrides: {
        root: {
          backgroundColor: alpha(text.primary, 0.035),
          transition: 'box-shadow 120ms ease, background-color 120ms ease',
          '& .MuiOutlinedInput-notchedOutline': { borderColor: borders.default, transition: 'border-color 120ms ease' },
          '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: borders.strong },
          '&.Mui-focused': { boxShadow: `0 0 0 3px ${accent.ring}` },
          '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: accent.light, borderWidth: 1 },
          '&.Mui-error.Mui-focused': { boxShadow: `0 0 0 3px ${status.error.bg}` },
          '&.Mui-disabled': { backgroundColor: 'transparent' },
          '&.Mui-disabled .MuiOutlinedInput-notchedOutline': { borderColor: borders.subtle },
        },
        input: { '&::placeholder': { color: text.disabled, opacity: 1 } },
      },
    },
    MuiInputLabel: {
      styleOverrides: {
        root: { color: text.secondary, '&.Mui-focused': { color: accent.light } },
      },
    },
    MuiFormHelperText: {
      styleOverrides: { root: { marginInline: 2, marginTop: 6, color: text.secondary } },
    },
    MuiFormLabel: {
      styleOverrides: { root: { '&.Mui-focused': { color: accent.light } } },
    },
    MuiCheckbox: {
      styleOverrides: { root: { color: borders.strong, '&.Mui-checked, &.MuiCheckbox-indeterminate': { color: accent.main } } },
    },
    MuiRadio: {
      styleOverrides: { root: { color: borders.strong } },
    },
    MuiSwitch: {
      styleOverrides: {
        switchBase: {
          color: text.secondary,
          '&.Mui-checked': { color: '#fff' },
          '&.Mui-checked + .MuiSwitch-track': { backgroundColor: accent.main, opacity: 1 },
        },
        track: { backgroundColor: borders.strong, opacity: 1 },
      },
    },
    MuiSlider: {
      styleOverrides: {
        rail: { backgroundColor: borders.strong, opacity: 1 },
        thumb: { backgroundColor: '#fff', '&:hover, &.Mui-focusVisible': { boxShadow: `0 0 0 6px ${accent.ring}` } },
        markLabel: { color: text.secondary, fontSize: '0.75rem' },
        valueLabel: { backgroundColor: surfaces.selected, border: `1px solid ${borders.strong}`, color: text.primary },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: {
          borderRadius: radii.sm,
          fontWeight: 500,
          variants: [
            // Coloured chips are tinted, not solid: the same look as StatusChip.
            ...CHIP_TONES.flatMap(([tone, color]) => [
              {
                props: { variant: 'filled' as const, color },
                style: {
                  color: status[tone].fg,
                  backgroundColor: status[tone].bg,
                  border: `1px solid ${status[tone].border}`,
                  '& .MuiChip-deleteIcon': { color: status[tone].fg, opacity: 0.7, '&:hover': { color: status[tone].fg, opacity: 1 } },
                  '&.MuiChip-clickable:hover': { backgroundColor: status[tone].border },
                },
              },
              {
                props: { variant: 'outlined' as const, color },
                style: { color: status[tone].fg, borderColor: status[tone].border },
              },
            ]),
            {
              props: { variant: 'filled', color: 'default' },
              style: { backgroundColor: alpha(text.primary, 0.07), color: text.primary },
            },
            {
              props: { variant: 'outlined', color: 'default' },
              style: { borderColor: borders.default, color: text.secondary },
            },
          ],
        },
        sizeSmall: { height: 22, fontSize: '0.75rem' },
      },
    },
    MuiTabs: {
      styleOverrides: {
        root: { minHeight: 40, borderBottom: `1px solid ${borders.subtle}` },
        indicator: { height: 2, backgroundColor: accent.light, borderRadius: '2px 2px 0 0' },
      },
    },
    MuiTab: {
      styleOverrides: {
        root: {
          minHeight: 40,
          paddingInline: 12,
          minWidth: 0,
          fontWeight: 500,
          textTransform: 'none',
          color: text.secondary,
          transition: 'color 120ms ease',
          '&:hover': { color: text.primary },
          '&.Mui-selected': { color: text.primary },
        },
      },
    },
    MuiTableContainer: {
      styleOverrides: { root: { borderRadius: radii.md } },
    },
    MuiTableCell: {
      styleOverrides: {
        root: { borderColor: borders.subtle },
        head: {
          color: text.secondary,
          fontWeight: 500,
          fontSize: '0.75rem',
          lineHeight: '16px',
          backgroundColor: surfaces.chrome,
          borderBottomColor: borders.default,
        },
        sizeSmall: { paddingBlock: 6 },
      },
    },
    MuiTableRow: {
      styleOverrides: {
        root: {
          '&.MuiTableRow-hover:hover': { backgroundColor: alpha(text.primary, 0.035) },
          '&.Mui-selected, &.Mui-selected:hover': { backgroundColor: accent.tint },
          '&:last-child > td': { borderBottom: 0 },
        },
      },
    },
    MuiTablePagination: {
      styleOverrides: { root: { color: text.secondary }, selectLabel: { fontSize: '0.75rem' }, displayedRows: { fontSize: '0.75rem' } },
    },
    MuiDataGrid: {
      styleOverrides: {
        root: {
          borderColor: borders.default,
          borderRadius: radii.md,
          backgroundColor: surfaces.paper,
          '--DataGrid-containerBackground': surfaces.chrome,
          '--DataGrid-rowBorderColor': borders.subtle,
          '& .MuiDataGrid-columnHeaderTitle': { fontWeight: 500, fontSize: '0.75rem', color: text.secondary },
          '& .MuiDataGrid-row:hover': { backgroundColor: alpha(text.primary, 0.035) },
          '& .MuiDataGrid-footerContainer': { borderColor: borders.subtle },
          '& .MuiDataGrid-overlay': { backgroundColor: 'transparent', color: text.secondary },
        },
      },
    },
    MuiDivider: {
      styleOverrides: { root: { borderColor: borders.subtle } },
    },
    MuiBackdrop: {
      styleOverrides: {
        root: { '&:not(.MuiBackdrop-invisible)': { backgroundColor: 'rgba(4, 5, 6, 0.72)', backdropFilter: 'blur(2px)' } },
      },
    },
    MuiDialog: {
      styleOverrides: {
        paper: { borderRadius: radii.lg, border: `1px solid ${borders.default}`, backgroundColor: surfaces.paper, boxShadow: shadows.dialog },
      },
    },
    MuiDialogTitle: {
      styleOverrides: { root: { fontSize: '1.125rem', lineHeight: '26px', fontWeight: 600, padding: '18px 24px 10px' } },
    },
    MuiDialogContent: {
      styleOverrides: { root: { padding: '10px 24px 18px' }, dividers: { borderColor: borders.subtle } },
    },
    MuiDialogActions: {
      styleOverrides: { root: { padding: '12px 24px', borderTop: `1px solid ${borders.subtle}`, backgroundColor: surfaces.chrome } },
    },
    MuiDrawer: {
      styleOverrides: { paper: { backgroundImage: 'none' } },
    },
    MuiPopover: {
      styleOverrides: { paper: floating },
    },
    MuiMenu: {
      styleOverrides: { paper: floating, list: { padding: 4 } },
    },
    MuiMenuItem: {
      styleOverrides: {
        root: {
          borderRadius: 4,
          minHeight: 32,
          fontSize: '0.8125rem',
          '&:hover': { backgroundColor: alpha(text.primary, 0.07) },
          '&.Mui-selected, &.Mui-selected:hover, &.Mui-selected.Mui-focusVisible': { backgroundColor: accent.tint },
        },
      },
    },
    MuiAutocomplete: {
      styleOverrides: {
        paper: floating,
        listbox: { padding: 4, '& .MuiAutocomplete-option': { borderRadius: 4, minHeight: 32, fontSize: '0.8125rem' } },
      },
    },
    MuiListItemButton: {
      styleOverrides: {
        root: {
          '&.Mui-selected, &.Mui-selected:hover': { backgroundColor: alpha(text.primary, 0.08) },
        },
      },
    },
    MuiListItemIcon: {
      styleOverrides: { root: { color: text.secondary, minWidth: 36 } },
    },
    MuiTooltip: {
      defaultProps: { enterDelay: 300 },
      styleOverrides: {
        tooltip: {
          backgroundColor: surfaces.selected,
          color: text.primary,
          fontSize: '0.75rem',
          fontWeight: 400,
          border: `1px solid ${borders.strong}`,
          boxShadow: shadows.menu,
        },
        arrow: { color: surfaces.selected, '&::before': { border: `1px solid ${borders.strong}` } },
      },
    },
    MuiAlert: {
      styleOverrides: {
        root: {
          borderRadius: radii.md,
          padding: '4px 14px',
          fontSize: '0.8125rem',
          alignItems: 'center',
          variants: SEVERITIES.flatMap((severity) => [
            {
              props: { variant: 'standard' as const, severity },
              style: {
                color: text.primary,
                backgroundColor: status[severity].bg,
                border: `1px solid ${status[severity].border}`,
                '& .MuiAlert-icon': { color: status[severity].fg },
              },
            },
            {
              props: { variant: 'outlined' as const, severity },
              style: { color: text.primary, borderColor: status[severity].border, '& .MuiAlert-icon': { color: status[severity].fg } },
            },
          ]),
        },
        icon: { fontSize: 18, marginRight: 10, padding: '6px 0' },
        message: { padding: '6px 0' },
        action: { paddingTop: 0, alignItems: 'center' },
      },
    },
    MuiAccordion: {
      defaultProps: { disableGutters: true },
      styleOverrides: {
        root: {
          backgroundColor: surfaces.paper,
          border: `1px solid ${borders.default}`,
          borderRadius: radii.md,
          '&::before': { display: 'none' },
          '& + &': { marginTop: 8 },
          '&:first-of-type, &:last-of-type': { borderRadius: radii.md },
        },
      },
    },
    MuiAccordionSummary: {
      styleOverrides: { root: { minHeight: 44, paddingInline: 16 }, content: { marginBlock: 10 } },
    },
    MuiToggleButton: {
      styleOverrides: {
        root: {
          textTransform: 'none',
          color: text.secondary,
          borderColor: borders.default,
          paddingBlock: 4,
          '&.Mui-selected, &.Mui-selected:hover': { color: text.primary, backgroundColor: surfaces.selected },
        },
      },
    },
    MuiStepIcon: {
      styleOverrides: {
        root: { color: surfaces.selected, '&.Mui-active': { color: accent.main }, '&.Mui-completed': { color: status.success.fg } },
        text: { fill: text.primary, fontWeight: 600 },
      },
    },
    MuiStepLabel: {
      styleOverrides: { label: { fontSize: '0.8125rem', '&.Mui-active, &.Mui-completed': { fontWeight: 500 } } },
    },
    MuiStepConnector: {
      styleOverrides: { line: { borderColor: borders.default } },
    },
    MuiSkeleton: {
      defaultProps: { animation: 'wave' },
      styleOverrides: { root: { backgroundColor: alpha(text.primary, 0.06) } },
    },
    MuiLinearProgress: {
      styleOverrides: { root: { borderRadius: 2, backgroundColor: alpha(text.primary, 0.08) }, bar: { borderRadius: 2 } },
    },
    MuiCircularProgress: {
      styleOverrides: { colorPrimary: { color: accent.light } },
    },
    MuiBreadcrumbs: {
      styleOverrides: { root: { fontSize: '0.8125rem' }, separator: { color: text.disabled } },
    },
    MuiAvatar: {
      styleOverrides: { colorDefault: { backgroundColor: surfaces.selected, color: text.primary } },
    },
    MuiSnackbarContent: {
      styleOverrides: { root: { ...floating, color: text.primary } },
    },
  },
});

export default theme;
