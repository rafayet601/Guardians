import 'react-native-url-polyfill/auto';

import { createClient } from '@supabase/supabase-js';
import { AppState, Platform } from 'react-native';

import { env } from './env';
import { secureStorage } from './secureStorage';

/**
 * Supabase client for React Native.
 *
 * - The session persists across launches via `secureStorage`: an encrypted
 *   SecureStore (keychain/keystore) adapter on native, AsyncStorage on web.
 * - autoRefreshToken keeps the access token fresh while the app is foregrounded.
 * - detectSessionInUrl is disabled (that's a web-only OAuth-redirect concern).
 */
export const supabase = createClient(env.supabaseUrl, env.supabaseAnonKey, {
  auth: {
    storage: secureStorage,
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
