# Project: Guardians Android Production Release & Google Play Store Compliance

## Architecture

- **Framework**: Expo SDK 56 (`~56.0.12`), React Native (`0.85.3`), React Native Reanimated (`4.3.1`), React Native Worklets (`0.8.3`).
- **Build Pipeline**: EAS Build (`eas.json`), dynamic configuration (`app.config.ts`), remote versioning with auto-incrementing `versionCode`.
- **Maps Engine**: `PlatformMap` wrapper façade using `react-native-maps` with Google Maps SDK on Android (`EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_KEY` + SHA-1 restricted) and Leaflet/OSM on Web.
- **Backend & Auth**: Supabase PostgreSQL + PostGIS, Supabase Auth, Row Level Security (RLS), Supabase Storage, and Deno Edge Functions.
- **Diagnostics**: Sentry React Native SDK (`@sentry/react-native`).

## Feature Inventory

| #   | Feature                                        | Description                                                                                                                           | Milestone | Source | Status   |
| --- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | --------- | ------ | -------- |
| 1   | Expo SDK 56 Config Validation                  | Ensure absence of deprecated fields (`splash`, `newArchEnabled`, `android.edgeToEdgeEnabled`) and verify `expo-splash-screen` plugin  | M1        | Survey | VERIFIED |
| 2   | Android Package Identifier                     | Ensure `package: "com.guardians.app"` in `app.config.ts`                                                                              | M1        | Survey | VERIFIED |
| 3   | Versioning & AutoIncrement Strategy            | Configure EAS remote `appVersionSource` and `autoIncrement: true` for build profiles in `eas.json`                                    | M1        | Survey | VERIFIED |
| 4   | Adaptive Icons & Splash Branding               | Validate foreground, background, monochrome Material You icons and splash branding                                                    | M1        | Survey | VERIFIED |
| 5   | Google Maps Native Android Key Integration     | Configure `android.config.googleMaps.apiKey` with fallback in `app.config.ts`                                                         | M1        | Survey | VERIFIED |
| 6   | EAS Build Profiles                             | Configure `preview` (APK for sideloading), `preview-playstore` (AAB for testing track), and `production` (AAB for store release)      | M1        | Survey | VERIFIED |
| 7   | EAS Submit Config                              | Configure `submit.production.android` for automated Google Play internal track submission                                             | M1        | Survey | VERIFIED |
| 8   | Android Permissions Scoping & Rationale        | Verify scoped permissions (`ACCESS_FINE_LOCATION`, `ACCESS_COARSE_LOCATION`, `CAMERA`, `READ_MEDIA_IMAGES`) and `PermissionPrimer` UI | M2        | Survey | VERIFIED |
| 9   | Google Play Data Safety Reference Guide        | Complete master declaration mapping for all collected data types, purposes, encryption, and retention                                 | M2        | Survey | VERIFIED |
| 10  | Account Deletion Flow Compliance               | Document and verify in-app deletion button, Supabase Edge Function cascade, and web deletion URL policy                               | M2        | Survey | VERIFIED |
| 11  | UGC Moderation & Safety Compliance             | Document and verify reporting (`report_content`), 3-strike auto-hide, user blocking (`user_blocks`), and moderator panel              | M2        | Survey | VERIFIED |
| 12  | In-App & Sign-Up Legal Links                   | Verify in-app Privacy Policy (`/privacy`), Terms (`/terms`), and add legal disclaimer on Sign-Up screen (`/sign-up`)                  | M2        | Survey | VERIFIED |
| 13  | Pre-Flight Automated Quality Gates             | Validate `typecheck`, `typecheck:test`, `test` (102 tests), `lint`, `preflight`                                                       | M3        | Survey | VERIFIED |
| 14  | Secrets & Environment Variables Matrix         | Document all 10 client/build variables and 3 server secrets with validation commands                                                  | M3        | Survey | VERIFIED |
| 15  | Android Keystore & Dual SHA-1 Maps Restriction | Document EAS Keystore SHA-1 + Google Play App Signing SHA-1 restriction in Google Cloud Console                                       | M3        | Survey | VERIFIED |
| 16  | Step-by-Step Android Release Runbook           | Complete runbook with EAS commands for preview APK, production AAB, Play Store submission, and 10-point smoke checklist               | M3        | Survey | VERIFIED |
| 17  | Pre-Flight Automation Script                   | Create automated verification script to run all pre-flight quality gates in one command (`scripts/preflight-check.sh`)                | M3        | Survey | VERIFIED |

