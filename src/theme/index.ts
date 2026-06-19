import { Platform, TextStyle, ViewStyle } from 'react-native';

/**
 * Guardians design system.
 * A warm, trustworthy palette: deep rescue-green primary + amber accent.
 */

export const palette = {
  // brand
  green900: '#0A5C4C',
  green700: '#0E7C66',
  green500: '#16A085',
  green300: '#7BD3C0',
  green100: '#D7F0E9',
  green50: '#EAF7F3',

  // accent (cats / warmth)
  amber600: '#E8821E',
  amber500: '#F39C12',
  amber100: '#FDEBD0',

  // status hues
  blue500: '#2D7DD2',
  blue100: '#DCEBFB',
  violet500: '#7C5CDA',
  violet100: '#E6DEFA',
  red500: '#E04F5F',
  red100: '#FBE0E3',
  pink500: '#E5547F',
  pink100: '#FBE2EB',
  slate500: '#7C8794',
  slate100: '#E9ECEF',

  // neutrals
  ink: '#16211E',
  charcoal: '#33403B',
  gray600: '#5C6B65',
  gray400: '#8E9A94',
  gray300: '#BFC8C3',
  gray200: '#DDE3E0',
  gray100: '#EEF1EF',
  bg: '#F6F8F7',
  surface: '#FFFFFF',
  white: '#FFFFFF',
  black: '#000000',
} as const;

export const colors = {
  primary: palette.green700,
  primaryDark: palette.green900,
  primaryLight: palette.green500,
  primarySoft: palette.green100,
  primaryTint: palette.green50,

  accent: palette.amber500,
  accentDark: palette.amber600,
  accentSoft: palette.amber100,

  background: palette.bg,
  surface: palette.surface,
  card: palette.surface,
  border: palette.gray200,
  divider: palette.gray100,

  text: palette.ink,
  textSecondary: palette.gray600,
  textMuted: palette.gray400,
  textInverse: palette.white,

  success: palette.green500,
  warning: palette.amber500,
  danger: palette.red500,
  info: palette.blue500,

  overlay: 'rgba(16, 33, 30, 0.45)',
  white: palette.white,
  black: palette.black,
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 28,
  xxxl: 40,
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 22,
  pill: 999,
} as const;

export const typography = {
  display: { fontSize: 32, fontWeight: '800', letterSpacing: -0.5 } as TextStyle,
  title: { fontSize: 24, fontWeight: '800', letterSpacing: -0.3 } as TextStyle,
  heading: { fontSize: 19, fontWeight: '700' } as TextStyle,
  subheading: { fontSize: 16, fontWeight: '700' } as TextStyle,
  body: { fontSize: 15, fontWeight: '400' } as TextStyle,
  bodyStrong: { fontSize: 15, fontWeight: '600' } as TextStyle,
  small: { fontSize: 13, fontWeight: '400' } as TextStyle,
  smallStrong: { fontSize: 13, fontWeight: '600' } as TextStyle,
  caption: { fontSize: 11, fontWeight: '600', letterSpacing: 0.4 } as TextStyle,
} as const;

export const shadow = {
  card: Platform.select<ViewStyle>({
    ios: {
      shadowColor: '#0A2A22',
      shadowOpacity: 0.08,
      shadowRadius: 12,
      shadowOffset: { width: 0, height: 4 },
    },
    android: { elevation: 3 },
    default: {},
  })!,
  floating: Platform.select<ViewStyle>({
    ios: {
      shadowColor: '#0A2A22',
      shadowOpacity: 0.18,
      shadowRadius: 18,
      shadowOffset: { width: 0, height: 8 },
    },
    android: { elevation: 8 },
    default: {},
  })!,
} as const;

/**
 * Motion language. One orchestrated entrance per screen, restrained press
 * feedback, no gratuitous looping. Keep these values consistent app-wide:
 *   entering={FadeInDown.delay(i * motion.stagger).duration(motion.enter).springify().damping(motion.damping)}
 */
export const motion = {
  enter: 300, // entrance duration (ms) — snappy, settles fast
  stagger: 40, // delay step between sequential reveals (ms) — tighter cascade
  damping: 19, // spring damping for entrances — less wobble = more seamless
  pressScale: 0.97, // how far interactive surfaces shrink on press
  cardPressScale: 0.985, // gentler for large cards
} as const;

export const theme = { colors, spacing, radius, typography, shadow, palette, motion };
export type Theme = typeof theme;
