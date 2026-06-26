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
    p_lat: coords?.lat ?? null,
    p_lng: coords?.lng ?? null,
  });
  if (error) throw error;
}

/**
 * Ask the `send-push` Edge Function to alert nearby guardians about an urgent
 * sighting. Fire-and-forget — never blocks or fails the report flow.
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
