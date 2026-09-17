import { env } from '@/lib/env';
import { supabase } from '@/lib/supabase';

export type OAuthProvider = 'google' | 'apple';

/** Public provider availability, never provider secrets or management credentials. */
export async function getOAuthProviders(): Promise<OAuthProvider[]> {
  if (!env.isConfigured) return [];
  const response = await fetch(`${env.supabaseUrl}/auth/v1/settings`, {
    headers: { apikey: env.supabaseAnonKey },
  });
  if (!response.ok) throw new Error('Sign-in options are temporarily unavailable.');
  const settings = await response.json();
  return (['google', 'apple'] as const).filter(
    (provider) => settings.external?.[provider] === true,
  );
}

export async function getOAuthSignInUrl(provider: OAuthProvider, redirectTo: string) {
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: { redirectTo, skipBrowserRedirect: true },
  });
  if (error) throw error;
  if (!data.url) throw new Error('Could not start sign-in. Please try again.');
  return data.url;
}
