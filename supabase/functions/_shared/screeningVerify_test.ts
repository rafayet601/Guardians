function assertEquals(actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
  }
}

Deno.test(
  'unintegrated providers use real manual review even when secrets are configured',
  async () => {
    const originalServe = Deno.serve;
    const originalEnvGet = Deno.env.get;
    const originalFetch = globalThis.fetch;
    let handler: Deno.ServeHandler | undefined;
    let provider = 'manual';
    const updates: Record<string, unknown>[] = [];
    const env: Record<string, string> = {
      SUPABASE_URL: 'https://screening-test.supabase.co',
      SUPABASE_ANON_KEY: 'public-test-key',
      SUPABASE_SERVICE_ROLE_KEY: 'service-test-key',
      VERIFF_API_KEY: 'configured-test-secret',
      ONFIDO_API_TOKEN: 'configured-test-secret',
    };
    try {
      // Capture the actual endpoint without opening a server or requiring env/net permissions.
      Deno.serve = ((fn: Deno.ServeHandler) => {
        handler = fn;
        return {};
      }) as typeof Deno.serve;
      Deno.env.get = (key: string) => (key === 'ID_PROVIDER' ? provider : env[key]);
      globalThis.fetch = async (input, init) => {
        const request = new Request(input, init);
        const path = new URL(request.url).pathname;
        let body: unknown;
        if (path === '/auth/v1/user') {
          body = { id: 'test-user', aud: 'authenticated', role: 'authenticated' };
        } else if (path === '/rest/v1/adopter_screenings' && request.method === 'GET') {
          body = { id: 'test-screening', status: 'pending', id_status: 'unverified' };
        } else if (path === '/rest/v1/adopter_screenings' && request.method === 'PATCH') {
          updates.push(await request.json());
          body = null;
        } else {
          throw new Error(`Unexpected request: ${request.method} ${path}`);
        }
        return new Response(JSON.stringify(body), {
          headers: { 'Content-Type': 'application/json' },
        });
      };
      await import('../screening-verify/index.ts');
      if (!handler) throw new Error('Endpoint did not register its handler');
      for (provider of ['manual', 'veriff', 'onfido']) {
        const response = await handler(
          new Request('https://test.local/screening-verify', {
            method: 'POST',
            headers: { Authorization: 'Bearer test-session', 'Content-Type': 'application/json' },
            body: JSON.stringify({ id_doc_paths: ['test-user/front.jpg'] }),
          }),
          {} as Deno.ServeHandlerInfo,
        );
        assertEquals(response.status, 200);
        const result = await response.json();
        assertEquals(result.provider, 'manual');
        assertEquals(result.message.includes('Our team will review'), true);
        assertEquals(updates.at(-1)?.id_provider, 'manual');
        assertEquals(updates.at(-1)?.id_status, 'pending');
        assertEquals(updates.at(-1)?.id_doc_paths, ['test-user/front.jpg']);
      }
      const denied = await handler(
        new Request('https://test.local/screening-verify', { method: 'POST' }),
        {} as Deno.ServeHandlerInfo,
      );
      assertEquals(denied.status, 401);
      assertEquals(updates.length, 3);
    } finally {
      Deno.serve = originalServe;
      Deno.env.get = originalEnvGet;
      globalThis.fetch = originalFetch;
    }
  },
);
