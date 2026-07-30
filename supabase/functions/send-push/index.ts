// deno-lint-ignore-file no-explicit-any
// Supabase Edge Function: send-push (Deno runtime)
// -----------------------------------------------------------------------------
// One sender, TWO authenticated entry paths (P1-4):
//
//  1. Server-to-server (DB triggers, migration 0029): pg_net calls this
//     function with an `x-push-webhook-secret` header — no user JWT exists in
//     that context, so a shared secret authenticates the call (the
//     PUSH_WEBHOOK_SECRET edge secret MUST equal the private.push_config
//     'webhook_secret' row). Events:
//       urgent_sighting    → geo fan-out to opted-in users near the sighting
//       sighting_claimed   → targeted push to the reporter
//       rescue_completed   → targeted push to the reporter
//       adoption_interest  → targeted push to the lister
//
//  2. Authenticated client (legacy path, kept working): the app may invoke
//     this function with the caller's session JWT for `urgent_sighting` right
//     after creating an urgent report (src/api/push.ts). The reporter-only
//     check is preserved. Lifecycle types REQUIRE the webhook secret —
//     otherwise any signed-in user could push-spam arbitrary recipients.
//
// verify_jwt is OFF for this function (config.toml) because pg_net calls carry
// no JWT; every request is authenticated in-body via one of the paths above.
// The service role is used only here to read push tokens (never exposed to
// clients). Expo's push service is free.
//
// Deploy:
//   supabase functions deploy send-push
//   supabase secrets set SUPABASE_SERVICE_ROLE_KEY=... SUPABASE_ANON_KEY=... \
//     PUSH_WEBHOOK_SECRET=<random string matching private.push_config>
//   (SUPABASE_URL is provided automatically.)
// This file is Deno, not part of the React Native app (excluded in tsconfig).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const RADIUS_M = 8000;

type PushType = 'urgent_sighting' | 'sighting_claimed' | 'rescue_completed' | 'adoption_interest';
const LIFECYCLE_TYPES: readonly PushType[] = [
  'sighting_claimed',
  'rescue_completed',
  'adoption_interest',
];

interface SightingRow {
  id: string;
  reporter_id: string | null;
  lat: number;
  lng: number;
  needs_urgent_help: boolean;
  title: string | null;
}

interface ExpoMessage {
  to: string;
  title: string;
  body: string;
  sound: string;
  priority: string;
  channelId: string;
  data: Record<string, unknown>;
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const url = Deno.env.get('SUPABASE_URL')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const webhookSecret = Deno.env.get('PUSH_WEBHOOK_SECRET') ?? '';

  // Auth path 1: shared webhook secret (DB triggers via pg_net carry no JWT).
  // Disabled entirely when the edge secret is unset — an empty header can
  // never match.
  const headerSecret = req.headers.get('x-push-webhook-secret') ?? '';
  const isWebhook = webhookSecret.length > 0 && headerSecret === webhookSecret;

  // Auth path 2: caller session JWT (the app client).
  let callerId: string | null = null;
  if (!isWebhook) {
    const authHeader = req.headers.get('Authorization') ?? '';
    if (!authHeader) return json({ error: 'Unauthorized' }, 401);

    // Identify the caller from their session JWT.
    const caller = createClient(url, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const {
      data: { user },
    } = await caller.auth.getUser();
    if (!user) return json({ error: 'Unauthorized' }, 401);
    callerId = user.id;
  }

  let body: { type?: string; sighting_id?: string; recipient_user_id?: string | null };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Bad JSON' }, 400);
  }
  if (!body.sighting_id) return json({ error: 'sighting_id required' }, 400);

  // A missing/unknown type degrades to the original urgent fan-out (the legacy
  // client sends only sighting_id).
  const type: PushType = LIFECYCLE_TYPES.includes(body.type as PushType)
    ? (body.type as PushType)
    : 'urgent_sighting';

  // Lifecycle events are server-authoritative — a DB trigger already decided
  // the recipient. A caller-JWT request may only run the urgent geo fan-out.
  if (type !== 'urgent_sighting' && !isWebhook) return json({ error: 'Unauthorized' }, 401);

  const admin = createClient(url, serviceKey);

  const { data: s, error: sErr } = await admin
    .from('sightings')
    .select('id, reporter_id, lat, lng, needs_urgent_help, title')
    .eq('id', body.sighting_id)
    .single();
  if (sErr || !s) return json({ error: 'Sighting not found' }, 404);

  if (type === 'urgent_sighting') {
    if (!s.needs_urgent_help) return json({ skipped: 'not urgent' });
    // Client-path hardening (preserved): only the reporter may fan out. The
    // webhook path skips this — the INSERT trigger is the authority.
    if (callerId && s.reporter_id !== callerId) return json({ error: 'Forbidden' }, 403);
    return urgentGeoFanout(admin, s as SightingRow);
  }

  if (!body.recipient_user_id) return json({ error: 'recipient_user_id required' }, 400);
  return lifecyclePush(admin, type, s as SightingRow, body.recipient_user_id);
});

// ── Send paths ────────────────────────────────────────────────────────────────
// The supabase-js clients below are created without a Database generic (the
// edge runtime has no generated schema types), so helper params are typed as
// `any` for the client — mirrors ai-lost-match/ai-reid.

/**
 * Urgent geo fan-out (unchanged semantics): tokens_near resolves the opted-in
 * audience near the sighting, excluding the reporter.
 */
