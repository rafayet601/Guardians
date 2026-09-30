import { TextStyle, ViewStyle } from 'react-native';

/**
 * Guardians design system.
 *
 * Warm & friendly cat-rescue language: a saturated rescue-green primary on a
 * soft cream canvas, warm-ink text, a honey accent, and a friendly orange for
 * urgency. Rounded everything. Typography pairs Nunito (rounded display) with
 * Plus Jakarta Sans (humanist body) and Space Mono (technical micro-labels).
 *
 * Token KEYS are stable — screens & components reference these, never raw hex.
 */

// ---------------------------------------------------------------------------
// Fonts — keys are registered in app/_layout.tsx via expo-font/useFonts.
// ---------------------------------------------------------------------------
export const fontFamily = {
  heavy: 'Nunito-Black', // 900 — hero display
  extrabold: 'Nunito-ExtraBold', // 800 — titles / headings
  bold: 'Nunito-Bold', // 700 — rounded labels & buttons
  body: 'Jakarta-Regular', // 400 — body copy
  bodyMedium: 'Jakarta-Medium', // 500
  bodySemibold: 'Jakarta-SemiBold', // 600
  bodyBold: 'Jakarta-Bold', // 700
  mono: 'SpaceMono', // 400 — distances, XP, micro-labels
  monoBold: 'SpaceMono-Bold', // 700
} as const;

export const palette = {
  // brand — rescue green
  green900: '#0B3D28',
  green700: '#15784A',
  green500: '#1FA463', // ← primary rescue green
  green300: '#6FC79B',
  green100: '#D7EEDF',
  green50: '#E8F4EC',

  // accent — honey / warmth
  amber600: '#8A5A12', // honey text on soft amber
  amber500: '#F4A93C', // honey
  amber100: '#FCEFD6',

  // status hues (warmed to sit on the cream canvas)
  blue500: '#3E7CA6',
  blue100: '#DAE9EF',
  violet500: '#7E63C8',
  violet100: '#E9E2F6',
  red500: '#DB5A36', // friendly urgent orange-red
  red100: '#FBE3DA',
  pink500: '#D8567E',
  pink100: '#F7DDE6',
  slate500: '#8C8478', // warm gray
  slate100: '#ECE6DB',

  // neutrals — warm, never cold
  ink: '#241F1A',
  charcoal: '#3A332B',
  gray600: '#5F5949',
  gray400: '#857E70',
  gray300: '#B8B0A0',
  gray200: '#E3DDD1', // hairline / border
  gray100: '#F0EBE1', // divider
  bg: '#FBF9F4', // app canvas (warm off-white)
  surface: '#FFFFFF',
  white: '#FFFFFF',
  black: '#100F0D',

  // design extras
  cream: '#ECE7DD', // grouped / sand background
  creamDeep: '#E6E0D4',
  urgent: '#E0653B', // friendly urgent orange
  urgentDeep: '#C44A24',
  urgentSoft: '#FBE3DA',
  honeyDeep: '#A77F33',
} as const;

export const colors = {
  primary: palette.green700,
  primaryDark: palette.green700,
  primaryDeep: palette.green900,
  primaryLight: palette.green300,
  primarySoft: palette.green100,
  primaryTint: palette.green50,

  accent: palette.amber500,
  accentDark: palette.amber600,
  accentSoft: palette.amber100,

  urgent: palette.urgent,
  urgentSoft: palette.urgentSoft,

  background: palette.bg,
  cream: palette.cream,
  surface: palette.surface,
  card: palette.surface,
  border: palette.gray200,
  divider: palette.gray100,

  text: palette.ink,
  textSecondary: palette.gray600,
  textMuted: palette.gray400,
  textFaint: palette.gray300,
  textInverse: palette.white,

  success: palette.green500,
  warning: palette.amber500,
  danger: palette.red500,
  info: palette.blue500,

  overlay: 'rgba(36, 31, 26, 0.45)',
  onPrimaryMuted: '#D7EEDF',
  glass: 'rgba(255,255,255,0.16)',
  glassStrong: 'rgba(255,255,255,0.28)',
  photoScrim: 'rgba(11,61,40,0.65)',
  transparent: 'transparent',
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
  section: 56,
  bottomClearance: 112,
} as const;

export const radius = {
  sm: 10,
  md: 14,
  lg: 18,
  xl: 24,
  hero: 32,
  sheet: 28,
  pill: 999,
} as const;

export const typography = {
  hero: {
    fontFamily: fontFamily.heavy,
    fontSize: 36,
    lineHeight: 40,
    letterSpacing: -1,
  } as TextStyle,
  heroWide: {
    fontFamily: fontFamily.heavy,
    fontSize: 48,
    lineHeight: 53,
    letterSpacing: -1,
  } as TextStyle,
  display: {
    fontSize: 30,
    fontFamily: fontFamily.heavy,
    fontWeight: '900',
    letterSpacing: -0.6,
    lineHeight: 35,
  } as TextStyle,
  title: {
    fontSize: 23,
    fontFamily: fontFamily.bodyBold,
    fontWeight: '700',
    letterSpacing: -0.4,
    lineHeight: 28,
  } as TextStyle,
  heading: {
    fontSize: 18,
    fontFamily: fontFamily.bodyBold,
    fontWeight: '700',
    letterSpacing: -0.2,
  } as TextStyle,
  subheading: {
    fontSize: 15,
    fontFamily: fontFamily.bodyBold,
    fontWeight: '700',
    letterSpacing: -0.1,
  } as TextStyle,
  body: {
    fontSize: 14.5,
    fontFamily: fontFamily.body,
    fontWeight: '400',
    lineHeight: 21,
  } as TextStyle,
  bodyStrong: {
    fontSize: 14.5,
    fontFamily: fontFamily.bodySemibold,
    fontWeight: '600',
    lineHeight: 21,
  } as TextStyle,
  small: {
    fontSize: 12.5,
    fontFamily: fontFamily.body,
    fontWeight: '400',
    lineHeight: 17,
  } as TextStyle,
  smallStrong: {
    fontSize: 12.5,
    fontFamily: fontFamily.bodySemibold,
    fontWeight: '600',
    lineHeight: 17,
  } as TextStyle,
  caption: {
    fontSize: 10.5,
    fontFamily: fontFamily.bodyBold,
    fontWeight: '700',
    letterSpacing: 0.4,
  } as TextStyle,
  // uppercase micro-label ("LOCATION", "COMMUNITY CAT RESCUE")
  overline: {
    fontSize: 10.5,
    fontFamily: fontFamily.bodyBold,
    fontWeight: '700',
    letterSpacing: 1.3,
    textTransform: 'uppercase',
  } as TextStyle,
  // monospace micro-data (distances, XP, counts)
  mono: {
    fontSize: 12,
    fontFamily: fontFamily.mono,
    fontWeight: '400',
    letterSpacing: 0.2,
  } as TextStyle,
} as const;

export const shadow = {
  card: { boxShadow: '0 3px 16px rgba(36,31,26,0.045)' } as ViewStyle,
  floating: { boxShadow: '0 8px 30px rgba(11,61,40,0.13)' } as ViewStyle,
  glow: { boxShadow: '0 5px 16px rgba(21,120,74,0.18)' } as ViewStyle,
} as const;

export const layout = {
  contentMax: 760,
  formMax: 480,
  welcomeMax: 1120,
  wideBreakpoint: 800,
  tabHeight: 68,
  touchTarget: 44,
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

export const theme = {
  colors,
  spacing,
  radius,
  typography,
  shadow,
  palette,
  motion,
  fontFamily,
  layout,
};
export type Theme = typeof theme;
