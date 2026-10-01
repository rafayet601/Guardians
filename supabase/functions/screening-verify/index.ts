// Supabase Edge Function: screening-verify (Deno runtime)
// -----------------------------------------------------------------------------
// Starts ID verification for the caller's adopter screening.
//
// Provider abstraction behind the ID_PROVIDER env var:
//   manual (default, v1) — ID docs uploaded to the private `screening-docs`
//     bucket are queued for moderator review via review_adopter_screening().
//     This function just records the session start and returns next steps.
//   veriff | onfido (future) — not integrated yet. Always fall back to
//     manual review, even when a provider secret has been configured.
//
// Auth mirrors ai-adoption-copy/delete-account: POST-only; 401 without an
// Authorization header; caller identified from their session JWT.
//
// Deploy (human, with explicit authorization):
//   supabase functions deploy screening-verify
//
// This file is Deno, not part of the React Native app (excluded in tsconfig).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

import { corsHeaders, preflight } from '../_shared/http.ts';

Deno.serve(async (req: Request) => {
  const options = preflight(req);
  if (options) return options;
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader) return json({ error: 'Unauthorized' }, 401);

  const url = Deno.env.get('SUPABASE_URL')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const provider = (Deno.env.get('ID_PROVIDER') ?? 'manual').toLowerCase();

  const caller = createClient(url, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const {
    data: { user },
  } = await caller.auth.getUser();
  if (!user) return json({ error: 'Unauthorized' }, 401);

  let body: { id_doc_paths?: string[] } = {};
  try {
    body = (await req.json()) as { id_doc_paths?: string[] };
  } catch {
    body = {};
  }
  const docPaths = Array.isArray(body.id_doc_paths) ? body.id_doc_paths.slice(0, 4) : [];

  // Service role: read + stamp the verification session. PII never leaves the
  // DB here — only the session marker is written.
  const admin = createClient(url, serviceKey);
  const { data: screening, error: readErr } = await admin
    .from('adopter_screenings')
    .select('id, status, id_status')
    .eq('user_id', user.id)
    .maybeSingle();
  if (readErr) {
    console.error('[screening-verify] read failed:', readErr.message);
    return json({ error: 'Could not load screening' }, 500);
  }
  if (!screening) return json({ error: 'Submit your background check first' }, 409);

  const sessionId = `sess_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;

  // A secret alone cannot create a hosted verification session. Do not record
  // a provider session or send applicants into a flow that does not exist.
  // Once integrated, a provider branch must create a real session and return
  // its URL before bypassing the working manual-review path below.
  if (provider !== 'manual') {
    console.warn(`[screening-verify] ${provider} is not integrated — manual fallback`);
  }

  const { error: updErr } = await admin
    .from('adopter_screenings')
    .update({
      id_provider: 'manual',
      id_session_id: sessionId,
      id_status: 'pending',
      id_doc_paths: docPaths,
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', user.id);
  if (updErr) {
    console.error('[screening-verify] manual stamp failed:', updErr.message);
    return json({ error: 'Could not start verification' }, 500);
  }

  return json({
    provider: 'manual',
    status: 'pending',
    session_id: sessionId,
    message:
      'Your ID documents were received. Our team will review them — we will notify you once your background check clears.',
  });
});

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
