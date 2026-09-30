/** @jest-environment jsdom */
import { act, createElement as mockCreateElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import * as Linking from 'expo-linking';
import { Platform } from 'react-native';
import { URL as NodeURL, URLSearchParams as NodeURLSearchParams } from 'node:url';

import ConfirmScreen from '../../app/confirm';
import ResetScreen from '../../app/reset';
import { scrubAuthCallbackUrl, useAuthCallbackUrl } from '@/hooks/useAuthCallbackUrl';
import { sessionFromUrl } from '@/lib/authLink';

const mockRouter = { replace: jest.fn() };
let mockRouteParams: Record<string, string | string[]> = {};
const mockUpdatePassword = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  useLocalSearchParams: () => mockRouteParams,
}));
jest.mock('expo-linking', () => ({
  getInitialURL: jest.fn(),
  getLinkingURL: jest.fn(),
  addEventListener: jest.fn(),
}));
jest.mock('@/lib/authLink', () => ({ sessionFromUrl: jest.fn() }));
jest.mock('@/providers/AuthProvider', () => ({
  useAuth: () => ({ session: { user: { id: 'existing' } }, updatePassword: mockUpdatePassword }),
}));
jest.mock('@/lib/dialog', () => ({ notify: jest.fn() }));
jest.mock('react-native', () => {
  const actual = jest.requireActual('react-native');
  return Object.create(actual, {
    Platform: { value: { ...actual.Platform, OS: 'ios' } },
    StyleSheet: { value: { create: (styles: unknown) => styles } },
    KeyboardAvoidingView: {
      value: ({ children }: { children: ReactNode }) => mockCreateElement('div', {}, children),
    },
    Pressable: {
      value: ({ children }: { children: ReactNode }) => mockCreateElement('div', {}, children),
    },
  });
});
jest.mock('@/components/ui', () => ({
  Loading: ({ label }: { label: string }) => mockCreateElement('div', {}, label),
  Screen: ({ children }: { children: ReactNode }) => mockCreateElement('div', {}, children),
  Text: ({ children }: { children: ReactNode }) => mockCreateElement('div', {}, children),
  Button: ({ title, onPress }: { title: string; onPress: () => void }) =>
    mockCreateElement('button', { onClick: onPress }, title),
  Input: () => mockCreateElement('input'),
}));

let root: Root;
let container: HTMLDivElement;
const initialUrl = jest.mocked(Linking.getInitialURL);
const exchange = jest.mocked(sessionFromUrl);
const subscription = jest.mocked(Linking.addEventListener);

beforeAll(() => {
  // jest-expo installs native URL shims; web callbacks use the browser standard.
  Object.defineProperty(globalThis, 'URL', { value: NodeURL, configurable: true });
  Object.defineProperty(globalThis, 'URLSearchParams', {
    value: NodeURLSearchParams,
    configurable: true,
  });
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
beforeEach(() => {
  jest.clearAllMocks();
  mockRouteParams = {};
  jest.mocked(Linking.getLinkingURL).mockReturnValue(null);
  Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true });
  initialUrl.mockResolvedValue(null);
  exchange.mockResolvedValue(false);
  subscription.mockReturnValue({ remove: jest.fn() } as unknown as ReturnType<
    typeof Linking.addEventListener
  >);
  container = document.createElement('div');
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
});

it('waits for the initial confirmation URL before exchanging or navigating', async () => {
  let resolve!: (url: string) => void;
  initialUrl.mockReturnValueOnce(
    new Promise((done) => {
      resolve = done;
    }),
  );
  exchange.mockResolvedValueOnce(true);
  await act(async () => {
    root.render(<ConfirmScreen />);
  });
  expect(container.textContent).toContain('Confirming');
  expect(exchange).not.toHaveBeenCalled();
  expect(mockRouter.replace).not.toHaveBeenCalled();
  await act(async () => {
    resolve('guardians://confirm?code=example');
  });
  expect(exchange).toHaveBeenCalledWith('guardians://confirm?code=example', 'confirmation');
  expect(mockRouter.replace).toHaveBeenCalledWith('/');
});

it('does not let an existing session authorize an invalid recovery URL', async () => {
  initialUrl.mockResolvedValue('guardians://reset?error=expired');
  await act(async () => {
    root.render(<ResetScreen />);
  });
  expect(container.textContent).toContain('Reset link could not be verified');
  expect(container.textContent).not.toContain('Choose a new password');
  expect(exchange).toHaveBeenCalledWith('guardians://reset?error=expired', 'recovery');
});

