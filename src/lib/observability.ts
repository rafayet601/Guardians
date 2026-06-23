import { env } from '@/lib/env';

/**
 * Centralized error + analytics façade.
 *
 * When EXPO_PUBLIC_SENTRY_DSN is set, errors are forwarded to Sentry.
 * In development without DSN, errors are logged to console.
 */
type Props = Record<string, unknown>;

const isDev = __DEV__;

export function captureError(error: unknown, context?: Props): void {
  if (isDev) {
    // eslint-disable-next-line no-console
    console.error('[capture]', error, context ?? '');
  }
  if (env.sentryDsn) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const Sentry = require('@sentry/react-native');
      Sentry.captureException(error, { extra: context });
    } catch {
      // Sentry not installed; ignore
    }
  }
}

export function track(event: string, props?: Props): void {
  if (isDev) {
    // eslint-disable-next-line no-console
    console.log('[track]', event, props ?? '');
  }
  // TODO(observability): forward to analytics (e.g. (e.g. PostHog) here.
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
