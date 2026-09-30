import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { Platform } from 'react-native';

import { getOAuthSignInUrl, type OAuthProvider } from '@/api/auth';
import { sessionFromUrl } from '@/lib/authLink';

let signingIn = false;

export function isExpectedOAuthRedirect(actual: string, expected: string): boolean {
  try {
    const a = new URL(actual);
    const e = new URL(expected);
    return a.protocol === e.protocol && a.host === e.host && a.pathname === e.pathname;
  } catch {
    return false;
  }
}

/** Web uses a same-tab redirect; native uses the OS authentication browser. */
export async function signInWithOAuth(
  provider: OAuthProvider,
): Promise<'success' | 'cancelled' | 'redirecting'> {
  if (signingIn) throw new Error('A sign-in is already in progress.');
  signingIn = true;
  try {
    const redirectTo = Linking.createURL('/oauth-callback');
    if (/^exps?:/i.test(redirectTo)) {
      throw new Error('Social sign-in needs the installed Guardians app. Use email in Expo Go.');
    }
    const url = await getOAuthSignInUrl(provider, redirectTo);
    if (Platform.OS === 'web') {
      window.location.assign(url);
      return 'redirecting';
    }
    const result = await WebBrowser.openAuthSessionAsync(url, redirectTo);
    if (result.type === 'cancel' || result.type === 'dismiss') return 'cancelled';
    if (result.type !== 'success' || !isExpectedOAuthRedirect(result.url, redirectTo)) {
      throw new Error('Sign-in did not return to Guardians. Please try again.');
    }
    if (!(await sessionFromUrl(result.url, 'oauth'))) {
      throw new Error('Sign-in could not be completed. Please start again.');
    }
    return 'success';
  } finally {
    signingIn = false;
  }
}
