import { optedInPushTokens, sendExpoPush } from './expoPush.ts';
import { callClaude } from './anthropic.ts';
import { embedTexts } from './voyage.ts';

function equal(actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error('Unexpected result');
}

const messages = [{ to: 'synthetic-a' }, { to: 'synthetic-b' }, { to: 'synthetic-c' }];
const successful = () =>
  new Response(JSON.stringify({ data: [{ status: 'ok', id: 'synthetic-ticket' }] }));

Deno.test('targeted pushes enforce account ownership and both consent flags', async () => {
  const filters: unknown[] = [];
  const query = Object.assign(Promise.resolve({ data: [{ token: 'synthetic' }], error: null }), {
    eq(column: string, value: string | boolean) {
      filters.push([column, value]);
      return query;
    },
  });
  equal(
    await optedInPushTokens(
      {
        from(table) {
          equal(table, 'device_push_tokens');
          return { select: () => query };
        },
      },
      'synthetic-owner',
    ),
    ['synthetic'],
  );
  equal(filters, [
    ['user_id', 'synthetic-owner'],
    ['push_enabled', true],
    ['urgent_opt_in', true],
  ]);
});

Deno.test('missing and malformed Expo tickets are failures, never assumed delivery', async () => {
  for (const payload of [null, {}, { data: [] }, { data: {} }, { data: [null] }]) {
    equal(
      await sendExpoPush(messages, {
        fetch: () => Promise.resolve(new Response(JSON.stringify(payload))),
      }),
      { sent: 0, failed: 3, deadTokens: [] },
    );
  }
  equal(
    await sendExpoPush(messages, {
      fetch: () =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              data: [
                { status: 'ok', id: 'synthetic-ticket' },
                {
                  status: 'error',
                  details: { error: 'DeviceNotRegistered' },
                },
              ],
            }),
          ),
        ),
    }),
    { sent: 1, failed: 2, deadTokens: ['synthetic-b'] },
  );
  equal(
    await sendExpoPush(messages.slice(0, 1), {
      fetch: () => Promise.resolve(new Response(JSON.stringify({ data: [{ status: 'ok' }] }))),
    }),
    { sent: 0, failed: 1, deadTokens: [] },
  );
});

Deno.test(
  'temporary provider failures retry with bounded backoff; permanent failures do not',
  async () => {
    for (const status of [429, 503, 'network'] as const) {
      let requests = 0;
      const waits: number[] = [];
      equal(
        await sendExpoPush(messages.slice(0, 1), {
          fetch: (_input, init) => {
            if (!init?.signal) throw new Error('Missing request timeout');
            requests++;
            if (requests === 3) return Promise.resolve(successful());
            if (status === 'network') return Promise.reject(new Error('synthetic-private-data'));
            return Promise.resolve(new Response('synthetic-private-data', { status }));
          },
          wait: (ms) => {
            waits.push(ms);
            return Promise.resolve();
          },
        }),
        { sent: 1, failed: 0, deadTokens: [] },
      );
      equal(requests, 3);
      equal(waits, [500, 1000]);
    }
    let requests = 0;
    equal(
      await sendExpoPush(messages, {
        fetch: () => {
          requests++;
          return Promise.resolve(new Response('synthetic-private-data', { status: 400 }));
        },
      }),
      { sent: 0, failed: 3, deadTokens: [] },
    );
    equal(requests, 1);
    requests = 0;
    equal(
      await sendExpoPush(messages, {
        fetch: () => {
          requests++;
          return Promise.resolve(new Response('unavailable', { status: 503 }));
        },
        wait: () => Promise.resolve(),
      }),
      { sent: 0, failed: 3, deadTokens: [] },
    );
    equal(requests, 3);
  },
);

Deno.test(
  'push batches never exceed 100 and provider diagnostics cannot expose tokens',
  async () => {
    const originalError = console.error;
    const logs: unknown[][] = [];
    const batchSizes: number[] = [];
    try {
      console.error = (...args) => logs.push(args);
      const batch = Array.from({ length: 201 }, () => ({ to: 'synthetic-private-token' }));
      equal(
        await sendExpoPush(batch, {
          fetch: (_input, init) => {
            const chunk = JSON.parse(String(init?.body));
            batchSizes.push(chunk.length);
            return Promise.resolve(
              new Response(
                JSON.stringify({
                  data: chunk.map(() => ({
                    status: 'error',
                    message: 'synthetic-private-token',
                    details: { error: 'synthetic-private-token' },
                  })),
                }),
              ),
            );
          },
        }),
        { sent: 0, failed: 201, deadTokens: [] },
      );
      equal(batchSizes, [100, 100, 1]);
      if (JSON.stringify(logs).includes('synthetic-private-token')) {
        throw new Error('Provider diagnostics exposed a token');
      }
    } finally {
      console.error = originalError;
    }
  },
);

Deno.test('AI provider failures expose status only and discard echoed private input', async () => {
  const originalFetch = globalThis.fetch;
  const originalGet = Deno.env.get;
  try {
    Deno.env.get = () => 'synthetic-provider-key';
    globalThis.fetch = () =>
      Promise.resolve(new Response('synthetic-private-input', { status: 400 }));
    for (const call of [
      () => callClaude({ messages: [{ role: 'user', content: 'synthetic' }] }),
      () => embedTexts(['synthetic']),
    ]) {
      let message = '';
      try {
        await call();
      } catch (error) {
        message = error instanceof Error ? error.message : String(error);
      }
      if (!message.includes('400') || message.includes('synthetic-private-input')) {
        throw new Error('Unsafe or missing provider error');
      }
    }
  } finally {
    globalThis.fetch = originalFetch;
    Deno.env.get = originalGet;
  }
});

Deno.test(
  'malformed provider JSON cannot leak generated private text through parser errors',
  async () => {
    const originalFetch = globalThis.fetch;
    const originalGet = Deno.env.get;
    try {
      Deno.env.get = () => 'synthetic-provider-key';
      for (const structured of [false, true]) {
        globalThis.fetch = () =>
          Promise.resolve(
            new Response(
              structured
                ? JSON.stringify({ content: [{ type: 'text', text: 'synthetic-private-text' }] })
                : 'synthetic-private-text',
            ),
          );
        const calls = structured
          ? [() => callClaude({ messages: [], jsonSchema: {} })]
          : [() => callClaude({ messages: [] }), () => embedTexts(['synthetic'])];
        for (const call of calls) {
          let message = '';
          try {
            await call();
          } catch (error) {
            message = error instanceof Error ? error.message : String(error);
          }
          if (!message.includes('not valid JSON') || message.includes('synthetic-private-text')) {
            throw new Error('Parser diagnostics exposed private provider output');
          }
        }
      }
    } finally {
      globalThis.fetch = originalFetch;
      Deno.env.get = originalGet;
    }
  },
);
