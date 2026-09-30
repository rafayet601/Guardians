import { getOAuthProviders, getOAuthSignInUrl } from '@/api/auth';
import { supabase } from '@/lib/supabase';

jest.mock('@/lib/env', () => ({
  env: {
    isConfigured: true,
    supabaseUrl: 'https://test.supabase.co',
    supabaseAnonKey: 'public-key',
  },
}));
jest.mock('@/lib/supabase', () => ({ supabase: { auth: { signInWithOAuth: jest.fn() } } }));
const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

test('only exposes providers explicitly enabled by the linked backend', async () => {
  globalThis.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ external: { google: true, apple: false, github: true } }),
  });
  await expect(getOAuthProviders()).resolves.toEqual(['google']);
  expect(fetch).toHaveBeenCalledWith(
    'https://test.supabase.co/auth/v1/settings',
    expect.objectContaining({ headers: { apikey: 'public-key' } }),
  );
});

test('failed provider settings remain an error rather than pretending providers are disabled', async () => {
  globalThis.fetch = jest.fn().mockResolvedValue({ ok: false });
  await expect(getOAuthProviders()).rejects.toThrow('temporarily unavailable');
});

test('requests an explicit callback and controls browser navigation', async () => {
  jest.mocked(supabase.auth.signInWithOAuth).mockResolvedValue({
    data: { provider: 'google', url: 'https://example/authorize' },
    error: null,
  });
  await expect(getOAuthSignInUrl('google', 'guardians://oauth-callback')).resolves.toBe(
    'https://example/authorize',
  );
  expect(supabase.auth.signInWithOAuth).toHaveBeenCalledWith({
    provider: 'google',
    options: { redirectTo: 'guardians://oauth-callback', skipBrowserRedirect: true },
  });
});
