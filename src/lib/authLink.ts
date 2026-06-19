import type { EmailOtpType } from '@supabase/supabase-js';

import { supabase } from '@/lib/supabase';

/**
 * Parse auth params from a deep link. Supabase puts them in the query string
 * (PKCE / token-hash) or the URL fragment (implicit), so we read both.
 */
function parseAuthParams(url: string): Record<string, string> {
  const out: Record<string, string> = {};
  const grab = (segment?: string) => {
    if (!segment) return;
    for (const kv of segment.split('&')) {
      const [k, v] = kv.split('=');
      if (k) out[decodeURIComponent(k)] = decodeURIComponent(v ?? '');
    }
  };
  grab(url.split('?')[1]?.split('#')[0]); // query
  grab(url.split('#')[1]); // fragment
  return out;
}

/**
 * Establish a Supabase session from an auth deep link (password recovery or
 * email confirmation). Returns true if a session was set. Supports all three
 * email-link shapes so it's resilient to the project's auth flow config.
 */
export async function sessionFromUrl(url: string): Promise<boolean> {
  const p = parseAuthParams(url);

  if (p.access_token && p.refresh_token) {
    const { error } = await supabase.auth.setSession({
      access_token: p.access_token,
      refresh_token: p.refresh_token,
    });
    return !error;
  }
  if (p.code) {
    const { error } = await supabase.auth.exchangeCodeForSession(p.code);
    return !error;
  }
  if (p.token_hash && p.type) {
    const { error } = await supabase.auth.verifyOtp({
      token_hash: p.token_hash,
      type: p.type as EmailOtpType,
    });
    return !error;
  }
  return false;
}
