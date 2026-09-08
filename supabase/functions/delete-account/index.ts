// Supabase Edge Function: delete-account (Deno runtime)
// -----------------------------------------------------------------------------
// Permanently deletes the calling user's account. Identifies the caller from
// their JWT, then uses the service role to delete the auth.users row — which
// cascades to public.profiles; community records may retain anonymized rows. This
// powers the App Store / Play "in-app account deletion" requirement.
//
// Storage objects must be removed first: Auth refuses to delete their owner.
import { deleteUserUploads } from '../_shared/deleteUserUploads.ts';
import { corsHeaders, preflight } from '../_shared/http.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

Deno.serve(async (req: Request) => {
  const options = preflight(req);
  if (options) return options;
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader) return json({ error: 'Unauthorized' }, 401);

  const url = Deno.env.get('SUPABASE_URL')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  const caller = createClient(url, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const {
    data: { user },
  } = await caller.auth.getUser();
  if (!user) return json({ error: 'Unauthorized' }, 401);

  const admin = createClient(url, serviceKey);
  try {
    await deleteUserUploads(admin, user.id);
  } catch (error) {
    console.error('[delete-account] storage cleanup failed:', error);
    return json({ error: 'Unable to remove uploads. Please retry account deletion.' }, 500);
  }
  const { error } = await admin.auth.admin.deleteUser(user.id);
  if (error) {
    console.error('[delete-account] failed:', error.message);
    return json({ error: 'Unable to delete account. Please retry.' }, 500);
  }

  return json({ deleted: true });
});

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
