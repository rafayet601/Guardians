import * as Sentry from '@sentry/react-native';

import { env } from '@/lib/env';
import { supabase } from '@/lib/supabase';
import type { Json } from '@/types/database';

/**
 * Centralized error + analytics façade.
 *
 * When EXPO_PUBLIC_SENTRY_DSN is set, errors are forwarded to Sentry.
 * In development without DSN, errors are logged to console. Product events go to
 * the self-hosted analytics_events table via the track_event RPC.
 */
type Props = Record<string, unknown>;

const isDev = __DEV__;

export function captureError(error: unknown, context?: Props): void {
  if (isDev) {
    console.error('[capture]', error, context ?? '');
  }
  // No-op unless initObservability ran with a DSN (uncaptured events are
  // dropped by Sentry when no client is bound).
  if (env.sentryDsn) {
    Sentry.captureException(error, { extra: context });
  }
}

export function track(event: string, props?: Props): void {
  if (isDev) {
    console.log('[track]', event, props ?? '');
    return; // keep dev events out of the production analytics table
  }
  if (!env.isConfigured) return;
  // Forward to the self-hosted analytics backend (track_event RPC →
  // analytics_events). Fire-and-forget — telemetry must never block or throw.
  void supabase.rpc('track_event', { p_event: event, p_props: (props ?? {}) as Json });
}

interface RNErrorUtils {
  getGlobalHandler?: () => ((error: unknown, isFatal?: boolean) => void) | undefined;
  setGlobalHandler?: (handler: (error: unknown, isFatal?: boolean) => void) => void;
}

/**
 * Route otherwise-unhandled JS errors through `captureError`. Native only —
 * web has no `ErrorUtils`, so this is a guarded no-op there. Call once at boot.
 */
export function initObservability(): void {
  // Initialize the Sentry backend when a DSN is configured. Without a DSN the
  // whole façade stays a console-only no-op. The @sentry/react-native/expo
  // config plugin (see app.config.ts) handles release/dist + Hermes sourcemap
  // upload during EAS builds for symbolication.
  if (env.sentryDsn) {
    Sentry.init({
      dsn: env.sentryDsn,
      enableNativeCrashHandling: true,
      tracesSampleRate: 0.2,
    });
  }

  const errorUtils = (globalThis as { ErrorUtils?: RNErrorUtils }).ErrorUtils;
  if (!errorUtils?.setGlobalHandler) return;
  const previous = errorUtils.getGlobalHandler?.();
  errorUtils.setGlobalHandler((error, isFatal) => {
    captureError(error, { source: 'global', fatal: Boolean(isFatal) });
    previous?.(error, isFatal);
  });
  if (isDev && !env.sentryDsn) {
    console.log(
      '[observability] running in no-op mode (set EXPO_PUBLIC_SENTRY_DSN to enable Sentry).',
    );
  }
}
