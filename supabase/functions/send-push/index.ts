// deno-lint-ignore-file no-explicit-any
// Supabase Edge Function: send-push (Deno runtime)
// -----------------------------------------------------------------------------
// Server-to-server notifications from DB triggers (migrations 0029 and 0038).
// Requests must present x-push-webhook-secret matching PUSH_WEBHOOK_SECRET.
// User JWTs cannot trigger broadcasts: the former reporter-owned replay path
// let any reporter spam every opted-in device near an old urgent sighting.
// All application notifications are already enqueued by database triggers.
//
// verify_jwt is OFF because pg_net carries no user JWT. This handler always
// checks the webhook secret before parsing the request or using service role.
//
// Deploy:
//   supabase functions deploy send-push
//   supabase secrets set SUPABASE_SERVICE_ROLE_KEY=... SUPABASE_ANON_KEY=... \
//     PUSH_WEBHOOK_SECRET=<random string matching private.push_config>
//   (SUPABASE_URL is provided automatically.)
// This file is Deno, not part of the React Native app (excluded in tsconfig).
import { corsHeaders, preflight, readJsonObject, RequestBodyError } from '../_shared/http.ts';
import { hasWebhookSecret } from '../_shared/webhook.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const RADIUS_M = 8000;

type PushType = 'urgent_sighting' | 'sighting_claimed' | 'rescue_completed' | 'adoption_interest';
const LIFECYCLE_TYPES: readonly PushType[] = [
  'sighting_claimed',
  'rescue_completed',
  'adoption_interest',
];

