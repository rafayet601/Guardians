import type { EmailOtpType } from '@supabase/supabase-js';

import { supabase } from '@/lib/supabase';

export type AuthLinkPurpose = 'oauth' | 'confirmation' | 'recovery';

const EMAIL_TYPES: readonly string[] = [
  'signup',
  'invite',
  'magiclink',
  'recovery',
  'email_change',
  'email',
];
const AUTH_KEYS = ['code', 'token_hash', 'type', 'access_token', 'refresh_token'] as const;
const MAX_URL_LENGTH = 16_384;
const MAX_EXCHANGES = 32;
const EXCHANGE_TTL_MS = 5 * 60_000;
type Exchange = { promise: Promise<boolean>; pending: boolean; expiresAt: number; userId?: string };
const exchanges = new Map<string, Exchange>();

function isEmailType(value: string | undefined): value is EmailOtpType {
  return value !== undefined && EMAIL_TYPES.includes(value);
}

/** Reject ambiguous credentials instead of letting query/fragment order choose them. */
function parseAuthParams(url: string): Map<string, string> | null {
  if (!url || url.length > MAX_URL_LENGTH) return null;
  const fragmentAt = url.indexOf('#');
  const beforeFragment = fragmentAt < 0 ? url : url.slice(0, fragmentAt);
  const queryAt = beforeFragment.indexOf('?');
  const query = queryAt < 0 ? '' : beforeFragment.slice(queryAt + 1);
  const fragment = fragmentAt < 0 ? '' : url.slice(fragmentAt + 1);
  const out = new Map<string, string>();
  for (const segment of [query, fragment]) {
    const params = new URLSearchParams(segment);
    if (['error', 'error_code', 'error_description'].some((key) => params.has(key))) return null;
    for (const key of AUTH_KEYS) {
      const values = params.getAll(key);
      if (values.length > 1 || (values.length && out.has(key))) return null;
      if (values.length) out.set(key, values[0]);
    }
  }
  return out;
}

/** PKCE codes are single use; duplicate callback renders share the same exchange. */
function exchangeCode(code: string): Promise<boolean> {
  const now = Date.now();
  for (const [key, entry] of exchanges) {
    if (!entry.pending && entry.expiresAt <= now) exchanges.delete(key);
  }
  const existing = exchanges.get(code);
  if (existing) {
    if (existing.pending) return existing.promise;
    // A consumed code must not report a new sign-in after logout/account switch.
    return supabase.auth
      .getSession()
      .then(
        ({ data, error }) =>
          !error && !!existing.userId && data.session?.user.id === existing.userId,
      )
      .catch(() => false);
  }
  if (exchanges.size >= MAX_EXCHANGES) {
    const completed = [...exchanges].find(([, entry]) => !entry.pending);
    if (completed) exchanges.delete(completed[0]);
    else return Promise.resolve(false);
  }
  const entry: Exchange = {
    promise: Promise.resolve(false),
    pending: true,
    expiresAt: now + EXCHANGE_TTL_MS,
  };
  // Deferring the call also converts a synchronous SDK failure into a safe result.
  entry.promise = Promise.resolve()
    .then(() => supabase.auth.exchangeCodeForSession(code))
    .then(({ data, error }) => {
      entry.userId = data.session?.user.id;
      return !error && !!entry.userId;
    })
    .catch(() => false)
    .then((ok) => {
      entry.pending = false;
      entry.expiresAt = Date.now() + EXCHANGE_TTL_MS;
      if (!ok) exchanges.delete(code);
      return ok;
    });
  exchanges.set(code, entry);
  return entry.promise;
}

/**
 * Establish a session without logging credentials or provider errors. Typed
 * email links must match the caller's purpose. PKCE codes have no purpose
 * field: the callback route and Supabase's stored verifier bind them.
 * OAuth requires PKCE; existing email implicit/token-hash links stay supported.
 * Failed exchanges can be retried; successful codes are cached briefly.
 */
export async function sessionFromUrl(
  url: string,
  expectedPurpose?: AuthLinkPurpose,
): Promise<boolean> {
  try {
    const p = parseAuthParams(url);
    if (!p) return false;
    const type = p.get('type');
    if (type !== undefined && !isEmailType(type)) return false;
    if (expectedPurpose === 'oauth' && type !== undefined) return false;
    if (expectedPurpose === 'recovery' && type !== undefined && type !== 'recovery') return false;
    if (expectedPurpose === 'confirmation' && type === 'recovery') return false;

    const code = p.get('code');
    const tokenHash = p.get('token_hash');
    const accessToken = p.get('access_token');
    const refreshToken = p.get('refresh_token');
    const shapes =
      Number(p.has('code')) +
      Number(p.has('token_hash')) +
      Number(p.has('access_token') || p.has('refresh_token'));
    if (shapes !== 1) return false;

    if (code) return exchangeCode(code);
    if (expectedPurpose === 'oauth') return false;
    if (expectedPurpose && !isEmailType(type)) return false;
    if (accessToken && refreshToken) {
      const { error } = await supabase.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken,
      });
      return !error;
    }
    if (tokenHash && isEmailType(type)) {
      const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
      return !error;
    }
    return false;
  } catch {
    return false;
  }
}
