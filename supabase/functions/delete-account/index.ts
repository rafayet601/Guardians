// Supabase Edge Function: delete-account (Deno runtime)
// -----------------------------------------------------------------------------
// Permanently deletes the calling user's account. Identifies the caller from
// their JWT, then uses the service role to delete the auth.users row — which
// cascades to public.profiles and all child rows (ON DELETE CASCADE). This
// powers the App Store / Play "in-app account deletion" requirement.
//
// Note: storage objects under the user's folder (avatars/cat-photos) are not
// FK-linked, so a follow-up storage sweep is recommended for full erasure.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

Deno.serve(async (req: Request) => {
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
  const { error } = await admin.auth.admin.deleteUser(user.id);
  if (error) {
    console.error('[delete-account] failed:', error.message);
    return json({ error: error.message }, 500);
  }

  return json({ deleted: true });
});

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
