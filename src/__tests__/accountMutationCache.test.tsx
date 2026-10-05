/** @jest-environment jsdom */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { updateMyProfile } from '@/api/profiles';
import { submitScreening } from '@/api/screening';
import { useUpdateProfile } from '@/hooks/useProfile';
import { useSubmitScreening } from '@/hooks/useScreening';
import { createAccountCacheBoundary } from '@/lib/accountCache';
import { queryKeys } from '@/lib/queryClient';
import type { AdopterScreening, Profile, ScreeningPayload } from '@/types/models';

jest.mock('@/api/profiles', () => ({ updateMyProfile: jest.fn() }));
jest.mock('@/api/screening', () => ({ submitScreening: jest.fn() }));
jest.mock('@/hooks/useModeration', () => ({ useIsModerator: jest.fn() }));
jest.mock('@/providers/AuthProvider', () => ({ useAuth: jest.fn() }));
jest.mock('@/lib/observability', () => ({ track: jest.fn(), captureError: jest.fn() }));

let root: Root;
let client: QueryClient;
let changeAccount: ReturnType<typeof createAccountCacheBoundary>;
let profileMutation: ReturnType<typeof useUpdateProfile>;
let screeningMutation: ReturnType<typeof useSubmitScreening>;

function Harness() {
  const profile = useUpdateProfile();
  const screening = useSubmitScreening();
  useEffect(() => {
    profileMutation = profile;
    screeningMutation = screening;
  });
  return null;
}

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
beforeEach(async () => {
  jest.clearAllMocks();
  client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
  changeAccount = createAccountCacheBoundary(client);
  changeAccount('alice');
  root = createRoot(document.createElement('div'));
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <Harness />
      </QueryClientProvider>,
    );
  });
});
afterEach(() => {
  act(() => root.unmount());
  client.clear();
});

test.each(['profile', 'screening'] as const)(
  'a delayed %s mutation cannot restore the previous account data after switching',
  async (kind) => {
    let finish!: (value: Profile & AdopterScreening) => void;
    const response = new Promise<Profile & AdopterScreening>((resolve) => {
      finish = resolve;
    });
    jest.mocked(updateMyProfile).mockReturnValue(response);
    jest.mocked(submitScreening).mockReturnValue(response);
    let mutation!: Promise<Profile | AdopterScreening>;
    await act(async () => {
      mutation =
        kind === 'profile'
          ? profileMutation.mutateAsync({ full_name: 'Alice' })
          : screeningMutation.mutateAsync({} as ScreeningPayload);
    });
    const key = kind === 'profile' ? queryKeys.me : queryKeys.screening;
    await act(async () => {
      changeAccount('bob');
      client.setQueryData(key, { full_name: 'Bob' });
      finish({ id: 'alice', user_id: 'alice', full_name: 'Alice private data' } as Profile &
        AdopterScreening);
      await mutation;
    });
    expect(client.getQueryData(key)).toEqual({ full_name: 'Bob' });
  },
);

test('a token refresh preserves an in-flight screening save for the same account', async () => {
  let finish!: (value: AdopterScreening) => void;
  jest.mocked(submitScreening).mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  let mutation!: Promise<AdopterScreening>;
  await act(async () => {
    mutation = screeningMutation.mutateAsync({} as ScreeningPayload);
  });
  const screening = { user_id: 'alice', full_name: 'Alice' } as AdopterScreening;
  await act(async () => {
    changeAccount('alice');
    finish(screening);
    await mutation;
  });
  expect(client.getQueryData(queryKeys.screening)).toEqual(screening);
});
