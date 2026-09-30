import { QueryClientProvider } from '@tanstack/react-query';
import { useEffect } from 'react';
import type { Session } from '@supabase/supabase-js';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { setPushAccount, unregisterForPush } from '@/lib/push';
import { queryClient } from '@/lib/queryClient';
import { supabase } from '@/lib/supabase';
import { AuthProvider, useAuth } from '@/providers/AuthProvider';

jest.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: jest.fn(),
      onAuthStateChange: jest.fn(),
      signOut: jest.fn(),
    },
  },
}));
jest.mock('@/lib/push', () => ({ setPushAccount: jest.fn(), unregisterForPush: jest.fn() }));
jest.mock('@/lib/observability', () => ({ track: jest.fn(), captureError: jest.fn() }));

let auth: ReturnType<typeof useAuth>;
let listener: (event: string, session: Session | null) => void;
let resolveInitial: (value: { data: { session: Session | null } }) => void;
let tree: ReactTestRenderer;
const session = (id: string) => ({ user: { id } }) as Session;
function Probe() {
  const value = useAuth();
  useEffect(() => {
    auth = value;
  }, [value]);
  return null;
}

beforeEach(async () => {
  queryClient.clear();
  (supabase.auth.getSession as jest.Mock).mockReturnValue(
    new Promise((resolve) => {
      resolveInitial = resolve;
    }),
  );
  (supabase.auth.onAuthStateChange as jest.Mock).mockImplementation((cb) => {
    listener = cb;
    return { data: { subscription: { unsubscribe: jest.fn() } } };
  });
  await act(async () => {
    tree = create(
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <Probe />
        </AuthProvider>
      </QueryClientProvider>,
    );
  });
});
afterEach(async () => {
  await act(async () => {
    tree.unmount();
  });
  queryClient.clear();
});

test('account changes discard privileged cache while token refresh preserves it', async () => {
  await act(async () => {
    listener('SIGNED_IN', session('alice'));
  });
  queryClient.setQueryData(['sighting', 'cat'], { preciseLocation: 'private' });
  await act(async () => {
    listener('TOKEN_REFRESHED', session('alice'));
  });
  expect(queryClient.getQueryData(['sighting', 'cat'])).toBeDefined();
  await act(async () => {
    listener('SIGNED_OUT', null);
  });
  expect(queryClient.getQueryData(['sighting', 'cat'])).toBeUndefined();
  await act(async () => {
    listener('SIGNED_IN', session('bob'));
  });
  expect(auth.user?.id).toBe('bob');
  expect(setPushAccount).toHaveBeenLastCalledWith('bob');
});

test('a delayed initial session cannot restore the account after sign-out', async () => {
  await act(async () => {
    listener('SIGNED_IN', session('alice'));
    listener('SIGNED_OUT', null);
  });
  await act(async () => {
    resolveInitial({ data: { session: session('alice') } });
  });
  expect(auth.user).toBeNull();
  expect(auth.initializing).toBe(false);
});

test('sign-out failures reach the caller', async () => {
  const error = new Error('offline');
  (supabase.auth.signOut as jest.Mock).mockResolvedValue({ error });
  await expect(auth.signOut()).rejects.toThrow('offline');
});

test('push unregister failures prevent sign-out and reach the caller', async () => {
  await act(async () => {
    listener('SIGNED_IN', session('alice'));
  });
  (supabase.auth.signOut as jest.Mock).mockClear();
  (unregisterForPush as jest.Mock).mockRejectedValueOnce(new Error('push offline'));
  await expect(auth.signOut()).rejects.toThrow('push offline');
  expect(unregisterForPush).toHaveBeenLastCalledWith('alice');
  expect(supabase.auth.signOut).not.toHaveBeenCalled();
});
