function assertEquals(actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
  }
}

Deno.test(
  'push broadcasts reject user JWT replay and still accept authenticated DB triggers',
  async () => {
    const originalServe = Deno.serve;
    const originalEnvGet = Deno.env.get;
    const originalFetch = globalThis.fetch;
    let handler: Deno.ServeHandler | undefined;
    let privilegedCalls = 0;
    const env: Record<string, string> = {
      SUPABASE_URL: 'https://push-test.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'service-test-key',
      PUSH_WEBHOOK_SECRET: 'webhook-test-secret',
    };
    try {
      Deno.serve = ((fn: Deno.ServeHandler) => {
        handler = fn;
        return {};
      }) as typeof Deno.serve;
      Deno.env.get = (key: string) => env[key];
      globalThis.fetch = (input, init) => {
        privilegedCalls++;
        const request = new Request(input, init);
        const path = new URL(request.url).pathname;
        let body: unknown;
        if (new URL(request.url).hostname === 'exp.host') {
          body = { data: [{ status: 'ok', id: 'synthetic-ticket' }] };
        } else if (path === '/rest/v1/sightings') {
          assertEquals(request.headers.get('Authorization'), 'Bearer service-test-key');
          body = {
            id: 'sighting',
            reporter_id: 'reporter',
            needs_urgent_help: true,
            lat: 1,
            lng: 1,
          };
        } else if (path === '/rest/v1/rpc/tokens_near') {
          body = [{ token: 'ExpoPushToken[synthetic]' }];
        } else {
          throw new Error(`Unexpected request: ${request.method} ${path}`);
        }
        return Promise.resolve(
          new Response(JSON.stringify(body), {
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      };
      await import('../send-push/index.ts');
      if (!handler) throw new Error('Endpoint did not register its handler');
      const request = (headers: Record<string, string>) =>
        new Request('https://test.local/send-push', {
          method: 'POST',
          headers,
          body: JSON.stringify({ type: 'urgent_sighting', sighting_id: 'sighting' }),
        });
      const rejected: Record<string, string>[] = [
        {},
        { Authorization: 'Bearer reporter-session' },
        { Authorization: 'Bearer reporter-session', 'x-push-webhook-secret': 'wrong-secret' },
      ];
      for (const headers of rejected) {
        const response = await handler(request(headers), {} as Deno.ServeHandlerInfo);
        assertEquals(response.status, 401);
      }
      assertEquals(privilegedCalls, 0);
      const accepted = await handler(
        request({ 'x-push-webhook-secret': env.PUSH_WEBHOOK_SECRET }),
        {} as Deno.ServeHandlerInfo,
      );
      assertEquals(accepted.status, 200);
      assertEquals(await accepted.json(), { sent: 1, failed: 0, reaped: 0 });
      assertEquals(privilegedCalls, 3);
      // Current DB webhooks have no immutable event ID/outbox. Repeated trusted
      // delivery sends again: this explicitly guards against claiming dedupe.
      const repeated = await handler(
        request({ 'x-push-webhook-secret': env.PUSH_WEBHOOK_SECRET }),
        {} as Deno.ServeHandlerInfo,
      );
      assertEquals(await repeated.json(), { sent: 1, failed: 0, reaped: 0 });
      assertEquals(privilegedCalls, 6);
      env.PUSH_WEBHOOK_SECRET = '';
      const unconfigured = await handler(
        request({ 'x-push-webhook-secret': '' }),
        {} as Deno.ServeHandlerInfo,
      );
      assertEquals(unconfigured.status, 401);
      assertEquals(privilegedCalls, 6);
    } finally {
      Deno.serve = originalServe;
      Deno.env.get = originalEnvGet;
      globalThis.fetch = originalFetch;
    }
  },
);
