import type { QueryClient } from '@tanstack/react-query';

const accountGenerations = new WeakMap<QueryClient, number>();

/** Capture at mutation start: clearing a cache does not stop mutation callbacks. */
export function captureAccountCacheGuard(client: QueryClient): () => boolean {
  const generation = accountGenerations.get(client) ?? 0;
  return () => (accountGenerations.get(client) ?? 0) === generation;
}

/** Clear private cached responses before publishing a different auth identity. */
export function createAccountCacheBoundary(client: QueryClient) {
  let previousUserId: string | null | undefined;
  return (userId: string | null) => {
    if (userId === previousUserId) return;
    previousUserId = userId;
    accountGenerations.set(client, (accountGenerations.get(client) ?? 0) + 1);
    // clear also destroys in-flight queries so their old responses cannot be
    // restored into the cache after the account changes.
    client.clear();
  };
}
