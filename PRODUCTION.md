# 🚀 Production checklist

This MVP is a complete, runnable vertical slice. The items below are what stand
between it and a polished public launch on the App Store / Play Store. They're
ordered roughly by priority.

## 1. Secrets & keys
- [ ] Put `EXPO_PUBLIC_*` values and Google Maps keys into **EAS environment
      variables / secrets** (not just local `.env`) so cloud builds pick them up.
- [ ] **Restrict the Google Maps keys** in Google Cloud Console:
      Android key → your app's package name + SHA-1; iOS key → your bundle id.
- [ ] Rotate the Supabase anon key if it was ever committed.

## 2. Backend hardening (Supabase)
- [ ] Turn **email confirmation ON** and configure a real SMTP sender.
- [ ] Add a **password reset** flow + deep link (`guardians://reset`).
- [ ] Enable **Point-in-Time Recovery / scheduled backups**.
- [ ] Add DB **rate limiting / abuse protection** (Supabase API gateway settings).
- [ ] Review every RLS policy against the [Supabase RLS test guide]; add
      `pgTAP` tests for the policies in `supabase/migrations/0004_rls.sql`.
- [ ] Consider an **`is_moderator`** role + admin policies for handling reports.

## 3. Safety, privacy & moderation  ⚠️ important for this app
- [x] **Map coordinates are coarsened** to ~110 m and the radius is clamped in
      `nearby_sightings` so the map can't be used to enumerate exact locations.
- [ ] **Also gate the sighting-detail exact location** (`getSighting` still
      returns precise lat/lng): expose precise coords only to the reporter/
      assigned guardian via a SECURITY DEFINER RPC; show an approximate circle to
      everyone else.
- [ ] Add **report/flag abuse** + **block user** flows.
- [ ] Add **photo moderation** (e.g. AWS Rekognition / a moderation queue).
- [ ] Write the **Privacy Policy** and **Terms** (you collect location + photos).
- [ ] Fill out the App Store **Privacy Nutrition Labels** and Play **Data Safety**
      form (location, photos, account data).

## 4. Notifications
- [ ] Implement push registration with `expo-notifications` (the `push_token`
      column + `savePushToken()` API are already scaffolded).
- [ ] Add a Supabase **Edge Function / DB webhook** that notifies nearby
      guardians when an urgent sighting is reported, and notifies the reporter
      when their cat is claimed/rescued.

## 5. Maps & performance
- [ ] **Cluster markers** when many cats are visible (`react-native-map-clustering`
      or a supercluster integration) — the current map renders raw pins.
- [ ] **Paginate** the feed (currently a 50-row limit) with infinite scroll.
- [ ] Serve **resized images** via Supabase image transformations / a CDN.
- [ ] Build a **dev/production client** (Google Maps on iOS + camera require it).

## 6. Quality & release engineering
- [ ] Add **unit tests** (Jest + React Native Testing Library) and a couple of
      **E2E flows** (Maestro or Detox): sign up → report → claim → adopt.
- [ ] Add **error tracking** (Sentry) and basic **analytics**.
- [ ] Wire **EAS Build + Submit** and **`expo-updates`** OTA for JS-only fixes.
- [ ] Pass an **accessibility** sweep (labels, contrast, dynamic type).
- [ ] Generate final **app icons, splash, store screenshots & copy**.

## 7. Nice-to-haves
- [ ] Dark mode (theme tokens are centralized in `src/theme`).
- [ ] Social / Apple / Google sign-in.
- [ ] Map heatmap of rescue activity; guardian "on duty" radius alerts.
- [ ] In-app chat between reporter, guardian and adopter.
- [ ] Generated Supabase types: `supabase gen types typescript --linked > src/types/database.ts`.

[Supabase RLS test guide]: https://supabase.com/docs/guides/database/postgres/row-level-security
