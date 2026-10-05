# Release preparation evidence — 2026-10-05

This records local preparation and a read-only check of the backend selected by
local `.env`. The EAS production environment, store accounts, and hosted schema
were not verified or changed. No release build, deployment, or submission was
performed. No support URL has been selected by the owner.

## Checks

- App TypeScript: passed.
- Release configuration regression suite: 5 tests passed.
- ESLint for changed release guard/test: passed after importing Node Buffer explicitly.
- Prettier for changed JS/TS/JSON/Markdown: passed.
- Shell syntax and git whitespace checks: passed.
- Android release configuration with local `.env`: blocked on
  `EXPO_PUBLIC_SUPPORT_URL` and `EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_KEY`.
- Read-only Supabase auth settings: email enabled, signup enabled, Google/Apple
  disabled, email confirmation not required. This endpoint does not establish
  SMTP delivery, allowlists, provider credential validity, or real authentication.

## Implemented preparation

Production web export now enforces web configuration and clears Metro cache.
Release guards reject known smoke-test backends/keys, known privileged Supabase
keys, nonproduction URLs, invalid platforms, and incomplete enabled Sentry
configuration. These checks do not validate JWT signatures, network reachability,
or cloud authorization. Preflight no longer claims a complete production release
on local success, and does not describe broad media permission as required.
Android/OAuth guidance was refreshed for SDK 57 and environment-aware operations.
The complete deployment prompt is in SECURE_DEPLOY_PROMPT.md.

## Outstanding release evidence

Select and verify the real support/deletion contact and owned HTTPS origin.
Configure and verify Maps restrictions and production cloud variables. Review
hosted migration history and required function deployments; preserve send-push
before migration 0038 ordering. Verify SMTP, confirmation/recovery and all intended
auth providers. Complete signing/store access, backups/recovery, monitoring,
moderation ownership, release-binary builds and physical-device acceptance.
Verify web deployment and each store distribution stage before public rollout.

The complete CI/database/browser/native export suite was not rerun during this
focused preparation; rerun it for the final release candidate. Passing these
focused checks is not evidence that the app is publicly live or fully secure.
