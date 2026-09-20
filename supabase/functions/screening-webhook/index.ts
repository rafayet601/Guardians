// Supabase Edge Function: screening-webhook (Deno runtime)
// -----------------------------------------------------------------------------
// Receives ID-verification callbacks from the provider (Phase 2: Veriff/Onfido)
// and stamps the applicant's screening. Manual reviews (v1) go through the
// review_adopter_screening() RPC instead — this endpoint exists so the provider
// wiring has a stable target.
//
// Auth mirrors send-push's server-to-server path: verify_jwt is OFF (see
// supabase/config.toml) because providers carry no Supabase JWT. Every request
// must present the shared secret in `x-screening-webhook-secret`, which MUST
// equal the SCREENING_WEBHOOK_SECRET edge secret.
//
// Promotion rule: a verified ID promotes a *questionnaire-passed* screening
// (status pending) to approved with a 12-month expiry. needs_review/rejected
// rows keep their status — a moderator still decides those.
//
// Deploy (human, with explicit authorization):
//   supabase functions deploy screening-webhook
//   supabase secrets set SCREENING_WEBHOOK_SECRET=<random> \
//     SUPABASE_SERVICE_ROLE_KEY=... SUPABASE_ANON_KEY=...
//
// This file is Deno, not part of the React Native app (excluded in tsconfig).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const secret = Deno.env.get('SCREENING_WEBHOOK_SECRET') ?? '';
  const presented = req.headers.get('x-screening-webhook-secret') ?? '';
  if (!secret || presented !== secret) return json({ error: 'Unauthorized' }, 401);

  let body: {
    user_id?: string;
    id_status?: string;
    id_session_id?: string;
    reason?: string;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }
  if (!body.id_session_id) return json({ error: 'id_session_id required' }, 400);
  if (!body.user_id) return json({ error: 'user_id required' }, 400);
  if (body.id_status !== 'verified' && body.id_status !== 'failed') {
    return json({ error: 'id_status must be verified or failed' }, 400);
  }

  const url = Deno.env.get('SUPABASE_URL')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const admin = createClient(url, serviceKey);

  const { data: screening, error: readErr } = await admin
    .from('adopter_screenings')
    .select('id, status, id_status, reasons, id_session_id')
    .eq('user_id', body.user_id)
    .maybeSingle();
  if (readErr) {
    console.error('[screening-webhook] read failed:', readErr.message);
    return json({ error: 'Lookup failed' }, 500);
  }
  if (!screening) return json({ error: 'No screening for user' }, 404);

  // Evidence changes invalidate the previous session. Never accept an unbound
  // callback or let a delayed provider response approve a new application.
  if (!screening.id_session_id || screening.id_session_id !== body.id_session_id) {
    return json({ error: 'Session mismatch' }, 403);
  }

  const patch: Record<string, unknown> = {
    id_status: body.id_status,
    updated_at: new Date().toISOString(),
  };
  if (body.id_status === 'verified') {
    patch['verified_at'] = new Date().toISOString();
    if (screening.status === 'pending') {
      // Questionnaire passed and ID now verified → cleared for 12 months.
      patch['status'] = 'approved';
      const exp = new Date();
      exp.setMonth(exp.getMonth() + 12);
      patch['expires_at'] = exp.toISOString();
    }
  } else {
    if (screening.status === 'pending') patch['status'] = 'needs_review';
    if (body.reason) patch['reasons'] = [...(screening.reasons ?? []), body.reason];
  }

  const { data: updated, error: updErr } = await admin
    .from('adopter_screenings')
    .update(patch)
    .eq('user_id', body.user_id)
    .eq('id_session_id', body.id_session_id)
    .eq('status', screening.status)
    .eq('id_status', screening.id_status)
    .select('id');
  if (updErr) {
    console.error('[screening-webhook] update failed:', updErr.message);
    return json({ error: 'Update failed' }, 500);
  }

  if (!updated?.length)
    return json({ error: 'Screening changed; retry with the current session' }, 409);
  return json({ ok: true });
});

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