it('does not re-exchange an accepted recovery token on a render and preserves the password form', async () => {
  initialUrl.mockResolvedValue('guardians://reset?code=example');
  exchange.mockResolvedValueOnce(true);
  await act(async () => {
    root.render(<ResetScreen />);
  });
  await act(async () => {
    root.render(<ResetScreen />);
  });
  expect(exchange).toHaveBeenCalledTimes(1);
  expect(container.textContent).toContain('Choose a new password');
  expect(container.querySelectorAll('input')).toHaveLength(2);
});

it('offers an explicit retry after verification fails', async () => {
  initialUrl.mockResolvedValue('guardians://confirm?code=example');
  exchange.mockRejectedValueOnce(new Error('Network unavailable')).mockResolvedValueOnce(true);
  await act(async () => {
    root.render(<ConfirmScreen />);
  });
  expect(container.textContent).toContain('Email confirmation unavailable');
  await act(async () => {
    container.querySelector('button')?.click();
  });
  expect(exchange).toHaveBeenCalledTimes(2);
  expect(mockRouter.replace).toHaveBeenCalledWith('/');
});

it('does not allow a late initial URL to overwrite a newer native link event', async () => {
  let resolve!: (url: string) => void;
  initialUrl.mockReturnValueOnce(
    new Promise((done) => {
      resolve = done;
    }),
  );
  let result: ReturnType<typeof useAuthCallbackUrl> | undefined;
  function Harness() {
    result = useAuthCallbackUrl();
    return null;
  }
  await act(async () => {
    root.render(<Harness />);
  });
  await act(async () => {
    subscription.mock.calls[0][1]({ url: 'guardians://confirm?code=new' });
    resolve('guardians://confirm?code=old');
  });
  expect(result).toEqual({ ready: true, url: 'guardians://confirm?code=new' });
});

it('reads the complete browser URL and scrubs authentication credentials after processing', async () => {
  Object.defineProperty(Platform, 'OS', { value: 'web', configurable: true });
  window.history.replaceState(
    null,
    '',
    '/reset?code=secret&next=home#access_token=secret&refresh_token=secret&type=recovery',
  );
  const fullUrl = window.location.href;
  let result: ReturnType<typeof useAuthCallbackUrl> | undefined;
  function Harness() {
    result = useAuthCallbackUrl();
    return null;
  }
  await act(async () => {
    root.render(<Harness />);
  });
  expect(result).toEqual({ ready: true, url: fullUrl });
  expect(initialUrl).not.toHaveBeenCalled();
  scrubAuthCallbackUrl(fullUrl);
  expect(window.location.pathname + window.location.search + window.location.hash).toBe(
    '/reset?next=home',
  );
});

it.each([null, 'guardians://confirm?code=old-launch'])(
  'uses current warm callback route credentials over the initial URL %s',
  async (launchUrl) => {
    mockRouteParams = { code: 'warm-callback' };
    initialUrl.mockResolvedValue(launchUrl);
    exchange.mockResolvedValueOnce(true);
    await act(async () => {
      root.render(<ConfirmScreen />);
    });
    expect(exchange).toHaveBeenCalledWith(
      'guardians://auth-callback?code=warm-callback',
      'confirmation',
    );
    expect(exchange).toHaveBeenCalledTimes(1);
    expect(mockRouter.replace).toHaveBeenCalledWith('/');
  },
);

it('preserves repeated callback route credentials for strict ambiguity rejection', async () => {
  mockRouteParams = { code: ['first', 'second'], type: 'signup' };
  await act(async () => {
    root.render(<ConfirmScreen />);
  });
  expect(exchange).toHaveBeenCalledWith(
    'guardians://auth-callback?code=first&code=second&type=signup',
    'confirmation',
  );
  expect(container.textContent).toContain('Email confirmation unavailable');
});

it('recovers a warm implicit callback from the SDK56 native link cache', async () => {
  const currentLink = 'guardians://reset#access_token=current&refresh_token=current&type=recovery';
  jest.mocked(Linking.getLinkingURL).mockReturnValue(currentLink);
  initialUrl.mockResolvedValue('guardians://confirm?code=old-launch');
  exchange.mockResolvedValueOnce(true);
  await act(async () => {
    root.render(<ResetScreen />);
  });
  expect(exchange).toHaveBeenCalledWith(currentLink, 'recovery');
  expect(initialUrl).not.toHaveBeenCalled();
  expect(container.textContent).toContain('Choose a new password');
});
