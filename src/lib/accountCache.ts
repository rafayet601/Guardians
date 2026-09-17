import type { QueryClient } from '@tanstack/react-query';

/** Clear private cached responses before publishing a different auth identity. */
export function createAccountCacheBoundary(client: QueryClient) {
  let previousUserId: string | null | undefined;
  return (userId: string | null) => {
    if (userId === previousUserId) return;
    previousUserId = userId;
    // clear also destroys in-flight queries so their old responses cannot be
    // restored into the cache after the account changes.
    client.clear();
  };
}
