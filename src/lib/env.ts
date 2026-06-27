/**
 * Typed access to the EXPO_PUBLIC_* environment variables.
 *
 * We intentionally do NOT throw when values are missing so the app can boot
 * and render a friendly "finish your setup" screen instead of a white crash.
 * `isConfigured` tells the rest of the app whether Supabase is usable.
 */
const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

const looksConfigured =
  supabaseUrl.startsWith('http') &&
  !supabaseUrl.includes('YOUR-PROJECT') &&
  supabaseAnonKey.length > 20 &&
  !supabaseAnonKey.includes('YOUR-');

if (!looksConfigured && __DEV__) {
   
  console.warn(
    '[Guardians] Supabase env not configured. Copy .env.example to .env and fill in your keys.',
  );
}

// Treat an env value as real only if set AND not the .env.example placeholder.
// (e.g. an unset Maps key must stay empty so PlatformMap falls back to Apple Maps,
// which works in Expo Go — a placeholder would wrongly select PROVIDER_GOOGLE and
// render a blank map.)
const realEnv = (value?: string): string => (value && !value.includes('YOUR-') ? value : '');

export const env = {
  supabaseUrl: looksConfigured ? supabaseUrl : 'https://placeholder.supabase.co',
  supabaseAnonKey: looksConfigured ? supabaseAnonKey : 'placeholder-anon-key',
  googleMapsAndroidKey: realEnv(process.env.EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_KEY),
  googleMapsIosKey: realEnv(process.env.EXPO_PUBLIC_GOOGLE_MAPS_IOS_KEY),
  // Optional: set to enable real error reporting via the observability façade.
  sentryDsn: realEnv(process.env.EXPO_PUBLIC_SENTRY_DSN),
  isConfigured: looksConfigured,
};
