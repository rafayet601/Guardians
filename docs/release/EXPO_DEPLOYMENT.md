# Guardians: Android, iOS, and web deployment

Run commands from a checkout of Guardians after `npm ci` (Node >=22.13).
`npm run eas -- ...` pins EAS CLI 24.8.0. SDK 57 and the existing app identifiers
`com.guardians.app` remain unchanged. Signing, account ownership, and hosted
environments must be verified before creating release artifacts.

## Connect the existing project

```sh
npm run eas -- login
npm run eas -- whoami
npm run eas -- project:info
```

The existing project ID is `f8a869e6-e03d-42f1-b84f-add62b4b23e4`. Confirm access
and owner; do not create a replacement project. If access is denied, use the
owning account or have its owner grant access.

## Configure environments

In the Expo dashboard, set these variables separately in `preview` and
`production` (and `development` for dev clients):

| Variable                              | Use                                                            |
| ------------------------------------- | -------------------------------------------------------------- |
| `EAS_PROJECT_ID`                      | Existing UUID above                                            |
| `EXPO_PUBLIC_SUPABASE_URL`            | HTTPS URL for the intended backend                             |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY`       | Supabase anon/publishable key only                             |
| `EXPO_PUBLIC_SUPPORT_URL`             | Real public HTTPS support page; owner still needs to create it |
| `EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_KEY` | Real Android-restricted Maps SDK key                           |
| `EXPO_PUBLIC_GOOGLE_MAPS_IOS_KEY`     | Optional: iOS otherwise uses Apple Maps                        |
| `EXPO_PUBLIC_AI_ENABLED`              | `false` until the backend AI provider is configured            |

These are client-readable variables: use plaintext or sensitive visibility,
not secret visibility. Every `EXPO_PUBLIC_` value is included in the client.
Never upload Supabase service-role/secret keys or AI provider keys to this list.
Optional Sentry client DSN/org/project can be configured; `SENTRY_AUTH_TOKEN`
must remain a secret and is only needed for build-time symbol uploads.

Production native builds enforce required values. Android additionally requires
a real Maps key restricted to `com.guardians.app` and the relevant signing
SHA-1. Play App Signing uses a different certificate from the EAS upload key;
include the Play signing certificate when distributing through Play.

## Configure native updates through EAS

```sh
npm run eas -- update:configure
```

Review the CLI changes and follow its instructions for dynamic `app.config.ts`.
Keep the existing `fingerprint` runtime policy and preview/production channels.
The verified update URL and `extra.eas.projectId` now use the same project ID,
with the linked UUID as the default. `EAS_PROJECT_ID` is configured in all three
EAS environments for production validation. Rebuild native apps after native
configuration changes.

## Android

```sh
# APK for direct installation
npm run build:preview:android
# AAB for Play internal testing, with preview environment/channel
npm run eas -- build --platform android --profile preview-playstore
# Store binary using production settings
npm run eas -- build --platform android --profile production
```

Use `npm run eas -- credentials --platform android` to inspect signing details.
For submission, create the app record in Google Play Console and configure the
Play service account with the needed permissions. The submission profile reads
`google-services-key.json` locally; it is gitignored. The first Play upload may
need to be performed manually in the console. Submit the exact validated build:

```sh
npm run eas -- submit --platform android --profile production --id BUILD_ID
```

The configured destination is the **internal** track. Store policies, disclosures,
account deletion URL, screenshots, and release access must be completed in Play.

## iOS

```sh
# Simulator dev client (does not require device provisioning)
npm run eas -- build --platform ios --profile development
# Physical-device dev client
npm run eas -- build --platform ios --profile development-device
# Release-mode simulator QA
npm run eas -- build --platform ios --profile preview-simulator
# TestFlight-compatible store build, preview environment/channel
npm run build:preview:ios
# Store build using production settings
npm run eas -- build --platform ios --profile production
```

TestFlight/device signing requires the Apple developer account and credentials.
Create/select the App Store Connect app matching `com.guardians.app`, then use:

```sh
npm run eas -- credentials --platform ios
npm run eas -- submit --platform ios --profile production --id BUILD_ID
```

The CLI prompts for the real Apple account/app ID; none is fabricated in config.
An internal/ad hoc `preview` build cannot be submitted to TestFlight. Check App
Store Connect processing, compliance, and tester access after submission.

## Web hosting

The app exports as a single-page web app and keeps its Supabase backend. Pull
the chosen environment **before** exporting: deployment environment flags cannot
change values already bundled into JavaScript.

```sh
npm run eas -- env:pull --environment production --path .env.production.local
npm run build:web:release
# Preview URL for reviewing the production-configured artifact
npm run eas -- deploy --environment production
# Promote only after review and approval
npm run eas -- deploy --environment production --prod
```

The release export fails before bundling when required production settings are
missing. `.env.production.local` and `dist` are gitignored. Check for stale `.env`
files or shell variables overriding the selected environment. Register the final
HTTPS origin and `/oauth-callback` in Supabase Auth redirect allowlists (and OAuth
provider settings where applicable). Test direct route reloads, sign-in, password
reset, map, report upload, and account deletion at the hosted URL.

## Updates after native QA

For a compatible JavaScript/asset change on tested binaries:

```sh
npm run eas -- update --channel preview --environment preview --platform all --message "Describe the change"
```

Validate the exact project, channel, environment, platform, and fingerprint on
installed builds. A production update requires explicit release approval; use
the corresponding production channel/environment only after validation. Native
module, permission, Maps-key, or SDK changes require a new native build.

## Launch verification

Run typecheck, lint, tests, and all-platform export checks. Then exercise signed
Android and iOS builds and the hosted web URL against the intended backend with
two accounts: sign-in/recovery, report → claim → rescue → adoption, permissions,
Maps, push, moderation, and deletion including uploaded files. Local exports do
not prove signing, store acceptance, live backend configuration, or device behavior.

Use the existing Expo plan while preparing releases; do not enable paid services
automatically. Check [Expo pricing](https://expo.dev/pricing) for current quotas.
Apple/Google developer memberships are separate from Expo hosting/build allowances.

References: [build profiles](https://docs.expo.dev/build/eas-json/),
[environments](https://docs.expo.dev/eas/environment-variables/),
[hosting](https://docs.expo.dev/eas/hosting/get-started/), and
[update setup](https://docs.expo.dev/eas-update/getting-started/).

## Setup verification: October 1, 2026

- Verified ownership/access to `@rivuquader/guardians` and its existing UUID.
- Configured `EAS_PROJECT_ID` in development, preview, and production; development
  now uses the existing preview Supabase public settings. Preview/production
  backend values were preserved.
- Completed `eas update:configure`; reviewed its generated channels so derived
  preview profiles all use `preview` and dev profiles use `development`.
- Validated build/submit profiles and inheritance using EAS CLI's schema, plus
  typecheck, lint, formatting, five release tests, and Android/iOS/web exports.
- Created a [web preview](https://guardians-rivuquader--2d1emc9wd9.expo.app)
  using the preview environment. Landing, legal, sign-in, registration,
  and password recovery pages loaded through direct URLs with no uncaught browser errors.
- Production release checks against the pulled cloud environment still require
  the public support URL for all platforms, and a restricted Android Maps key.
- Existing EAS history contains an older completed Android store build, version
  1.0.0 (build 2); it does not validate this setup or the current application.

No production hosting promotion, store submission, or OTA publication was performed.
Signed native builds, physical-device flows, email/OAuth redirects, push delivery,
and real backend workflows remain to be tested before public release.
