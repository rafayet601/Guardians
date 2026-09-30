import { QueryClient } from '@tanstack/react-query';
import { createAccountCacheBoundary } from '@/lib/accountCache';

test('sign out and account changes remove private detail and profile data', () => {
  const client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
  const changeAccount = createAccountCacheBoundary(client);
  changeAccount('reporter');
  client.setQueryData(['me'], { username: 'reporter' });
  client.setQueryData(['sighting', 'cat'], { is_precise: true });
  changeAccount(null);
  expect(client.getQueryData(['me'])).toBeUndefined();
  expect(client.getQueryData(['sighting', 'cat'])).toBeUndefined();
  client.setQueryData(['me'], { username: 'reporter' });
  changeAccount('adopter');
  expect(client.getQueryData(['me'])).toBeUndefined();
  client.clear();
});

test('token refresh for the same account preserves cached work', () => {
  const client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
  const changeAccount = createAccountCacheBoundary(client);
  changeAccount('reporter');
  client.setQueryData(['me'], { username: 'reporter' });
  changeAccount('reporter');
  expect(client.getQueryData(['me'])).toEqual({ username: 'reporter' });
  client.clear();
});

test('an old in-flight private request cannot repopulate the next account cache', async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  const changeAccount = createAccountCacheBoundary(client);
  changeAccount('reporter');
  let finish!: (data: unknown) => void;
  const request = client
    .fetchQuery({
      queryKey: ['sighting', 'cat'],
      queryFn: () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    })
    .catch(() => undefined);
  changeAccount('adopter');
  finish({ is_precise: true });
  await request;
  expect(client.getQueryData(['sighting', 'cat'])).toBeUndefined();
  client.clear();
});
