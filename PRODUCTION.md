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
- [x] Add a **password reset** flow + deep link. _(done — `app/(auth)/forgot-password.tsx`, `app/reset.tsx`, `src/lib/authLink.ts`)_
- [ ] Enable **Point-in-Time Recovery / scheduled backups**.
- [x] **DB rate limiting / abuse protection** — insert rate-limit triggers in
      migration 0011. _(gateway-level limits still TODO)_
- [x] **pgTAP RLS + RPC behavioral tests** — 114 tests across 9 suites, including
      location privacy, write guards, redeem guard, moderation, lifecycle, and AI KB.
      Runs via `supabase db test` in CI. _(done — see `supabase/tests/`)_
- [x] Add an **`is_moderator`** role + moderation policies. _(done — migration 0012; `app/moderation.tsx`)_

## 3. Safety, privacy & moderation ⚠️ important for this app

- [x] **Map coordinates are coarsened** to ~110 m and the radius is clamped in
      `nearby_sightings` so the map can't be used to enumerate exact locations.
- [x] **Sighting-detail exact location is gated** — precise coords + address go
      only to the reporter/assigned guardian via the `get_sighting_detail`
      SECURITY DEFINER RPC; everyone else sees an approximate circle. _(done — migration 0009)_
- [x] **Report/flag + block-user backend** — `report_content`, `moderate_content`,
      `blockUser`/`unblockUser`, and a moderation queue. Block-user action is
      surfaced in the sighting detail screen + Settings has a blocked-users list
      with unblock. _(done — migration 0012; `app/blocked-users.tsx`; `app/sighting/[id].tsx`)_
- [x] Add **photo moderation** (e.g. AWS Rekognition / a moderation queue review step).
      _(done in code — AI-M2 `ai-moderate-photo` + `ai-moderate-text` edge functions,
      migration 0020: a confident violation auto-hides and enqueues for human review,
      never deletes. Live once 0020 is applied, the functions are deployed and
      `EXPO_PUBLIC_AI_ENABLED=true`.)_
- [x] Write the **Privacy Policy** and **Terms** (you collect location + photos).
      _(done — `docs/legal/privacy-policy.md`, `docs/legal/terms.md`, surfaced
      in-app at `app/privacy.tsx` / `app/terms.tsx`. Still need a **public URL**
      for the store listings — see §7.)_
- [ ] Fill out the App Store **Privacy Nutrition Labels** and Play **Data Safety**
      form (location, photos, account data).

## 4. Notifications

- [x] **Push registration** — `registerForPush()` + the `upsert_push_token` RPC
      (stores a coarse home area). _(done — `src/lib/push.ts`, migration 0010)_
- [x] **Lifecycle push events (DB webhook)** — `send-push` Edge Function now
      receives DB-triggered webhooks for urgent (existing), claimed, rescued/safe,
      and adoption-interest events. JWT + shared-secret dual auth; logging/ticket
      inspection/token reaping. _(done — migration 0029; `supabase/functions/send-push` hardened)_

## 5. Maps & performance

- [x] **Marker clustering** via supercluster. _(done — `app/(tabs)/index.tsx`)_
- [x] **Feed pagination** — keyset cursor + infinite scroll. _(done — `getFeed`, `useFeed`)_
- [ ] Serve **resized images** via Supabase image transformations / a CDN.
- [ ] Build a **dev/production client** (Google Maps on iOS + camera require it).

## 6. Quality & release engineering

- [x] **Unit & contract tests** — 61 Jest tests + 114 pgTAP behavioral tests, all
      green in CI on every PR. _(done — Jest + `supabase db test` in CI)_
- [ ] **E2E flows** (Maestro or Detox): sign up → report → claim → adopt.
- [x] **Error tracking** — `@sentry/react-native` installed, init wired, DSN
      placeholder in `.env.example`. _(done — needs real DSN + EAS secret)_
- [x] **Self-hosted analytics** — 4 funnel events land in `analytics_events`.
      _(done — migration 0028)_
- [ ] Wire **EAS Build + Submit** and **`expo-updates`** OTA for JS-only fixes.
- [x] **Accessibility sweep** — labels/roles on all interactive elements; reduce-motion
      gates Reanimated entrances on every animated screen. _(done — Wave 3)_
- [ ] Generate final **app icons, splash, store screenshots & copy**.

## 7. Web deployment (static export)

`expo export --platform web` produces a static SPA that any static host can
serve for free. **Scope check first:** on web the live map is a placeholder
(`src/components/PlatformMap.web.tsx`) and push is a no-op, so the web build is
the app _minus_ its map. Its immediate value is a **public URL for the Privacy
Policy and Terms** — both stores require one before submission — plus a demo
link. Everything else (auth, feed, sighting detail, profiles, adoption,
leaderboard, rewards, moderation) works.

- [x] **SPA fallback** — `public/_redirects` (`/* /index.html 200`). The export
      emits a single `index.html` and Expo Router resolves routes client-side, so
      without a catch-all any refresh or direct link to `/settings`, `/privacy`,
      `/sighting/<id>` 404s. Lives in `public/` because `expo export` clears
      `dist/` on every run and copies `public/` to the export root.
- [x] **Build script** — `npm run build:web` → `dist/` (~13 MB).
- [ ] **Deploy.** Cloudflare Pages recommended: free tier has unlimited
      bandwidth (Vercel/Netlify cap at 100 GB) and no commercial-use
      restriction.

      ```bash
      EXPO_PUBLIC_SUPABASE_URL=... EXPO_PUBLIC_SUPABASE_ANON_KEY=... npm run build:web
      npx wrangler pages deploy dist --project-name guardians
      ```

      Pass only those two vars. **Omit the Google Maps keys** — unused on web
      (no map) and there's no reason to bake them into a public bundle. The
      Supabase anon key is safe to ship; it's RLS-protected by design.

- [ ] **Supabase Auth URL configuration** — easy to miss, silently breaks
      sign-up. `AuthProvider` builds email links with
      `Linking.createURL('/confirm')` and `Linking.createURL('/reset')`, which
      resolve to the deployed origin at runtime. In Dashboard → Authentication →
      URL Configuration set **Site URL** to the deployed origin and add
      `<origin>/**` to **Redirect URLs**, or confirmation and reset emails will
      be rejected.
- [ ] **Turn email confirmation on before making the site public** (see §2) —
      otherwise a public URL means open, unverified sign-up.

Cost: **$0** (Cloudflare Pages free tier, 500 builds/month). A custom domain is
optional at roughly $10/yr.

## 8. Nice-to-haves

- [ ] Dark mode (theme tokens are centralized in `src/theme`).
- [ ] Social / Apple / Google sign-in.
- [ ] Map heatmap of rescue activity; guardian "on duty" radius alerts.
- [ ] In-app chat between reporter, guardian and adopter.
- [ ] Generated Supabase types: `supabase gen types typescript --linked > src/types/database.ts`.

[Supabase RLS test guide]: https://supabase.com/docs/guides/database/postgres/row-level-security
