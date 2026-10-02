import { redactTelemetry } from '@/lib/telemetryPrivacy';

test('scrubs auth callbacks, signed documents and nested credential context without mutating the event', () => {
  const event = {
    message: 'Network failed',
    request: {
      url: 'https://guardians.example/reset?code=secret-code#access_token=access-secret',
      headers: { Authorization: 'Bearer secret-header', Cookie: 'session=secret-cookie' },
      data: { unfamiliar_form_field: 'private-body' },
      query_string: 'code=private-query',
      method: 'POST',
    },
    breadcrumbs: [
      { category: 'navigation', data: { from: '/confirm?token_hash=hash-secret&type=signup' } },
      {
        category: 'navigation',
        data: {
          to: '/reset#access_token=access-secret&refresh_token=refresh-secret&code=code-secret',
        },
      },
      {
        category: 'fetch',
        data: {
          url: 'https://project.supabase.co/storage/v1/object/sign/screening-docs/alice/id.jpg?token=signed-secret',
          status_code: 403,
        },
      },
    ],
    extra: {
      credentials: {
        refresh_token: 'refresh-secret',
        provider_token: 'provider-secret',
        password: 'password-secret',
      },
      phone: 'private-phone',
      full_name: 'private-name',
      source: 'query',
    },
  };
  const result = redactTelemetry(event);
  const serialized = JSON.stringify(result);
  expect(serialized).not.toMatch(/secret|private-/);
  expect(result.message).toBe('Network failed');
  expect(result.request.method).toBe('POST');
  expect(result.extra.source).toBe('query');
  expect(result.breadcrumbs[2].data.status_code).toBe(403);
  expect(event.request.headers.Authorization).toBe('Bearer secret-header');
});

test('keeps an error useful while removing bearer tokens and JWTs from its message/stack', () => {
  const error = new Error(
    'Request failed with Bearer sensitive-token and eyJhbGciOiJIUzI1NiJ9.payload.signature',
  );
  const result = redactTelemetry(error);
  expect(result.message).toContain('Request failed with Bearer [Filtered]');
  expect(JSON.stringify(result)).not.toContain('sensitive-token');
  expect(JSON.stringify(result)).not.toContain('eyJ');
  expect(result.stack).toContain('telemetryPrivacy.test');
});

test('bounds recursion when an error context is cyclic', () => {
  const context: { source: string; self?: unknown } = { source: 'query' };
  context.self = context;
  expect(redactTelemetry(context)).toEqual({ source: 'query', self: '[Filtered]' });
});
