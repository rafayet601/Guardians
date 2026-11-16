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
import { safeErrorDetails } from '../_shared/diagnostics.ts';
import { corsHeaders, preflight, readJsonObject, RequestBodyError } from '../_shared/http.ts';
import { hasWebhookSecret } from '../_shared/webhook.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

import { optedInPushTokens, sendExpoPush } from '../_shared/expoPush.ts';
import {
  BASE_RADIUS_M,
  CASE_EVENTS,
  type CaseEvent,
  caseEventCopy,
  OPS_JOB_FAILED_COPY,
  RING_RADIUS_M,
  urgentCopy,
  urgentStep,
} from '../_shared/pushCopy.ts';

type PushType = 'urgent_sighting' | 'sighting_claimed' | 'rescue_completed' | 'adoption_interest';
const LIFECYCLE_TYPES: readonly PushType[] = [
  'sighting_claimed',
  'rescue_completed',
  'adoption_interest',
];

// 0038 events, then the lease and escalation events of 0042.
type PushEvent =
  | 'screening_decided'
  | 'adoption_approved'
  | 'adoption_declined'
  | 'new_comment'
  | 'ops_job_failed'
  | CaseEvent;
const PUSH_EVENTS: readonly PushEvent[] = [
  'screening_decided',
  'adoption_approved',
  'adoption_declined',
  'new_comment',
  'ops_job_failed',
  ...CASE_EVENTS,
];

interface SightingRow {
  id: string;
  reporter_id: string | null;
  lat: number;
  lng: number;
  needs_urgent_help: boolean;
  title: string | null;
  status: string;
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
    escalation_step?: unknown;
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
    .select('id, reporter_id, lat, lng, needs_urgent_help, title, status')
    .eq('id', body.sighting_id)
    .single();
  if (sErr || !s) return json({ error: 'Sighting not found' }, 404);

  if (type === 'urgent_sighting') {
    const step = urgentStep(body.escalation_step);
    if (step === null) return json({ error: 'Unknown escalation_step' }, 400);
    if (!s.needs_urgent_help) return json({ skipped: 'not urgent' });
    // The ladder (0042) queues these minutes after the report; never broadcast
    // for a cat someone has claimed in the meantime.
    if (s.status !== 'spotted') return json({ skipped: 'no longer open' });
    return urgentGeoFanout(admin, s as SightingRow, step);
  }

  if (!body.recipient_user_id) return json({ error: 'recipient_user_id required' }, 400);
  return lifecyclePush(admin, type, s as SightingRow, body.recipient_user_id);
});

// ── Send paths ────────────────────────────────────────────────────────────────
// The supabase-js clients below are created without a Database generic (the
// edge runtime has no generated schema types), so helper params are typed as
// `any` for the client — mirrors ai-lost-match/ai-reid.

/**
 * Urgent geo fan-out. Step 1: tokens_near resolves the opted-in audience near
 * the sighting, excluding the reporter. Step 2 (0042): tokens_in_ring reaches
 * the devices beyond that audience, as far as each device allows.
 */
async function urgentGeoFanout(admin: any, s: SightingRow, step: 1 | 2): Promise<Response> {
  const { data: rows, error: tErr } =
    step === 1
      ? await admin.rpc('tokens_near', {
          p_lat: s.lat,
          p_lng: s.lng,
          p_radius_m: BASE_RADIUS_M,
          p_exclude_user: s.reporter_id,
        })
      : await admin.rpc('tokens_in_ring', {
          p_lat: s.lat,
          p_lng: s.lng,
          p_inner_m: BASE_RADIUS_M,
          p_outer_m: RING_RADIUS_M,
          p_exclude_user: s.reporter_id,
        });
  if (tErr) {
    console.error('[send-push] urgent audience lookup failed:', safeErrorDetails(tErr));
    return json({ error: 'Unable to load push recipients' }, 500);
  }

  const tokens: string[] = (rows ?? []).map((r: { token: string }) => r.token);
  if (tokens.length === 0) return json({ sent: 0 });

  const { title, body: message } = urgentCopy(step, s.title);
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
      console.error('[send-push] load screening failed:', safeErrorDetails(error));
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
  } else if (event === 'ops_job_failed') {
    ({ title, body: message } = OPS_JOB_FAILED_COPY);
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

    if ((CASE_EVENTS as readonly string[]).includes(event)) {
      // Lease and escalation events (0042): worded from the case as it is now.
      const copy = caseEventCopy(event as CaseEvent, s.title as string | null, s.status as string);
      if (!copy) return json({ skipped: 'no longer applies' });
      ({ title, body: message } = copy);
    } else if (event === 'adoption_approved') {
      title = '🏠 Your adoption was approved!';
      message = `${
        name ? cat : 'Your cat'
      } is going home with you. Open Guardians to arrange the handover.`;
    } else if (event === 'adoption_declined') {
      title = 'Update on your adoption request';
      message =
        s.status === 'adopted'
          ? `${
              name ? cat : 'The cat'
            } found a home with another family. Other cats are still waiting.`
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
  return await optedInPushTokens(admin, recipientId);
}

// `sent` counts Expo ticket acceptance; device delivery requires receipt checks.
const sendToExpo = sendExpoPush;

/**
 * Reap dead tokens so device_push_tokens doesn't accumulate cruft and degrade
 * deliverability over time. Returns the number reaped (0 on failure).
 */
async function reapDeadTokens(admin: any, deadTokens: string[]): Promise<number> {
  if (deadTokens.length === 0) return 0;
  const { error: delErr } = await admin.from('device_push_tokens').delete().in('token', deadTokens);
  if (delErr) {
    console.error('[send-push] failed to reap dead tokens:', safeErrorDetails(delErr));
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
