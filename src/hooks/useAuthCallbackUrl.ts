import * as Linking from 'expo-linking';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Platform } from 'react-native';

/** Unlike useURL's initial null, ready distinguishes pending lookup from a missing link. */
export function useAuthCallbackUrl(): { url: string | null; ready: boolean } {
  const routeParams = useLocalSearchParams<Record<string, string | string[]>>();
  const routeUrl = nativeRouteCallbackUrl(routeParams);
  const [result, setResult] = useState<{ url: string | null; ready: boolean }>({
    url: null,
    ready: false,
  });

  useEffect(() => {
    let active = true;
    let receivedEvent = false;
    const subscription = Linking.addEventListener('url', ({ url }) => {
      receivedEvent = true;
      if (active) setResult({ url, ready: true });
    });
    const initial =
      Platform.OS === 'web' && typeof window !== 'undefined'
        ? Promise.resolve(window.location.href)
        : Promise.resolve().then(() => Linking.getLinkingURL() ?? Linking.getInitialURL());
    void initial
      .then((url) => {
        if (active && !receivedEvent) setResult({ url, ready: true });
      })
      .catch(() => {
        if (active && !receivedEvent) setResult({ url: null, ready: true });
      });
    return () => {
      active = false;
      subscription.remove();
    };
  }, []);

  // A warm deep link can mount this screen after its URL event has already fired.
  // Current router credentials are authoritative over the older launch URL.
  return Platform.OS !== 'web' && routeUrl ? { url: routeUrl, ready: true } : result;
}

const AUTH_PARAMS = [
  'access_token',
  'refresh_token',
  'code',
  'token_hash',
  'token',
  'type',
  'expires_in',
  'expires_at',
  'token_type',
  'provider_token',
  'provider_refresh_token',
  'error',
  'error_code',
  'error_description',
];

/** Keep duplicate route values intact so the strict auth parser can reject them. */
function nativeRouteCallbackUrl(params: Record<string, string | string[]>): string | null {
  const pairs: string[] = [];
  for (const key of AUTH_PARAMS) {
    const value = params[key];
    if (value === undefined) continue;
    const values = Array.isArray(value) ? value : [value];
    for (const entry of values.length ? values : ['']) {
      pairs.push(`${encodeURIComponent(key)}=${encodeURIComponent(entry)}`);
    }
  }
  if (!pairs.length) return null;
  // Expo Router exposes URL fragments as '#'. Retain them so mixed credentials
  // remain invalid instead of becoming a valid single-shape query during reconstruction.
  const fragment = params['#'];
  if (Array.isArray(fragment)) pairs.push('error=ambiguous_fragment');
  return `guardians://auth-callback?${pairs.join('&')}${typeof fragment === 'string' ? `#${fragment}` : ''}`;
}

/** Remove credentials from browser history after processing, without exposing them in logs. */
export function scrubAuthCallbackUrl(processedUrl?: string | null): void {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return;
  // A late completion must not scrub a newer callback that has not yet been processed.
  if (processedUrl && window.location.href !== processedUrl) return;
  try {
    const url = new URL(window.location.href);
    const fragment = new URLSearchParams(url.hash.slice(1));
    for (const key of AUTH_PARAMS) {
      url.searchParams.delete(key);
      fragment.delete(key);
    }
    url.hash = fragment.toString();
    window.history.replaceState(
      window.history.state,
      '',
      `${url.pathname}${url.search}${url.hash}`,
    );
  } catch {
    // An unavailable browser history API must not invalidate an established session.
  }
}
