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
    let sightingStatus = 'spotted';
    const audiences: string[] = [];
    let lastPushTitle = '';
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
          const sent = JSON.parse(String(init?.body ?? '[]'));
          lastPushTitle = (Array.isArray(sent) ? sent[0] : sent)?.title ?? '';
          body = { data: [{ status: 'ok', id: 'synthetic-ticket' }] };
        } else if (path === '/rest/v1/sightings') {
          assertEquals(request.headers.get('Authorization'), 'Bearer service-test-key');
          body = {
            id: 'sighting',
            reporter_id: 'reporter',
            needs_urgent_help: true,
            lat: 1,
            lng: 1,
            title: null,
            status: sightingStatus,
          };
        } else if (path === '/rest/v1/device_push_tokens') {
          body = [{ token: 'ExpoPushToken[recipient]' }];
        } else if (
          path === '/rest/v1/rpc/tokens_near' ||
          path === '/rest/v1/rpc/tokens_in_ring' ||
          path === '/rest/v1/rpc/batch_push_tokens'
        ) {
          audiences.push(path.split('/').pop()!);
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
      assertEquals(audiences, ['tokens_near', 'tokens_near']);

      // 0042: the escalation ladder asks for the wider ring, which is a
      // different audience with its own words.
      const trusted = (payload: Record<string, unknown>) =>
        handler!(
          new Request('https://test.local/send-push', {
            method: 'POST',
            headers: { 'x-push-webhook-secret': env.PUSH_WEBHOOK_SECRET },
            body: JSON.stringify(payload),
          }),
          {} as Deno.ServeHandlerInfo,
        );
      const ring = await trusted({
        type: 'urgent_sighting',
        sighting_id: 'sighting',
        escalation_step: 2,
      });
      assertEquals(await ring.json(), { sent: 1, failed: 0, reaped: 0 });
      assertEquals(audiences[2], 'tokens_in_ring');
      assertEquals(lastPushTitle, '🚨 A cat still needs urgent help');
      const unknownStep = await trusted({
        type: 'urgent_sighting',
        sighting_id: 'sighting',
        escalation_step: 7,
      });
      assertEquals(unknownStep.status, 400);

      // 0043: the database chose the audience and names the batch; send-push
      // delivers exactly that batch, whatever the step.
      const batch = await trusted({
        type: 'urgent_sighting',
        sighting_id: 'sighting',
        escalation_step: 2,
        batch_id: 'batch-1',
      });
      assertEquals(await batch.json(), { sent: 1, failed: 0, reaped: 0 });
      assertEquals(audiences[3], 'batch_push_tokens');
      assertEquals(lastPushTitle, '🚨 A cat still needs urgent help');
      const badBatch = await trusted({
        type: 'urgent_sighting',
        sighting_id: 'sighting',
        batch_id: 7,
      });
      assertEquals(badBatch.status, 400);

      // 0043: the reporter's status updates are worded from the event.
      const adopted = await trusted({
        event: 'case_status',
        recipient_user_id: 'reporter',
        about_sighting_id: 'sighting',
        status: 'adopted',
      });
      assertEquals(await adopted.json(), { sent: 1, failed: 0, reaped: 0 });
      assertEquals(lastPushTitle, '🎉 Adopted!');
      const unknownStatus = await trusted({
        event: 'case_status',
        recipient_user_id: 'reporter',
        about_sighting_id: 'sighting',
        status: 'claimed',
      });
      assertEquals(unknownStatus.status, 400);

      // Claimed while the alert was queued: nobody is broadcast to, and the
      // reporter is not told a cat with a Guardian is still waiting.
      sightingStatus = 'claimed';
      const late = await trusted({
        type: 'urgent_sighting',
        sighting_id: 'sighting',
        escalation_step: 2,
      });
      assertEquals(await late.json(), { skipped: 'no longer open' });
      const stale = await trusted({
        event: 'urgent_no_responder',
        recipient_user_id: 'reporter',
        about_sighting_id: 'sighting',
      });
      assertEquals(await stale.json(), { skipped: 'no longer applies' });
      assertEquals(audiences.length, 4);
      sightingStatus = 'spotted';

      const beforeUnconfigured = privilegedCalls;
      env.PUSH_WEBHOOK_SECRET = '';
      const unconfigured = await handler(
        request({ 'x-push-webhook-secret': '' }),
        {} as Deno.ServeHandlerInfo,
      );
      assertEquals(unconfigured.status, 401);
      assertEquals(privilegedCalls, beforeUnconfigured);
    } finally {
      Deno.serve = originalServe;
      Deno.env.get = originalEnvGet;
      globalThis.fetch = originalFetch;
    }
  },
);
