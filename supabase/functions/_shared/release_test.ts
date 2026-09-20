// Test doubles implement the asynchronous Storage interface.
// deno-lint-ignore-file require-await
import { deleteUserUploads } from './deleteUserUploads.ts';
import { preflight } from './http.ts';

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

Deno.test('browser preflight succeeds without invoking authentication', () => {
  const response = preflight(new Request('https://example.com', { method: 'OPTIONS' }));
  assert(response?.status === 204, 'Expected preflight success');
  assert(
    response.headers.get('Access-Control-Allow-Headers')?.includes('authorization'),
    'Bearer header missing',
  );
  assert(
    preflight(new Request('https://example.com', { method: 'POST' })) === null,
    'POST must continue to auth',
  );
});

Deno.test('account upload cleanup paginates, visits folders and isolates the owner', async () => {
  const removed: string[] = [];
  const admin = {
    storage: {
      from: (bucket: string) => ({
        list: async (folder: string, { offset }: { offset: number }) => {
          assert(folder === 'owner' || folder === 'owner/nested', 'Escaped owner folder');
          const files =
            folder === 'owner/nested'
              ? [{ name: 'photo.jpg', id: 'nested-file' }]
              : [
                  ...Array.from({ length: 105 }, (_, i) => ({ name: `${i}.jpg`, id: `${i}` })),
                  { name: 'nested', id: null },
                ];
          return { data: files.slice(offset, offset + 100), error: null };
        },
        remove: async (paths: string[]) => {
          assert(paths.length <= 100, 'Removal batch too large');
          removed.push(...paths.map((path) => `${bucket}/${path}`));
          return { error: null };
        },
      }),
    },
  };
  await deleteUserUploads(admin, 'owner');
  assert(removed.length === 318, 'Skipped uploads beyond the first page');
  assert(new Set(removed).size === 318, 'Duplicate removal');
  assert(removed.includes('screening-docs/owner/nested/photo.jpg'), 'Private ID document missing');
  assert(removed.includes('avatars/owner/nested/photo.jpg'), 'Nested avatar missing');
  assert(removed.includes('cat-photos/owner/104.jpg'), 'Final page missing');
});

Deno.test('cleanup failures propagate so account deletion can be retried', async () => {
  for (const failure of ['list', 'remove']) {
    let failed = false;
    try {
      await deleteUserUploads(
        {
          storage: {
            from: () => ({
              list: async () => ({
                data: [{ name: 'photo.jpg', id: '1' }],
                error: failure === 'list' ? { message: 'offline' } : null,
              }),
              remove: async () => ({ error: { message: 'offline' } }),
            }),
          },
        },
        'owner',
      );
    } catch {
      failed = true;
    }
    assert(failed, `${failure} failure was swallowed`);
  }
});
