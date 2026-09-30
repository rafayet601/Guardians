import { sessionFromUrl, type AuthLinkPurpose } from '@/lib/authLink';
import { supabase } from '@/lib/supabase';

jest.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      exchangeCodeForSession: jest.fn(),
      setSession: jest.fn(),
      verifyOtp: jest.fn(),
      getSession: jest.fn(),
    },
  },
}));

const exchange = supabase.auth.exchangeCodeForSession as jest.Mock;
const setSession = supabase.auth.setSession as jest.Mock;
const verify = supabase.auth.verifyOtp as jest.Mock;
const getSession = supabase.auth.getSession as jest.Mock;
const success = { data: { session: { user: { id: 'user-a' } } }, error: null };
let now = 0;

beforeEach(() => {
  jest.resetAllMocks();
  now += 10 * 60_000;
  jest.spyOn(Date, 'now').mockImplementation(() => now);
  exchange.mockResolvedValue(success);
  getSession.mockResolvedValue(success);
  setSession.mockResolvedValue(success);
  verify.mockResolvedValue(success);
});
afterEach(() => jest.restoreAllMocks());

test('decodes query values without dropping equals signs or encoded plus signs', async () => {
  expect(await sessionFromUrl('guardians://callback?code=a%2Bb%3D%3D', 'oauth')).toBe(true);
  expect(exchange).toHaveBeenCalledWith('a+b==');
});

test('preserves typed implicit email links and fragment padding', async () => {
  expect(
    await sessionFromUrl(
      'guardians://reset#access_token=access==&refresh_token=refresh%2B%3D&type=recovery',
      'recovery',
    ),
  ).toBe(true);
  expect(setSession).toHaveBeenCalledWith({ access_token: 'access==', refresh_token: 'refresh+=' });
});

test.each(['signup', 'invite', 'magiclink', 'email_change', 'email'])(
  'supports %s confirmation token hashes',
  async (type) => {
    expect(
      await sessionFromUrl(`guardians://confirm?token_hash=hash&type=${type}`, 'confirmation'),
    ).toBe(true);
    expect(verify).toHaveBeenCalledWith({ token_hash: 'hash', type });
  },
);

test.each([
  ['?token_hash=hash&type=recovery', 'confirmation'],
  ['?token_hash=hash&type=email', 'recovery'],
  ['?token_hash=hash&type=signup', 'oauth'],
  ['#access_token=a&refresh_token=r&type=signup', 'recovery'],
  ['#access_token=a&refresh_token=r&type=recovery', 'confirmation'],
  ['#access_token=a&refresh_token=r', 'recovery'],
  ['#access_token=a&refresh_token=r&type=signup', 'oauth'],
  ['?code=code&type=recovery', 'oauth'],
] as [string, AuthLinkPurpose][])(
  'rejects wrong or missing purposes: %s / %s',
  async (params, purpose) => {
    expect(await sessionFromUrl(`guardians://callback${params}`, purpose)).toBe(false);
    expect(exchange).not.toHaveBeenCalled();
    expect(verify).not.toHaveBeenCalled();
    expect(setSession).not.toHaveBeenCalled();
  },
);

test.each([
  '?token_hash=hash&type=admin',
  '?token_hash=hash',
  '?code=one&code=two',
  '?code=one#code=two',
  '?code=one&token_hash=hash&type=email',
  '?code=one#access_token=a&refresh_token=b',
  '#access_token=one',
  '?error=access_denied&code=one',
  '?code=one#error_description=Provider+refused',
  '?code=one&error_code=',
])('rejects malformed, ambiguous, or provider-error callbacks: %s', async (params) => {
  expect(await sessionFromUrl(`guardians://callback${params}`)).toBe(false);
  expect(exchange).not.toHaveBeenCalled();
  expect(verify).not.toHaveBeenCalled();
  expect(setSession).not.toHaveBeenCalled();
});

test('deduplicates concurrent and repeated successful PKCE callbacks', async () => {
  let finish!: (value: typeof success) => void;
  exchange.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const first = sessionFromUrl('guardians://callback?code=single-use', 'oauth');
  const second = sessionFromUrl('guardians://callback?code=single-use', 'oauth');
  await Promise.resolve();
  expect(exchange).toHaveBeenCalledTimes(1);
  finish(success);
  expect(await Promise.all([first, second])).toEqual([true, true]);
  expect(await sessionFromUrl('guardians://callback?code=single-use', 'oauth')).toBe(true);
  expect(exchange).toHaveBeenCalledTimes(1);
});

test('does not treat a consumed code as a successful sign-in after logout or account switch', async () => {
  const url = 'guardians://callback?code=logout';
  expect(await sessionFromUrl(url, 'oauth')).toBe(true);
  getSession.mockResolvedValueOnce({ data: { session: null }, error: null });
  expect(await sessionFromUrl(url, 'oauth')).toBe(false);
  getSession.mockResolvedValueOnce({ data: { session: { user: { id: 'user-b' } } }, error: null });
  expect(await sessionFromUrl(url, 'oauth')).toBe(false);
  expect(exchange).toHaveBeenCalledTimes(1);
});

test('failed exchanges are retryable and thrown errors are never logged', async () => {
  const log = jest.spyOn(console, 'error');
  exchange.mockRejectedValueOnce(new Error('sensitive callback details'));
  const url = 'guardians://callback?code=retry';
  expect(await sessionFromUrl(url, 'oauth')).toBe(false);
  expect(await sessionFromUrl(url, 'oauth')).toBe(true);
  expect(exchange).toHaveBeenCalledTimes(2);
  expect(log).not.toHaveBeenCalled();
});

test('returned auth errors are retryable', async () => {
  exchange.mockResolvedValueOnce({ data: { session: null }, error: { message: 'network' } });
  const url = 'guardians://callback?code=retry-error';
  expect(await sessionFromUrl(url)).toBe(false);
  expect(await sessionFromUrl(url)).toBe(true);
});

test('successful deduplication expires and has a bounded entry count', async () => {
  for (let i = 0; i < 33; i++) await sessionFromUrl(`guardians://callback?code=bounded-${i}`);
  await sessionFromUrl('guardians://callback?code=bounded-0');
  expect(exchange).toHaveBeenCalledTimes(34);
  now += 5 * 60_000;
  await sessionFromUrl('guardians://callback?code=bounded-0');
  expect(exchange).toHaveBeenCalledTimes(35);
});

test('rejects oversized callback input', async () => {
  expect(await sessionFromUrl(`guardians://callback?code=${'x'.repeat(16_384)}`)).toBe(false);
  expect(exchange).not.toHaveBeenCalled();
});
