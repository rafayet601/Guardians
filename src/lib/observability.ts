import { env } from '@/lib/env';

/**
 * Centralized error + analytics façade.
 *
 * Today it logs in development and is a safe no-op in production, so it ships
 * with zero accounts/native config. Wiring real services is a LOCALIZED change
 * here: drop a Sentry call into `captureError` (gated on `env.sentryDsn`) and a
 * PostHog/analytics call into `track`. The rest of the app already routes
 * through these two functions (React Query caches + key funnel events), so
 * nothing else changes when you turn the real services on.
 */
type Props = Record<string, unknown>;

const isDev = __DEV__;

export function captureError(error: unknown, context?: Props): void {
  if (isDev) {
    // eslint-disable-next-line no-console
    console.error('[capture]', error, context ?? '');
  }
  // TODO(observability): when env.sentryDsn is set, forward to Sentry here.
}

export function track(event: string, props?: Props): void {
  if (isDev) {
    // eslint-disable-next-line no-console
    console.log('[track]', event, props ?? '');
  }
  // TODO(observability): forward to analytics (e.g. PostHog) here.
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
  const errorUtils = (globalThis as { ErrorUtils?: RNErrorUtils }).ErrorUtils;
  if (!errorUtils?.setGlobalHandler) return;
  const previous = errorUtils.getGlobalHandler?.();
  errorUtils.setGlobalHandler((error, isFatal) => {
    captureError(error, { source: 'global', fatal: Boolean(isFatal) });
    previous?.(error, isFatal);
  });
  if (isDev && !env.sentryDsn) {
    // eslint-disable-next-line no-console
    console.log('[observability] running in no-op mode (set EXPO_PUBLIC_SENTRY_DSN to enable Sentry).');
  }
}
