# Production release

The app uses Expo SDK 57 / React Native 0.86.3. See
[the verified review](PRODUCTION_REVIEW.md) for the changes and test evidence.

See [the deployment runbook](DEPLOY.md) for hosting and auth setup. Its historical
backend snapshot must be rechecked before deploying; do not blindly run `db push`
against the timestamped production migration history.

## Before a production build

1. Create the business support/deletion page and set `EXPO_PUBLIC_SUPPORT_URL`.
   The owner plans to create this later. Production builds intentionally fail
   until it is configured; no contact address has been invented.
2. Configure the production EAS environment using `.env.example`: Supabase public
   URL/key, EAS project UUID, restricted Android Maps key, and optional iOS Maps
   key/Sentry configuration. Never put a service-role or AI key in a public var.
3. Run `npm run release:check -- android` (or `ios` / `web`) with that environment.
   The same checks run automatically for the EAS production build profile.
4. Apply migrations through `0035_screening_evidence_reset.sql` to staging, then production
   after validating them. Redeploy the Edge Functions. Existing push registrations
   are disabled by 0034 until users explicitly opt in again using the updated app.
5. Configure Supabase SMTP, email confirmation, native/web auth redirect URLs,
   backup recovery, push webhook secret/configuration, and moderation staffing.
   Verify APNs/FCM credentials and restrict Maps keys to the registered apps.
6. Publish and verify `/privacy` and `/terms` without signing in; complete store
   disclosures based on actual enabled features and processor agreements.
7. Verify on physical release builds: signup/confirmation/reset, photo report,
   map/claim/rescue/adopt, flag/block, rewards, push permission denial/opt-in/out,
   account switching, notification cold launch, and account deletion with uploads.

## Build and submit

Use the configured EAS project and store accounts. Build the production profile,
exercise the resulting release builds, then submit to internal testing before a
public rollout. Store signing, billing, public deployment and submission have not
been performed by this code change.

OTA updates use the fingerprint runtime policy: SDK/native dependency changes
require a new binary and cannot accidentally reach an incompatible installed app.
The development profile now has the required `expo-dev-client` dependency.

## Automated checks

`npm ci` applies the documented query-string/decoder compatibility patch. CI runs
TypeScript, ESLint, Prettier, Jest, dependency audit, native/web Metro exports,
Playwright browser smoke tests, Deno checks/tests and the pgTAP database suite.
See `scripts/patch-query-string.cjs`; remove the patch when Expo Router upgrades
its CommonJS query-string dependency to support the patched ESM decoder itself.

## Additional release checks

Follow [OAuth readiness](docs/release/OAUTH_READINESS.md) for provider activation,
[Android release steps](docs/release/ANDROID_RELEASE_RUNBOOK.md) for Play testing,
and verify adopter screening before enabling adoption.
