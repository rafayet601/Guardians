// Supabase Edge Function: send-push (Deno runtime)
// -----------------------------------------------------------------------------
// Fans out an Expo push notification to opted-in users whose coarse "home area"
// is near an URGENT sighting. Invoked by the authenticated client right after it
// creates an urgent report (see src/api/push.ts -> notifyUrgentSighting). The
// caller's JWT identifies the reporter; the service role is used only here to
// read push tokens (never exposed to clients). Expo's push service is free.
//
// Deploy:
//   supabase functions deploy send-push
//   supabase secrets set SUPABASE_SERVICE_ROLE_KEY=... SUPABASE_ANON_KEY=...
//   (SUPABASE_URL is provided automatically.)
// This file is Deno, not part of the React Native app (excluded in tsconfig).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const RADIUS_M = 8000;

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader) return json({ error: 'Unauthorized' }, 401);

  const url = Deno.env.get('SUPABASE_URL')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  // Identify the caller from their session JWT.
  const caller = createClient(url, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const {
    data: { user },
  } = await caller.auth.getUser();
  if (!user) return json({ error: 'Unauthorized' }, 401);

  let body: { sighting_id?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Bad JSON' }, 400);
  }
  if (!body.sighting_id) return json({ error: 'sighting_id required' }, 400);

  const admin = createClient(url, serviceKey);

  const { data: s, error: sErr } = await admin
    .from('sightings')
    .select('id, reporter_id, lat, lng, needs_urgent_help, title')
    .eq('id', body.sighting_id)
    .single();
  if (sErr || !s) return json({ error: 'Sighting not found' }, 404);
  if (!s.needs_urgent_help) return json({ skipped: 'not urgent' });
  if (s.reporter_id !== user.id) return json({ error: 'Forbidden' }, 403);

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

  let sent = 0;
  let failed = 0;
  const deadTokens: string[] = [];

  for (let i = 0; i < tokens.length; i += 100) {
    const chunkTokens = tokens.slice(i, i + 100);
    const messages = chunkTokens.map((to) => ({
      to,
      title,
      body: message,
      sound: 'default',
      priority: 'high',
      channelId: 'urgent',
      data: { sighting_id: s.id, type: 'urgent_sighting' },
    }));

    let resp: Response;
    try {
      resp = await fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(messages),
      });
    } catch (e) {
      failed += chunkTokens.length;
      console.error('[send-push] Expo request threw:', e);
      continue;
    }

    if (!resp.ok) {
      failed += chunkTokens.length;
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
      sent += chunkTokens.length; // no ticket detail (older response shape)
      continue;
    }
    tickets.forEach((ticket, j) => {
      if (ticket.status === 'ok') {
        sent += 1;
        return;
      }
      failed += 1;
      console.error('[send-push] ticket error:', ticket.message ?? ticket.details?.error);
      if (ticket.details?.error === 'DeviceNotRegistered') deadTokens.push(chunkTokens[j]);
    });
  }

  // Reap dead tokens so device_push_tokens doesn't accumulate cruft and degrade
  // deliverability over time.
  let reaped = 0;
  if (deadTokens.length > 0) {
    const { error: delErr } = await admin
      .from('device_push_tokens')
      .delete()
      .in('token', deadTokens);
    if (delErr) console.error('[send-push] failed to reap dead tokens:', delErr.message);
    else reaped = deadTokens.length;
  }

  return json({ sent, failed, reaped });
});

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