## Milestones

| #   | Name                                                    | Scope                                                                                                  | Dependencies | Status | Outputs                                                                                                                  |
| --- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ------------ | ------ | ------------------------------------------------------------------------------------------------------------------------ |
| M1  | Android Production Build & EAS Pipeline                 | Update `app.config.ts` and `eas.json` for Android release AAB/APK, auto-increment, and Google Maps key | none         | DONE   | `app.config.ts`, `eas.json`                                                                                              |
| M2  | Google Play Policy, Data Safety, UGC & Legal Compliance | Create Data Safety guide, verify UGC/deletion mechanisms, add sign-up legal notice                     | none         | DONE   | `docs/release/DATA_SAFETY.md`, `docs/release/PLAY_STORE_POLICY.md`, `app/(auth)/sign-up.tsx`                             |
| M3  | Release Verification, Runbook & Pre-Flight Automation   | Create comprehensive release runbook, secrets checklist, and pre-flight script                         | M1, M2       | DONE   | `docs/release/ANDROID_RELEASE_RUNBOOK.md`, `scripts/preflight-check.sh`, `package.json`                                  |
| M4  | Final Integration, Test Pass & Verification             | Run full automated quality checks, verify all acceptance criteria, and audit                           | M1, M2, M3   | DONE   | Reviewer 1 (APPROVE), Reviewer 2 (APPROVE), Challenger 1 (APPROVE), Challenger 2 (APPROVE), Auditor 1 (CLEAN), Gate PASS |

## Interface Contracts

### `app.config.ts` & `eas.json`

- `android.package`: `'com.guardians.app'`
- `android.config.googleMaps.apiKey`: `process.env.EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_KEY || process.env.GOOGLE_MAPS_ANDROID_API_KEY`
- `eas.json`:
  - `build.preview`: `{ "distribution": "internal", "channel": "preview", "autoIncrement": true, "android": { "buildType": "apk" } }`
  - `build.preview-playstore`: `{ "distribution": "internal", "channel": "preview", "autoIncrement": true, "android": { "buildType": "app-bundle" } }`
  - `build.production`: `{ "channel": "production", "autoIncrement": true, "android": { "buildType": "app-bundle" } }`
  - `submit.production.android`: `{ "serviceAccountKeyPath": "./google-services-key.json", "track": "internal" }`

### Data Safety & UGC Contracts

- Data Safety categories: Approximate/Precise Location, Email, Username, User IDs, Photos, In-app updates, App activity, Diagnostics, Push Tokens.
- Moderation RPCs: `report_content(p_target_type, p_target_id, p_reason)`, `block_user(p_blocked_id)`, `unblock_user(p_blocked_id)`.
- Account deletion: `supabase.functions.invoke('delete-account')` invoking `auth.admin.deleteUser(user.id)`.

## Code Layout

- Root: `app.config.ts`, `eas.json`, `package.json`, `tsconfig.json`, `.env.example`
- Documentation: `docs/release/DATA_SAFETY.md`, `docs/release/ANDROID_RELEASE_RUNBOOK.md`, `docs/release/PLAY_STORE_POLICY.md`
- Source: `app/(auth)/sign-up.tsx`, `app/settings.tsx`, `app/sighting/[id].tsx`, `src/components/PermissionPrimer.tsx`, `src/lib/env.ts`
- Scripts: `scripts/preflight-check.sh`
- Tests: `src/__tests__/*`
