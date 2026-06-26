# 🚀 Production checklist

This MVP is a complete, runnable vertical slice. The items below are what stand
between it and a polished public launch on the App Store / Play Store. They're
ordered roughly by priority.

> The detailed, **sequenced milestone plan** now lives in [`ROADMAP.md`](./ROADMAP.md).
> This file is the raw status checklist; several items below are now done.

## 1. Secrets & keys
- [ ] Put `EXPO_PUBLIC_*` values and Google Maps keys into **EAS environment
      variables / secrets** (not just local `.env`) so cloud builds pick them up.
- [ ] **Restrict the Google Maps keys** in Google Cloud Console:
      Android key → your app's package name + SHA-1; iOS key → your bundle id.
- [ ] Rotate the Supabase anon key if it was ever committed.

## 2. Backend hardening (Supabase)
- [ ] Turn **email confirmation ON** and configure a real SMTP sender.
- [x] Add a **password reset** flow + deep link. *(done — `app/(auth)/forgot-password.tsx`, `app/reset.tsx`, `src/lib/authLink.ts`)*
- [ ] Enable **Point-in-Time Recovery / scheduled backups**.
- [x] Add DB **rate limiting / abuse protection**. *(done at the DB layer — insert rate-limit triggers in migration 0011; gateway-level limits still TODO)*
- [ ] Review every RLS policy against the [Supabase RLS test guide]; add
      `pgTAP` tests for the policies in `supabase/migrations/0004_rls.sql`.
- [x] Add an **`is_moderator`** role + moderation policies. *(done — migration 0012; `app/moderation.tsx`)*

## 3. Safety, privacy & moderation  ⚠️ important for this app
- [x] **Map coordinates are coarsened** to ~110 m and the radius is clamped in
      `nearby_sightings` so the map can't be used to enumerate exact locations.
- [x] **Sighting-detail exact location is gated** — precise coords + address go
      only to the reporter/assigned guardian via the `get_sighting_detail`
      SECURITY DEFINER RPC; everyone else sees an approximate circle. *(done — migration 0009)*
- [x] **Report/flag + block-user backend** — `report_content`, `moderate_content`,
      `blockUser`/`unblockUser`, and a moderation queue. *(done — migration 0012; surfacing the block-user action in the sighting UI is the remaining bit)*
- [ ] Add **photo moderation** (e.g. AWS Rekognition / a moderation queue review step).
- [ ] Write the **Privacy Policy** and **Terms** (you collect location + photos).
- [ ] Fill out the App Store **Privacy Nutrition Labels** and Play **Data Safety**
      form (location, photos, account data).

## 4. Notifications
- [x] **Push registration** — `registerForPush()` + the `upsert_push_token` RPC
      (stores a coarse home area). *(done — `src/lib/push.ts`, migration 0010)*
- [x] **Urgent-sighting push fan-out** — `supabase/functions/send-push` +
      service-role `tokens_near` RPC alerts nearby opted-in guardians. *(done;
      currently client-triggered, and only urgent reports — moving to a DB webhook
      and adding claimed/rescued notifications is on the roadmap)*

## 5. Maps & performance
- [x] **Marker clustering** via supercluster. *(done — `app/(tabs)/index.tsx`)*
- [x] **Feed pagination** — keyset cursor + infinite scroll. *(done — `getFeed`, `useFeed`)*
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
