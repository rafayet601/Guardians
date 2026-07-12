// Supabase Edge Function: ai-health (Deno runtime)
// -----------------------------------------------------------------------------
// Inert, JWT-guarded AI scaffold — the AI-M0 "inert callable edge function"
// exit criterion. It proves the end-to-end plumbing (auth pattern + shared
// Anthropic helper + secret wiring) WITHOUT ever calling the model: it only
// reports whether ANTHROPIC_API_KEY is configured. Later ai-* functions copy
// this shape and add real model calls behind the same JWT guard.
//
// Auth mirrors send-push/delete-account exactly: identify the caller from their
// session JWT via an anon-key client; 401 if there is no valid session. No
// service-role client is needed here — this endpoint reads no privileged data.
//
// Deploy (human, with explicit authorization):
//   supabase functions deploy ai-health
//   supabase secrets set ANTHROPIC_API_KEY=sk-ant-...   (optional for this fn)
// This file is Deno, not part of the React Native app (excluded in tsconfig).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { isAnthropicConfigured } from '../_shared/anthropic.ts';

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader) return json({ error: 'Unauthorized' }, 401);

  const url = Deno.env.get('SUPABASE_URL')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;

  // Identify the caller from their session JWT.
  const caller = createClient(url, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const {
    data: { user },
  } = await caller.auth.getUser();
  if (!user) return json({ error: 'Unauthorized' }, 401);

  // Inert: report readiness only. NEVER call the model when the key is absent
  // (and this scaffold never calls it at all).
  return json({ ok: true, aiConfigured: isAnthropicConfigured() });
});

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
