import { supabase } from '@/lib/supabase';

jest.mock('@sentry/react-native', () => ({ captureException: jest.fn() }));
jest.mock('@/lib/env', () => ({ env: { isConfigured: true } }));
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
