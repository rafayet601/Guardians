import { supabase } from '@/lib/supabase';
import * as Sentry from '@sentry/react-native';
import { initObservability } from '@/lib/observability';

jest.mock('@sentry/react-native', () => ({ captureException: jest.fn(), init: jest.fn() }));
jest.mock('@/lib/env', () => ({
  env: { isConfigured: true, sentryDsn: 'https://public@sentry.example/1' },
}));
jest.mock('@/lib/supabase', () => ({ supabase: { rpc: jest.fn() } }));

const rpc = supabase.rpc as jest.Mock;

async function productionTrack() {
  const runtime = globalThis as typeof globalThis & { __DEV__: boolean };
  const previous = runtime.__DEV__;
  runtime.__DEV__ = false;
  let track!: typeof import('@/lib/observability').track;
  jest.isolateModules(() => {
    track = require('@/lib/observability').track;
  });
  runtime.__DEV__ = previous;
  return track;
}

test('consumes the lazy RPC so a production funnel event is sent', async () => {
  const consumed = jest.fn((resolve) => resolve({ error: null }));
  rpc.mockReturnValue({ then: consumed });
  const track = await productionTrack();
  track('report_created', { urgent: true });
  await Promise.resolve();
  expect(rpc).toHaveBeenCalledWith('track_event', {
    p_event: 'report_created',
    p_props: { urgent: true },
  });
  expect(consumed).toHaveBeenCalledTimes(1);
});

test('a rejected telemetry request does not reject the user action', async () => {
  rpc.mockReturnValue({
    then: (_resolve: unknown, reject: (e: Error) => void) => reject(new Error('offline')),
  });
  const track = await productionTrack();
  expect(() => track('report_created')).not.toThrow();
  await new Promise((resolve) => setTimeout(resolve, 0));
});

test('Sentry sanitizes automatic breadcrumbs, errors, and performance events', () => {
  initObservability();
  const options = (Sentry.init as jest.Mock).mock.calls[0][0];
  expect(options.sendDefaultPii).toBe(false);
  const event = {
    message: 'Failed',
    request: { url: 'https://example.com/reset?code=private-code' },
  };
  expect(options.beforeSend(event).request.url).toBe('https://example.com/reset');
  expect(options.beforeSendTransaction(event).request.url).toBe('https://example.com/reset');
  const breadcrumb = { data: { from: '/reset#refresh_token=private-refresh' } };
  expect(options.beforeBreadcrumb(breadcrumb).data.from).not.toContain('private-refresh');
});

test('analytics discards credentials and personal fields before calling the RPC', async () => {
  rpc.mockResolvedValue({ error: null });
  const track = await productionTrack();
  track('event_failed', {
    source: 'query',
    access_token: 'private-access',
    phone: 'private-phone',
  });
  expect(rpc).toHaveBeenLastCalledWith('track_event', {
    p_event: 'event_failed',
    p_props: { source: 'query' },
  });
});
