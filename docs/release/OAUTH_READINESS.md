# Authentication and OAuth readiness

## Verified 2026-09-16

Read-only request to the linked project's `/auth/v1/settings` returned:

| Setting            | Live value                               |
| ------------------ | ---------------------------------------- |
| Google             | Disabled                                 |
| Apple              | Disabled                                 |
| Email login        | Enabled                                  |
| New signups        | Enabled                                  |
| Email confirmation | Not required (`mailer_autoconfirm=true`) |

No provider configuration or production user data was changed. Public settings do not expose the redirect allowlist, credential validity, SMTP configuration, or consent-screen publishing status. No real Google/Apple login has been completed; provider rollout is blocked on external configuration.

Run `npm run auth:status` to refresh these public settings using local `.env`. It never prints keys. For an environment that already supplies variables, use `node scripts/check-auth-settings.mjs`.

## Implemented

- Google/Apple buttons on sign-in and signup appear only when the linked backend advertises that provider as enabled. Failed discovery has retry and email fallback.
- Supabase PKCE code exchange with one active initiation per runtime. Web uses a same-tab redirect; native uses the OS authentication browser through `expo-web-browser`.
- Public `/oauth-callback` route survives the auth guard, waits for its URL, handles success/failure, and removes auth parameters from web history.
- Native callbacks must match the expected scheme, host, and path. Expo Go social auth is rejected with an explanation; use an installed development/production build.
- Email confirmation and recovery wait for their initial link, reject wrong-purpose credentials, handle retries, and do not turn an invalid reset link into success because an unrelated session exists.
- Shared callback handling validates OTP types and rejects duplicate/ambiguous credentials and provider errors. Concurrent PKCE callbacks share an exchange; bounded successful replay cache checks the current user.
- Sign-in provides confirmation-email resend. Existing account-cache isolation, secure native storage, and lifecycle refresh remain in place.

## External setup required before release

1. Select the final HTTPS web origin and set it as the Supabase Auth Site URL. Keep development origins in a staging project where possible.
2. In Supabase Auth URL Configuration allow the exact deployed callbacks:
   - `https://<production-origin>/oauth-callback`
   - `https://<production-origin>/confirm`
   - `https://<production-origin>/reset`
   - `guardians://oauth-callback`
   - `guardians://confirm`
   - `guardians://reset`
     For local web testing allow the corresponding `http://localhost:8082/...` paths in the test project. Confirm generated native URLs from the actual build. Use exact production URLs, not a broad wildcard. Configure SPA fallback so direct callback loads work.
3. For Google create/configure a web OAuth client for this browser-based flow. Use the Supabase callback shown in its provider dashboard (`https://<project-ref>.supabase.co/auth/v1/callback`) as the provider's authorized redirect, and configure the consent screen and required production publishing/verification. Store its client ID/secret in Supabase's Google provider settings, never `EXPO_PUBLIC_*` variables.
4. For Apple configure the Services ID and provider credentials with the same Supabase callback. This implementation uses browser OAuth, including on native; it does not implement the native Apple identity-token SDK. Maintain Apple's OAuth client-secret rotation before expiry. A user's full name may be absent; the existing profile/settings flow supports editing it.
5. Enable email confirmation and configure/test an SMTP sender before opening general signup. Do this after confirming redirect URLs and real delivery, so users are not locked out of activation.
6. Build new native binaries including `expo-web-browser` and its config plugin; a JS-only OTA cannot add a missing native module.
7. PKCE links must finish in the browser/app where the request began because that installation stores the verifier. For email links opened elsewhere, use deliberately configured token-hash templates pointing to `/confirm?token_hash=...&type=signup` or `/reset?token_hash=...&type=recovery`, both supported by the callback handler. Test templates with real mail; do not silently fall back to an unrelated session.

## Acceptance checks

In staging, exercise both existing and new users with each enabled provider: successful web/native login, cancellation, denied consent, expired/replayed code, slow/offline callback, foreground and cold-start deep links, persistence/relaunch, logout then another account, and profile creation. Confirm returning social users do not require a username from the OAuth provider (the existing database trigger derives one). Check simultaneous signup behavior and provider-specific email/name omissions.

Test email signup/confirmation/resend/recovery with confirmation enabled, including cross-device behavior. Verify no codes, tokens, or full callback URLs enter logs/analytics. Use test users; automated unit mocks do not validate console configuration or real delivery.

The dependency installation also reported 27 dependency audit findings (15 moderate, 12 high). They were not automatically upgraded as part of auth changes; assess applicability and remediation before claiming the whole application is production-ready.

## Official references

- [Supabase native deep linking](https://supabase.com/docs/guides/auth/native-mobile-deep-linking)
- [Supabase redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls)
- [Google provider setup](https://supabase.com/docs/guides/auth/social-login/auth-google)
- [Apple provider setup and secret rotation](https://supabase.com/docs/guides/auth/social-login/auth-apple)
- [Expo SDK 56 browser authentication](https://docs.expo.dev/versions/v56.0.0/sdk/webbrowser/)
