# Android Production Release Runbook & Verification Manual

**App Name:** Guardians  
**Package Identifier:** `com.guardians.app`  
**Target Platform:** Android (Google Play Store & Sideloadable Preview)  
**Framework:** Expo SDK 56 (New Architecture enabled) / React Native 0.85.3  
**Build System:** EAS Build (`eas.json`) & Dynamic Configuration (`app.config.ts`)  
**Document Purpose:** Definitive, step-by-step engineering runbook for running pre-flight quality gates, configuring EAS build-time secrets, managing Android signing keystores & Google Maps API restrictions, executing builds (APK and AAB), performing physical device verification, and submitting to Google Play Store tracks.

---

## Table of Contents

1. [Pre-Flight Automated Quality Gates](#1-pre-flight-automated-quality-gates)
2. [Environment Variables & EAS Secrets Matrix](#2-environment-variables--eas-secrets-matrix)
3. [Android Keystore & Dual SHA-1 Maps Restriction Guide](#3-android-keystore--dual-sha-1-maps-restriction-guide)
4. [Step-by-Step EAS Build Execution](#4-step-by-step-eas-build-execution)
5. [10-Point Android Physical Device Smoke Testing Checklist](#5-10-point-android-physical-device-smoke-testing-checklist)
6. [Google Play Console Submission Guide (EAS Submit)](#6-google-play-console-submission-guide-eas-submit)
7. [Post-Release Monitoring & Rollback Strategy](#7-post-release-monitoring--rollback-strategy)

---

## 1. Pre-Flight Automated Quality Gates

Before initiating any build or distributing binaries, all automated quality gates must pass with zero errors.

### 1.1 All-In-One Pre-Flight Command

Execute the consolidated pre-flight test runner:

```bash
npm run preflight
```

This automated runner (`scripts/preflight-check.sh`) performs:

1. TypeScript compilation for application code (`npm run typecheck`)
2. TypeScript compilation for test code (`npm run typecheck:test`)
3. Unit & contract test suite execution (`npm test`) — 7 suites, 102 tests
4. ESLint static code analysis (`npm run lint`)
5. Required production asset existence and non-zero size verification
6. `app.config.ts` and `eas.json` configuration integrity checks

### 1.2 Individual Quality Gate Commands

If debugging a specific failure, execute individual gates:

| Quality Gate        | Command                  | Expected Output                                   | Failure Action                                            |
| :------------------ | :----------------------- | :------------------------------------------------ | :-------------------------------------------------------- |
| **App Typecheck**   | `npm run typecheck`      | `tsc --noEmit` exits with `0` errors              | Fix TypeScript type definition errors in `src/` or `app/` |
| **Test Typecheck**  | `npm run typecheck:test` | `tsc -p tsconfig.test.json` exits with `0` errors | Fix test typing mismatches in `src/__tests__/`            |
| **Unit Test Suite** | `npm test`               | `7 passed, 7 total`, `102 passed, 102 total`      | Fix failing assertion or update test contract             |
| **CI Test Suite**   | `npm run test:ci`        | Fast sequential Jest run in single worker         | Investigate concurrency or race conditions                |
| **Linting**         | `npm run lint`           | `0 errors`                                        | Fix formatting/linting issues (`npm run format`)          |

### 1.3 Production Asset Validation

Verify all required branding and icon assets exist in `/assets`:

```bash
ls -la assets/android-icon-foreground.png \
       assets/android-icon-background.png \
       assets/android-icon-monochrome.png \
       assets/splash-icon.png \
       assets/icon.png \
       assets/favicon.png
```

- `android-icon-foreground.png`: 432×432px transparent adaptive icon foreground.
- `android-icon-background.png`: 432×432px solid teal (`#0E7C66`) background.
- `android-icon-monochrome.png`: 432×432px Material You themed icon for Android 13+.
- `splash-icon.png`: 180×180px branded splash screen logo.

---

## 2. Environment Variables & EAS Secrets Matrix

Guardians separates secrets into three distinct layers:

1. **Public Client Bundle (`EXPO_PUBLIC_*`)**: Inlined into JS bundle during Metro compilation.
2. **Build-Time EAS Secrets (Non-Public)**: Available during cloud compilation for sourcemap generation and native manifest injection.
3. **Backend Secrets (Supabase Secrets)**: Stored strictly in Supabase cloud for Edge Functions and database triggers; never bundled into mobile app binaries.

### 2.1 Complete Secrets & Environment Matrix

| Variable Name                         | Scope / Target     | Where Configured       | Purpose & Rationale                                                       |
| :------------------------------------ | :----------------- | :--------------------- | :------------------------------------------------------------------------ |
| `EXPO_PUBLIC_SUPABASE_URL`            | Client Bundle      | `.env` / EAS Secret    | Supabase API HTTPS URL (e.g. `https://xyz.supabase.co`)                   |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY`       | Client Bundle      | `.env` / EAS Secret    | Supabase publishable anonymous JWT (public, RLS protected)                |
| `EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_KEY` | Manifest & Client  | `.env` / EAS Secret    | Google Maps SDK Android API key (restricted by SHA-1 + package name)      |
| `EXPO_PUBLIC_GOOGLE_MAPS_IOS_KEY`     | InfoPlist & Client | `.env` / EAS Secret    | Google Maps SDK iOS API key (restricted by iOS bundle ID)                 |
| `EXPO_PUBLIC_SENTRY_DSN`              | Client Bundle      | `.env` / EAS Secret    | Sentry client DSN for crash diagnostics                                   |
| `EXPO_PUBLIC_AI_ENABLED`              | Client Bundle      | `.env` / EAS Secret    | Feature flag for client AI autofill (`"false"` or `"true"`)               |
| `SENTRY_ORG`                          | EAS Build Time     | EAS Secret / Env       | Sentry organization slug (for sourcemap upload)                           |
| `SENTRY_PROJECT`                      | EAS Build Time     | EAS Secret / Env       | Sentry project slug (for sourcemap upload)                                |
| `SENTRY_AUTH_TOKEN`                   | EAS Build Time     | EAS Secret ONLY        | Sentry authentication token for Hermes sourcemap/symbol upload            |
| `EAS_PROJECT_ID`                      | EAS Build Time     | `.env` / EAS Secret    | Expo Application Services project UUID                                    |
| `ANTHROPIC_API_KEY`                   | Backend Only       | Supabase Secrets       | Claude API key for AI photo analysis Edge Functions                       |
| `PUSH_WEBHOOK_SECRET`                 | Backend Only       | Supabase Secrets       | Shared secret between PostgreSQL DB trigger and `send-push` Edge Function |
| `SUPABASE_SERVICE_ROLE_KEY`           | Backend Only       | Supabase Auto-injected | Service role secret for `delete-account` Edge Function                    |

### 2.2 Provisioning EAS Secrets

Run the following commands to provision all required build secrets in EAS:

```bash
# Public client variables
eas secret:create --name EXPO_PUBLIC_SUPABASE_URL --value "https://tiqizsjxqfscwbhyvumk.supabase.co" --type string
eas secret:create --name EXPO_PUBLIC_SUPABASE_ANON_KEY --value "<YOUR_SUPABASE_ANON_KEY>" --type string
eas secret:create --name EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_KEY --value "<YOUR_GOOGLE_MAPS_ANDROID_KEY>" --type string
eas secret:create --name EXPO_PUBLIC_GOOGLE_MAPS_IOS_KEY --value "<YOUR_GOOGLE_MAPS_IOS_KEY>" --type string
eas secret:create --name EXPO_PUBLIC_SENTRY_DSN --value "<YOUR_SENTRY_DSN>" --type string
eas secret:create --name EXPO_PUBLIC_AI_ENABLED --value "false" --type string

# EAS & Sentry build secrets
eas secret:create --name EAS_PROJECT_ID --value "<YOUR_EAS_PROJECT_UUID>" --type string
eas secret:create --name SENTRY_ORG --value "guardians-rescue" --type string
eas secret:create --name SENTRY_PROJECT --value "guardians-app" --type string
eas secret:create --name SENTRY_AUTH_TOKEN --value "<YOUR_SENTRY_AUTH_TOKEN>" --type string
```

### 2.3 Provisioning Backend Supabase Secrets

```bash
supabase secrets set ANTHROPIC_API_KEY="<YOUR_ANTHROPIC_API_KEY>"
supabase secrets set PUSH_WEBHOOK_SECRET="<YOUR_PUSH_WEBHOOK_SECRET>"
```

### 2.4 Verifying Secrets

```bash
# Verify EAS secrets
eas secret:list

# Verify Supabase Edge Function secrets
supabase secrets list
```

---

## 3. Android Keystore & Dual SHA-1 Maps Restriction Guide

Google Maps SDK for Android requires API key restrictions based on Android package name (`com.guardians.app`) and SHA-1 certificate fingerprints.

### 3.1 The Dual SHA-1 Requirement

To prevent map loading failures across both direct preview installs and Google Play Store distributions, you **must register two SHA-1 fingerprints**:

1. **EAS Keystore SHA-1 (Upload Keystore)**: Signs Preview APKs and AAB bundles uploaded to Google Play.
2. **Google Play App Signing SHA-1 (Distribution Keystore)**: When users install the app from Google Play, Google strips the upload signature and re-signs the APK with Google's Play App Signing Key.

> ⚠️ **Critical Warning:** If you only register the EAS Keystore SHA-1, maps will work on preview APKs but will render as a **blank grey grid** for users installing from the Play Store!

### 3.2 Step 1: Retrieve EAS Android Keystore SHA-1

Run the EAS credentials manager:

```bash
eas credentials -p android
```

1. Select **Build Credentials**.
2. Select **Android Keystore**.
3. Locate and copy the **SHA-1 Fingerprint** (format: `XX:XX:XX:XX:XX:XX:XX:XX:XX:XX:XX:XX:XX:XX:XX:XX:XX:XX:XX:XX`).

Alternatively, view your credentials on the Expo web dashboard:
`https://expo.dev/accounts/[your-account]/projects/guardians/credentials/android`

### 3.3 Step 2: Retrieve Google Play App Signing SHA-1

1. Log in to the [Google Play Console](https://play.google.com/console).
2. Select the **Guardians** application.
3. In the left navigation menu, go to **Release** → **Setup** → **App integrity**.
4. Under the **App signing** tab, locate **App signing key certificate**.
5. Copy the **SHA-1 certificate fingerprint**.

### 3.4 Step 3: Configure Restrictions in Google Cloud Console

1. Navigate to the [Google Cloud Console Credentials Page](https://console.cloud.google.com/apis/credentials).
2. Select your project and click on the Android Maps API Key (`EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_KEY`).
3. Under **Set an application restriction**, select **Android apps**.
4. Click **+ Add an item**:
   - **Package name:** `com.guardians.app`
   - **SHA-1 certificate fingerprint:** Paste `<EAS_KEYSTORE_SHA1>`
5. Click **+ Add an item** again:
   - **Package name:** `com.guardians.app`
   - **SHA-1 certificate fingerprint:** Paste `<GOOGLE_PLAY_APP_SIGNING_SHA1>`
6. _(Optional for local debugging)_ Click **+ Add an item**:
   - **Package name:** `com.guardians.app`
   - **SHA-1 certificate fingerprint:** Paste local debug keystore SHA-1 (`keytool -list -v -keystore ~/.android/debug.keystore -alias androiddebugkey -storepass android -keypass android`)
7. Under **API restrictions**, select **Restrict key** and check:
   - **Maps SDK for Android**
8. Click **Save**.

---

## 4. Step-by-Step EAS Build Execution

Guardians defines three distinct build profiles in `eas.json`:

```
┌─────────────────────────┬──────────────┬─────────────┬──────────────────────────────────────────┐
│ Profile                 │ Distribution │ Output Type │ Use Case                                 │
├─────────────────────────┼──────────────┼─────────────┼──────────────────────────────────────────┤
│ preview                 │ internal     │ APK         │ Immediate sideloading on physical device │
│ preview-playstore       │ internal     │ AAB (.aab)  │ Google Play Internal Testing track       │
│ production              │ store        │ AAB (.aab)  │ Closed Testing & Production Release      │
└─────────────────────────┴──────────────┴─────────────┴──────────────────────────────────────────┘
```

### 4.1 Build Profile 1: Sideloadable Preview APK

Build a standalone APK file that can be downloaded and installed directly on any physical Android test device without going through the Play Store:

```bash
eas build --platform android --profile preview
```

- Produces an installable `.apk` file.
- Auto-increments the `versionCode` via remote EAS version management.
- Enables rapid iterative smoke testing on hardware.

### 4.2 Build Profile 2: Play Store Internal Testing AAB

Build an Android App Bundle targeting Google Play Internal Testing tracks:

```bash
eas build --platform android --profile preview-playstore
```

- Produces an optimized `.aab` bundle with `preview` release channel.
- Validates bundle compilation against Google Play bundle formatting rules.

### 4.3 Build Profile 3: Release Production AAB

Build the official release candidate App Bundle for Google Play Closed Testing and Production tracks:

```bash
eas build --platform android --profile production
```

- Produces a release `.aab` bundle signed with production credentials.
- Auto-increments `versionCode`.
- Uses `channel: "production"` for OTA updates.
- Uploads Hermes sourcemaps and debug symbols to Sentry (when `SENTRY_AUTH_TOKEN` is configured).

---

## 5. 10-Point Android Physical Device Smoke Testing Checklist

After generating the `preview` APK or installing the Internal Testing build, execute this 10-point test script on a physical Android device:

|   #    | Test Area                        | Verification Steps                                                                 | Pass Criteria                                                                                                                                                         |
| :----: | :------------------------------- | :--------------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1**  | **Cold Launch & Splash**         | Launch app from cold state on device.                                              | Splash screen displays `#0E7C66` background with centered logo; transitions smoothly into app without crash or flicker.                                               |
| **2**  | **Authentication & Session**     | Sign in with email/password; force-close app; relaunch.                            | Auth tokens persist in `expo-secure-store`; user remains logged in without re-prompting.                                                                              |
| **3**  | **Google Maps SDK Rendering**    | Open main Map tab (`/`). Pan and zoom across neighborhoods.                        | Native Google Maps tiles render crisp vector graphics without grey grid or missing tile errors (verifies Maps API Key & SHA-1 restriction).                           |
| **4**  | **Location & Permission Primer** | Tap "My Location" button on map.                                                   | `PermissionPrimer` modal (`📍 Find cats near you`) displays first; accepting triggers Android OS location dialog; map centers smoothly on current coordinates.        |
| **5**  | **Sighting Creation & Media**    | Tap Report (`+`); take photo via camera; select photo from gallery; submit report. | Camera and gallery primers display; images upload to Supabase Storage; sighting appears immediately on live map.                                                      |
| **6**  | **Feed & List Scrolling**        | Switch to Feed view; scroll through 20+ sightings.                                 | Fast scrolling with zero frame drops; thumbnails load asynchronously with caching; status badges (`spotted`, `in_progress`, `rescued`, `adopted`) display accurately. |
| **7**  | **Geo-Privacy & Fuzzing**        | View a sighting created by another user vs. your own sighting.                     | Other users see a rounded ~110m approximate circle; original reporter sees exact GPS pin.                                                                             |
| **8**  | **UGC Moderation & Blocking**    | Tap "Report this listing" on a test sighting; tap "Block this user".               | Abuse report dialog submits `report_content` RPC; blocked user's comments disappear from sighting updates.                                                            |
| **9**  | **Account Deletion Flow**        | Go to Settings → Tap "Delete account" → Confirm destruction.                       | In-app warning shows; `delete-account` Edge Function executes; session purges; app redirects to onboarding screen.                                                    |
| **10** | **Diagnostics & Crash Capture**  | Trigger controlled non-fatal error in debug build.                                 | Sentry receives event with device model, Android OS version, and stack trace; zero PII leaked.                                                                        |

---

## 6. Google Play Console Submission Guide (EAS Submit)

### 6.1 One-Time Google Cloud Service Account Setup

To automate submissions from the command line using `eas submit`, configure a Google Cloud service account:

1. **Create Service Account**:
   - In Google Cloud Console, go to **IAM & Admin** → **Service Accounts**.
   - Click **Create Service Account** (Name: `eas-play-store-submitter`).
   - Grant role: **Service Account User**.
2. **Generate Key File**:
   - Click the created service account → **Keys** tab → **Add Key** → **Create new key** (JSON).
   - Save the file as `google-services-key.json` in the project root.
   - ⚠️ **Ensure `google-services-key.json` is listed in `.gitignore`!**
3. **Link Service Account in Google Play Console**:
   - In Google Play Console, go to **API access**.
   - Under Service Accounts, find the linked account and click **Grant access**.
   - In **App permissions**, select `com.guardians.app`.
   - In **Account permissions**, grant **Releases** permissions:
     - _Create, edit, and delete draft apps_
     - _Release to testing tracks_
     - _Release to production, exclude devices, and use Play App Signing_
   - Click **Invite user** / **Save**.

### 6.2 Submitting the Latest Build to Google Play

Submit the most recently completed EAS production build directly to the Google Play Store **Internal Testing** track:

```bash
eas submit --platform android --latest
```

Or specify profile explicitly:

```bash
eas submit --platform android --profile production
```

Or submit a specific build by build ID:

```bash
eas submit --platform android --id <EAS_BUILD_UUID>
```

### 6.3 Track Promotion Workflow in Google Play Console

Follow the standard phased release progression:

```
┌─────────────────────────┐     Promote     ┌─────────────────────────┐     Promote     ┌─────────────────────────┐
│     INTERNAL TRACK      │ ──────────────> │     CLOSED TESTING      │ ──────────────> │       PRODUCTION        │
│  (Engineers & QA Team)  │                 │    (Beta Tester Group)  │                 │     (100% Public Roll)  │
└─────────────────────────┘                 └─────────────────────────┘                 └─────────────────────────┘
```

1. **Internal Testing Track**:
   - Instant deployment (available within minutes to internal tester email list).
   - Run the 10-Point Physical Device Smoke Test.
2. **Closed Testing Track (Alpha/Beta)**:
   - Promote internal build in Play Console to Closed Testing.
   - Collect feedback from trusted shelter volunteers and cat rescuers.
3. **Production Track**:
   - Promote approved Closed Testing release to Production.
   - Start with a phased rollout (e.g. 10% → 25% → 50% → 100%) to monitor crash rates in Sentry and Play Console Android Vitals.

---

## 7. Post-Release Monitoring & Rollback Strategy

### 7.1 Android Vitals & Sentry Monitoring

Monitor the release for the first 48 hours:

- **Crash Rate**: Maintain crash-free sessions > 99.5% in Sentry.
- **ANR Rate (Application Not Responding)**: Maintain ANR rate < 0.47% in Google Play Console Android Vitals.
- **Maps API Quota**: Monitor Google Cloud Console Maps API usage to ensure quota limits are not exceeded.

### 7.2 Emergency Hotfix / Rollback Procedure

- **For JS/Asset Issues (OTA Updates)**:
  Publish an instant Over-The-Air hotfix without store review:
  ```bash
  eas update --channel production --message "Hotfix: resolve map marker render glitch"
  ```
- **For Native/Binary Issues**:
  1. Fix issue in source code.
  2. Run `npm run preflight` to ensure all quality gates pass.
  3. Trigger a new production build: `eas build --platform android --profile production` (auto-increments `versionCode`).
  4. Submit to Play Store: `eas submit --platform android --latest`.
  5. In Play Console, halt the rollout of the broken version and publish the hotfix immediately.
