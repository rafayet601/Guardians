import 'react-native-url-polyfill/auto';

import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { AppState, Platform } from 'react-native';

import { env } from './env';

/**
 * Supabase client for React Native.
 *
 * - AsyncStorage persists the session across app launches.
 * - autoRefreshToken keeps the access token fresh while the app is foregrounded.
 * - detectSessionInUrl is disabled (that's a web-only OAuth-redirect concern).
 *
 * NOTE: For stricter at-rest security you can swap AsyncStorage for an
 * encrypted SecureStore-backed adapter — see README "Production checklist".
 */
export const supabase = createClient(env.supabaseUrl, env.supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

// Pause/resume token auto-refresh with app foreground state (skip on web).
if (Platform.OS !== 'web') {
  AppState.addEventListener('change', (state) => {
    if (state === 'active') {
      supabase.auth.startAutoRefresh();
    } else {
      supabase.auth.stopAutoRefresh();
    }
  });
}