async function urgentGeoFanout(admin: any, s: SightingRow): Promise<Response> {
  const { data: rows, error: tErr } = await admin.rpc('tokens_near', {
    p_lat: s.lat,
    p_lng: s.lng,
    p_radius_m: RADIUS_M,
    p_exclude_user: s.reporter_id,
  });
  if (tErr) {
    console.error('[send-push] tokens_near failed:', tErr.message);
    return json({ error: tErr.message }, 500);
  }

  const tokens: string[] = (rows ?? []).map((r: { token: string }) => r.token);
  if (tokens.length === 0) return json({ sent: 0 });

  const title = '🚨 A cat needs urgent help nearby';
  const message = (s.title ?? '').trim() || 'Tap to help with a rescue near you.';
  const messages: ExpoMessage[] = tokens.map((to) => ({
    to,
    title,
    body: message,
    sound: 'default',
    priority: 'high',
    channelId: 'urgent',
    data: { sighting_id: s.id, type: 'urgent_sighting' },
  }));

  const { sent, failed, deadTokens } = await sendToExpo(messages);
  const reaped = await reapDeadTokens(admin, deadTokens);
  return json({ sent, failed, reaped });
}

/**
 * Targeted lifecycle push to one recipient. Reads device_push_tokens via the
 * service role (never exposed to clients), honoring the same opt-in semantics
 * tokens_near enforces (urgent_opt_in) plus the push_enabled master flag
 * (set_push_enabled, migration 0029) — an opted-out user is never pushed.
 */
async function lifecyclePush(
  admin: any,
  type: PushType,
  s: SightingRow,
  recipientId: string,
): Promise<Response> {
  const { data: tokenRows, error: tErr } = await admin
    .from('device_push_tokens')
    .select('token')
    .eq('user_id', recipientId)
    .eq('push_enabled', true)
    .eq('urgent_opt_in', true);
  if (tErr) {
    console.error('[send-push] load recipient tokens failed:', tErr.message);
    return json({ error: tErr.message }, 500);
  }
  const tokens: string[] = (tokenRows ?? []).map((r: { token: string }) => r.token);
  if (tokens.length === 0) return json({ sent: 0 });

  const sightingTitle = (s.title ?? '').trim();
  let title: string;
  let message: string;
  if (type === 'sighting_claimed') {
    title = '🦸 A Guardian is on it!';
    message = sightingTitle
      ? `"${sightingTitle}" was claimed — a Guardian is on the way.`
      : 'Your reported cat was claimed — a Guardian is on the way.';
  } else if (type === 'rescue_completed') {
    title = '🎉 The cat you reported is safe';
    message = sightingTitle
      ? `"${sightingTitle}" is now safe in care. Thank you for reporting!`
      : 'The cat is now safe in care. Thank you for reporting!';
  } else {
    // adoption_interest
    title = '🏠 Someone wants to adopt';
    message = sightingTitle
      ? `Someone wants to adopt "${sightingTitle}". Tap to review.`
      : 'Someone wants to adopt your cat. Tap to review.';
  }

  // data.type + sighting_id: the client's tap handler deep-links /sighting/[id].
  const messages: ExpoMessage[] = tokens.map((to) => ({
    to,
    title,
    body: message,
    sound: 'default',
    priority: 'high',
    channelId: 'urgent',
    data: { sighting_id: s.id, type },
  }));

  const { sent, failed, deadTokens } = await sendToExpo(messages);
  const reaped = await reapDeadTokens(admin, deadTokens);
  return json({ sent, failed, reaped });
}

// ── Shared Expo delivery (used by BOTH send paths) ────────────────────────────

/**
 * POST messages to Expo in chunks of 100. Logs non-OK Expo responses, inspects
 * per-message tickets, and collects DeviceNotRegistered tokens for reaping.
 */
async function sendToExpo(
  messages: ExpoMessage[],
): Promise<{ sent: number; failed: number; deadTokens: string[] }> {
  let sent = 0;
  let failed = 0;
  const deadTokens: string[] = [];

  for (let i = 0; i < messages.length; i += 100) {
    const chunk = messages.slice(i, i + 100);

    let resp: Response;
    try {
      resp = await fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(chunk),
      });
    } catch (e) {
      failed += chunk.length;
      console.error('[send-push] Expo request threw:', e);
      continue;
    }

    if (!resp.ok) {
      failed += chunk.length;
      console.error('[send-push] Expo responded', resp.status, await resp.text().catch(() => ''));
      continue;
    }

    // Inspect per-message tickets: count failures and collect tokens Expo
    // reports as DeviceNotRegistered so we can prune them.
    const payload = (await resp.json().catch(() => null)) as {
      data?: { status: string; message?: string; details?: { error?: string } }[];
    } | null;
    const tickets = payload?.data ?? [];
    if (tickets.length === 0) {
      sent += chunk.length; // no ticket detail (older response shape)
      continue;
    }
    tickets.forEach((ticket, j) => {
      if (ticket.status === 'ok') {
        sent += 1;
        return;
      }
      failed += 1;
      console.error('[send-push] ticket error:', ticket.message ?? ticket.details?.error);
      if (ticket.details?.error === 'DeviceNotRegistered' && chunk[j]) {
        deadTokens.push(chunk[j].to);
      }
    });
  }

  return { sent, failed, deadTokens };
}

/**
 * Reap dead tokens so device_push_tokens doesn't accumulate cruft and degrade
 * deliverability over time. Returns the number reaped (0 on failure).
 */
async function reapDeadTokens(admin: any, deadTokens: string[]): Promise<number> {
  if (deadTokens.length === 0) return 0;
  const { error: delErr } = await admin.from('device_push_tokens').delete().in('token', deadTokens);
  if (delErr) {
    console.error('[send-push] failed to reap dead tokens:', delErr.message);
    return 0;
  }
  return deadTokens.length;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
