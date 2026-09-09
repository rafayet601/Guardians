# Production readiness changes

Base reviewed: `dbce2fa0fc831a1afb9a0070dca958740bd9c60a` on `main`.

## Resolved code issues

- Isolate cached private data across auth identities, reject a stale startup
  session, and surface sign-out failures.
- Scope push consent and primers per account. Serialize registration/opt-out,
  cancel stale registration, detach the device before sign-out, and enforce one
  owner per token in Postgres. Legacy registrations require renewed opt-in.
- Create the Android notification channel before requesting permission; handle
  notification cold launches and show permission/registration failure honestly.
- Remove uploaded photos before Auth deletion. Migration 0033 removes authored
  reports/comments/photos, derived embeddings and linked usage records in the
  account-deletion transaction. Storage/API failure leaves deletion retryable.
- Handle CORS preflight and responses in all 13 Edge Functions while preserving
  their existing authentication/authorization.
- Keep privacy/terms publicly accessible. Correct coordinate access, provider
  retention, moderation and erasure statements; wire a configurable support URL.
- Upgrade to patched Expo SDK 57 / React Native 0.86.3 for the known SDK 56 Hermes
  memory regression. Match native/test dependencies and supply the dev client.
- Apply compatible security updates plus scoped xcode/uuid and
  query-string/decoder overrides. The decoder needs a small deterministic
  CommonJS/ESM bridge, applied on install and covered by a malformed-input test.
- Normalize uploads to JPEG, bound photo size to 1600 pixels (avatars 512), and
  compress before upload. Missing photos use a local neutral illustration rather
  than misleading random photographs from an external service.
- Import only used font weights. Avoid settings drafts being overwritten by
  background refetch, add feed/profile recovery, accessible input labels, and
  remove unnecessary Android broad photo/audio permissions.
- Fail production builds with missing required configuration; use explicit EAS
  environments and fingerprint-compatible OTA runtimes.
- Extend CI with all-platform bundling, dependency audit, browser smoke tests,
  Edge Function regression tests and account-isolation/erasure database tests.

## Validation

- Clean lockfile install and dependency audit: no known vulnerabilities.
- 79 Jest tests and 3 Deno regression tests pass.
- All 33 migrations replay successfully; 126 pgTAP tests pass on a fresh database.
- 3 Playwright mobile browser tests pass; privacy-page screenshot reviewed.
- App/test TypeScript, ESLint, Prettier and all 13 Edge Function checks pass.
- Expo Doctor: 21/21 checks pass; iOS/Android native prebuild succeeds.
- Web/iOS/Android production bundle exports succeed. Native binaries have not
  been compiled or exercised on physical devices. Leaflet emits warnings for its
  unused default marker/layer-control image URLs; this app renders custom pins.

## Remaining owner release actions

The business support contact will be created later, per the owner. Add its HTTPS
URL to the production environment; the production configuration check remains
intentionally blocked until then. Follow [PRODUCTION.md](PRODUCTION.md) for hosted
backend configuration/deployment, store credentials, disclosures and physical
release-build acceptance. These cannot be inferred from a passing source check.
No production backend migration or app-store submission is part of this commit.

Account deletion removes active data; provider/backups retention follows the
applicable policies. Storage cleanup and Auth deletion are separate operations:
if Auth fails after cleanup the account remains retryable without its removed
photos. Community records authored by others can retain a null account reference.

## References

- [Expo SDK 57 fixes](https://expo.dev/changelog/sdk-57)
- [Supabase user deletion](https://supabase.com/docs/guides/auth/managing-user-data#deleting-users)
- [Supabase CORS](https://supabase.com/docs/guides/functions/cors)
- [Anthropic retention](https://privacy.claude.com/en/articles/7996866-how-long-do-you-store-my-organization-s-data)
- [Voyage data handling](https://docs.voyageai.com/docs/faq)
