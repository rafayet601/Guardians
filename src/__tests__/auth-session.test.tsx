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
    functions: { invoke: jest.fn() },
  },
}));
jest.mock('@/lib/push', () => ({ setPushAccount: jest.fn(), unregisterForPush: jest.fn() }));
jest.mock('@/lib/observability', () => ({ track: jest.fn(), captureError: jest.fn() }));

let auth: ReturnType<typeof useAuth>;
let listener: (event: string, session: Session | null) => void;
let resolveInitial: (value: { data: { session: Session | null } }) => void;
let tree: ReactTestRenderer;
const session = (id: string) => ({ user: { id }, access_token: `synthetic-${id}` }) as Session;
function Probe() {
  const value = useAuth();
  useEffect(() => {
    auth = value;
  }, [value]);
  return null;
}

beforeEach(async () => {
  jest.clearAllMocks();
  (supabase.auth.signOut as jest.Mock).mockResolvedValue({ error: null });
  (supabase.functions.invoke as jest.Mock).mockResolvedValue({ error: null });
  (unregisterForPush as jest.Mock).mockResolvedValue(undefined);
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

test.each(['signOut', 'deleteAccount'] as const)(
  '%s cannot affect a newer account while push detachment is pending',
  async (action) => {
    await act(async () => listener('SIGNED_IN', session('alice')));
    let finishDetach!: () => void;
    (unregisterForPush as jest.Mock).mockReturnValueOnce(
      new Promise<void>((resolve) => {
        finishDetach = resolve;
      }),
    );
    const operation = auth[action]();
    const result = expect(operation).rejects.toThrow('Your account changed');
    await act(async () => {
      listener('SIGNED_IN', session('bob'));
      finishDetach();
      await result;
    });
    expect(supabase.functions.invoke).not.toHaveBeenCalled();
    expect(supabase.auth.signOut).not.toHaveBeenCalled();
    expect(auth.user?.id).toBe('bob');
  },
);

test.each(['signOut', 'deleteAccount'] as const)(
  'a stale %s confirmation cannot start work on the next account',
  async (action) => {
    await act(async () => listener('SIGNED_IN', session('alice')));
    const previousAccountAction = auth[action];
    await act(async () => listener('SIGNED_IN', session('bob')));
    await expect(previousAccountAction()).rejects.toThrow('Your account changed');
    expect(unregisterForPush).not.toHaveBeenCalled();
    expect(supabase.functions.invoke).not.toHaveBeenCalled();
    expect(supabase.auth.signOut).not.toHaveBeenCalled();
  },
);

test('successful erasure signs out this device and clears its private cache', async () => {
  await act(async () => listener('SIGNED_IN', session('alice')));
  queryClient.setQueryData(['screening', 'mine'], { full_name: 'Alice private' });
  (supabase.auth.signOut as jest.Mock).mockImplementationOnce(async () => {
    listener('SIGNED_OUT', null);
    return { error: null };
  });
  await act(async () => auth.deleteAccount());
  expect(supabase.functions.invoke).toHaveBeenCalledWith('delete-account', {
    headers: { Authorization: 'Bearer synthetic-alice' },
  });
  expect(supabase.auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
  expect(auth.user).toBeNull();
  expect(queryClient.getQueryData(['screening', 'mine'])).toBeUndefined();
});

test('an erasure response from an old account cannot sign out a newer account', async () => {
  await act(async () => listener('SIGNED_IN', session('alice')));
  let finishDeletion!: (result: { error: null }) => void;
  (supabase.functions.invoke as jest.Mock).mockReturnValueOnce(
    new Promise((resolve) => {
      finishDeletion = resolve;
    }),
  );
  let operation!: Promise<void>;
  await act(async () => {
    operation = auth.deleteAccount();
  });
  expect(supabase.functions.invoke).toHaveBeenCalledTimes(1);
  await act(async () => {
    listener('SIGNED_IN', session('bob'));
    finishDeletion({ error: null });
    await operation;
  });
  expect(supabase.auth.signOut).not.toHaveBeenCalled();
  expect(auth.user?.id).toBe('bob');
});

test('backend erasure failure leaves the account retryable', async () => {
  await act(async () => listener('SIGNED_IN', session('alice')));
  (supabase.functions.invoke as jest.Mock).mockResolvedValueOnce({
    error: new Error('Storage cleanup unavailable'),
  });
  await expect(auth.deleteAccount()).rejects.toThrow('Storage cleanup unavailable');
  expect(supabase.auth.signOut).not.toHaveBeenCalled();
});

test.each(['returned', 'thrown'] as const)(
  'a %s sign-out failure after erasure reports that local cleanup is incomplete',
  async (kind) => {
    await act(async () => listener('SIGNED_IN', session('alice')));
    const error = new Error('offline');
    if (kind === 'returned') {
      (supabase.auth.signOut as jest.Mock).mockResolvedValueOnce({ error });
    } else {
      (supabase.auth.signOut as jest.Mock).mockRejectedValueOnce(error);
    }
    await expect(auth.deleteAccount()).rejects.toThrow(
      'Your account was deleted, but this device could not clear its session',
    );
  },
);
