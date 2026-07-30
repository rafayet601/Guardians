import AsyncStorage from '@react-native-async-storage/async-storage';

import { track } from '@/lib/observability';

/**
 * Permission priming (P1-1).
 *
 * iOS/Android give us one shot at each OS permission prompt, so a themed
 * primer explains the value first — exactly once per permission kind — and
 * every outcome is tracked for the permission funnel. The "shown" flags live
 * in AsyncStorage; a wipe/reinstall simply re-primes once, which is harmless.
 */

export type PermissionKind = 'location' | 'camera' | 'mediaLibrary' | 'notifications';

/** 'dismissed' = the user tapped "Not now" on the primer (no OS prompt ran). */
export type PermissionOutcome = 'granted' | 'denied' | 'dismissed';

const primerKey = (kind: PermissionKind) => `@guardians/primer_${kind}`;

/** True once the primer for `kind` has been answered (allow OR dismiss). */
export async function hasPrimerBeenShown(kind: PermissionKind): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(primerKey(kind))) === '1';
  } catch {
    return false; // fail-open — worst case the primer shows one extra time
  }
}

/** Mark the primer for `kind` as answered. Never throws. */
export async function markPrimerShown(kind: PermissionKind): Promise<void> {
  try {
    await AsyncStorage.setItem(primerKey(kind), '1');
  } catch {
    // best-effort — a lost flag just re-shows the primer once
  }
}

/** Funnel event for a permission decision (fire-and-forget). */
export function trackPermissionResult(kind: PermissionKind, result: PermissionOutcome): void {
  track('permission_result', { kind, result });
}
