import { supabase } from '@/lib/supabase';
import { captureError } from '@/lib/observability';

/**
 * Register/refresh this device's Expo push token + a COARSE home area
 * (server rounds to ~110m). Only the owner can write their tokens. (0010)
 */
export async function upsertPushToken(
  token: string,
  coords: { lat: number; lng: number } | null,
): Promise<void> {
  const { error } = await supabase.rpc('upsert_push_token', {
    p_token: token,
    p_lat: coords?.lat,
    p_lng: coords?.lng,
  });
  if (error) throw error;
}

/**
 * Enable/disable server-side pushes on ALL of the signed-in user's push-token
 * rows. Backs the client-side push opt-in flag (P1-1).
 *
 * The `set_push_enabled` RPC ships in migration 0029 and isn't in the
 * generated Database types yet, so this calls through a minimally-typed RPC
 * surface (same boundary cast src/api/ai.ts uses for untyped endpoints) until
 * `npm run gen:types` picks it up.
 */
export async function setPushEnabled(enabled: boolean): Promise<void> {
  const { error } = await (
    supabase.rpc as unknown as (
      fn: string,
      args: Record<string, unknown>,
    ) => Promise<{ error: Error | null }>
  )('set_push_enabled', { p_enabled: enabled });
  if (error) throw error;
}

/**
 * Ask the `send-push` Edge Function to alert nearby guardians about an urgent
 * sighting. Fire-and-forget — never blocks or fails the report flow.
 *
 * @deprecated DB triggers now send pushes server-side; kept for manual
 * re-invocation.
 */
export async function notifyUrgentSighting(sightingId: string): Promise<void> {
  try {
    const { error } = await supabase.functions.invoke('send-push', {
      body: { sighting_id: sightingId },
    });
    if (error) throw error;
  } catch (e) {
    // Best-effort: the report itself already succeeded, so never rethrow. But
    // route the failure to observability — a broken urgent-alert pipeline is
    // safety-critical and must not fail silently.
    captureError(e, { scope: 'notifyUrgentSighting', sightingId });
  }
}
