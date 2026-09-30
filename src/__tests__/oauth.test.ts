import { Platform } from 'react-native';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { getOAuthSignInUrl } from '@/api/auth';
import { sessionFromUrl } from '@/lib/authLink';
import { isExpectedOAuthRedirect, signInWithOAuth } from '@/lib/oauth';

jest.mock('expo-linking', () => ({ createURL: jest.fn() }));
jest.mock('expo-web-browser', () => ({ openAuthSessionAsync: jest.fn() }));
jest.mock('@/api/auth', () => ({ getOAuthSignInUrl: jest.fn() }));
jest.mock('@/lib/authLink', () => ({ sessionFromUrl: jest.fn() }));

const redirect = 'guardians://oauth-callback';
const callback = `${redirect}?code=single-use`;
beforeEach(() => {
  jest.clearAllMocks();
  Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true });
  jest.mocked(Linking.createURL).mockReturnValue(redirect);
  jest.mocked(getOAuthSignInUrl).mockResolvedValue('https://auth.example/authorize');
  jest
    .mocked(WebBrowser.openAuthSessionAsync)
    .mockResolvedValue({ type: 'success', url: callback });
  jest.mocked(sessionFromUrl).mockResolvedValue(true);
});

test('native sign-in opens the OS auth session and exchanges a PKCE callback', async () => {
  await expect(signInWithOAuth('google')).resolves.toBe('success');
  expect(getOAuthSignInUrl).toHaveBeenCalledWith('google', redirect);
  expect(WebBrowser.openAuthSessionAsync).toHaveBeenCalledWith(
    'https://auth.example/authorize',
    redirect,
  );
  expect(sessionFromUrl).toHaveBeenCalledWith(callback, 'oauth');
});

test('cancellation does not exchange credentials and can be retried', async () => {
  jest
    .mocked(WebBrowser.openAuthSessionAsync)
    .mockResolvedValueOnce({ type: 'cancel' as WebBrowser.WebBrowserResultType });
  await expect(signInWithOAuth('apple')).resolves.toBe('cancelled');
  expect(sessionFromUrl).not.toHaveBeenCalled();
  await expect(signInWithOAuth('apple')).resolves.toBe('success');
});

test('rejects an unexpected callback destination before exchanging', async () => {
  jest
    .mocked(WebBrowser.openAuthSessionAsync)
    .mockResolvedValueOnce({ type: 'success', url: 'other://oauth-callback?code=x' });
  await expect(signInWithOAuth('google')).rejects.toThrow('did not return');
  expect(sessionFromUrl).not.toHaveBeenCalled();
});

test('rejects failed exchanges instead of claiming successful authentication', async () => {
  jest.mocked(sessionFromUrl).mockResolvedValue(false);
  await expect(signInWithOAuth('google')).rejects.toThrow('could not be completed');
});

test('does not start social auth using an Expo Go redirect', async () => {
  jest.mocked(Linking.createURL).mockReturnValue('exp://localhost:8082/--/oauth-callback');
  await expect(signInWithOAuth('google')).rejects.toThrow('installed Guardians app');
  expect(getOAuthSignInUrl).not.toHaveBeenCalled();
});

test('prevents concurrent attempts from replacing the stored PKCE verifier', async () => {
  let finish!: (url: string) => void;
  jest.mocked(getOAuthSignInUrl).mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const first = signInWithOAuth('google');
  await expect(signInWithOAuth('apple')).rejects.toThrow('already in progress');
  finish('https://auth.example/authorize');
  await first;
});

test.each([
  ['guardians://oauth-callback?code=x', true],
  ['guardians://oauth-callback.evil?code=x', false],
  ['https://oauth-callback?code=x', false],
  ['guardians://oauth-callback/other?code=x', false],
])('matches only the configured destination: %s', (url, expected) => {
  expect(isExpectedOAuthRedirect(url, redirect)).toBe(expected);
});