type PushEvent = 'screening_decided' | 'adoption_approved' | 'adoption_declined' | 'new_comment';
const PUSH_EVENTS: readonly PushEvent[] = [
  'screening_decided',
  'adoption_approved',
  'adoption_declined',
  'new_comment',
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
  const options = preflight(req);
  if (options) return options;
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const url = Deno.env.get('SUPABASE_URL')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const webhookSecret = Deno.env.get('PUSH_WEBHOOK_SECRET') ?? '';

  if (!hasWebhookSecret(req, 'x-push-webhook-secret', webhookSecret)) {
    return json({ error: 'Unauthorized' }, 401);
  }

  let body: {
    type?: string;
    sighting_id?: string;
    recipient_user_id?: string | null;
    event?: string;
    about_sighting_id?: string | null;
  };
  try {
    body = await readJsonObject(req);
  } catch (error) {
    return json(
      { error: error instanceof RequestBodyError ? error.message : 'Invalid JSON object' },
      error instanceof RequestBodyError ? error.status : 400,
    );
  }

  // Person-addressed events (0038): server-only, like the lifecycle types.
  if (body.event !== undefined) {
    if (!PUSH_EVENTS.includes(body.event as PushEvent)) {
      return json({ error: 'Unknown event' }, 400);
    }
    if (!body.recipient_user_id) return json({ error: 'recipient_user_id required' }, 400);
    return eventPush(
      createClient(url, serviceKey),
      body.event as PushEvent,
      body.recipient_user_id,
      body.about_sighting_id ?? null,
    );
  }

  if (!body.sighting_id) return json({ error: 'sighting_id required' }, 400);

  // A trigger always names its type. An unknown one must fail loudly rather
  // than fall through to the urgent broadcast below.
  if (
    body.type !== undefined &&
    body.type !== 'urgent_sighting' &&
    !LIFECYCLE_TYPES.includes(body.type as PushType)
  ) {
    return json({ error: 'Unknown type' }, 400);
  }

  const type: PushType = LIFECYCLE_TYPES.includes(body.type as PushType)
    ? (body.type as PushType)
    : 'urgent_sighting';

  const admin = createClient(url, serviceKey);

  const { data: s, error: sErr } = await admin
    .from('sightings')
    .select('id, reporter_id, lat, lng, needs_urgent_help, title')
    .eq('id', body.sighting_id)
    .single();
  if (sErr || !s) return json({ error: 'Sighting not found' }, 404);

  if (type === 'urgent_sighting') {
    if (!s.needs_urgent_help) return json({ skipped: 'not urgent' });
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
    return json({ error: 'Unable to load push recipients' }, 500);
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
  const tokens = await recipientTokens(admin, recipientId);
  if (tokens === null) return json({ error: 'Could not load recipient tokens' }, 500);
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

/**
 * Person-addressed event push (0038). The trigger decided the recipient; this
 * reads the current state so the words match what the person will see when
 * they open the app.
 */
async function eventPush(
  admin: any,
  event: PushEvent,
  recipientId: string,
  sightingId: string | null,
): Promise<Response> {
  let title: string;
  let message: string;
  let data: Record<string, unknown>;

  if (event === 'screening_decided') {
    const { data: row, error } = await admin
      .from('adopter_screenings')
      .select('status')
      .eq('user_id', recipientId)
      .maybeSingle();
    if (error) {
      console.error('[send-push] load screening failed:', error.message);
      return json({ error: 'Could not load screening' }, 500);
    }
    if (row?.status === 'approved') {
      title = "✅ You're cleared to adopt";
      message = 'Your background check is approved for 12 months. Find a cat who needs a home.';
    } else if (row?.status === 'needs_review') {
      title = '📝 Your background check needs more information';
      message = 'Open Guardians to see what to add.';
    } else if (row?.status === 'rejected') {
      title = 'Your background check was not approved';
      message = 'Open Guardians to see why.';
    } else {
      // Changed again before this ran (resubmitted, expired): nothing to say.
      return json({ skipped: 'no decision' });
    }
    data = { type: event };
  } else {
    if (!sightingId) return json({ error: 'about_sighting_id required' }, 400);
    const { data: s, error } = await admin
      .from('sightings')
      .select('id, title, status')
      .eq('id', sightingId)
      .single();
    if (error || !s) return json({ error: 'Sighting not found' }, 404);
    const name = ((s.title as string | null) ?? '').trim();
    const cat = name ? `"${name}"` : 'the cat';

    if (event === 'adoption_approved') {
      title = '🏠 Your adoption was approved!';
      message = `${name ? cat : 'Your cat'} is going home with you. Open Guardians to arrange the handover.`;
    } else if (event === 'adoption_declined') {
      title = 'Update on your adoption request';
      message =
        s.status === 'adopted'
          ? `${name ? cat : 'The cat'} found a home with another family. Other cats are still waiting.`
          : `Your request for ${cat} was not accepted this time.`;
    } else {
      // new_comment — never the comment text: it may be hidden by moderation.
      title = '💬 New comment';
      message = name
        ? `Someone commented on ${cat}.`
        : "Someone commented on a cat you're helping.";
    }
    data = { sighting_id: s.id, type: event };
  }

  const tokens = await recipientTokens(admin, recipientId);
  if (tokens === null) return json({ error: 'Could not load recipient tokens' }, 500);
  if (tokens.length === 0) return json({ sent: 0 });

  const messages: ExpoMessage[] = tokens.map((to) => ({
    to,
    title,
    body: message,
    sound: 'default',
    priority: event === 'new_comment' ? 'default' : 'high',
    channelId: 'urgent',
    data,
  }));

  const { sent, failed, deadTokens } = await sendToExpo(messages);
  const reaped = await reapDeadTokens(admin, deadTokens);
  return json({ sent, failed, reaped });
}

/**
 * One person's deliverable tokens, with the same opt-in semantics tokens_near
 * enforces (urgent_opt_in) plus the push_enabled master flag (0029). Null when
 * the lookup failed.
 */
async function recipientTokens(admin: any, recipientId: string): Promise<string[] | null> {
  const { data: tokenRows, error } = await admin
    .from('device_push_tokens')
    .select('token')
    .eq('user_id', recipientId)
    .eq('push_enabled', true)
    .eq('urgent_opt_in', true);
  if (error) {
    console.error('[send-push] load recipient tokens failed:', error.message);
    return null;
  }
  return (tokenRows ?? []).map((r: { token: string }) => r.token);
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
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
