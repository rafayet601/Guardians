// Read-only: checks public Auth settings without printing keys or making account changes.
const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const key = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
if (!url || !key) {
  console.error('Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY.');
  process.exitCode = 1;
} else {
  try {
    const response = await fetch(`${url}/auth/v1/settings`, {
      headers: { apikey: key },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`Auth settings returned HTTP ${response.status}.`);
    const settings = await response.json();
    console.log(
      JSON.stringify(
        {
          googleEnabled: settings.external?.google === true,
          appleEnabled: settings.external?.apple === true,
          emailEnabled: settings.external?.email === true,
          signupsDisabled: settings.disable_signup === true,
          emailConfirmationRequired: settings.mailer_autoconfirm === false,
          note: 'Redirect allowlists, provider secrets, SMTP delivery, and real sign-in are not verified by this endpoint.',
        },
        null,
        2,
      ),
    );
  } catch {
    console.error('Could not read authentication settings. Check configuration and connectivity.');
    process.exitCode = 1;
  }
}
