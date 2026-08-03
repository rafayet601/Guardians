# 🚀 Deploying Guardians to production (cost-effective path)

> Companion to [`PRODUCTION.md`](./PRODUCTION.md) (ops checklist) and
> [`ROADMAP.md`](./ROADMAP.md) (milestones). This is the concrete, step-by-step
> runbook to get real users on iOS + Android at the smallest monthly cost,
> without cutting safety (backups, crash reporting, restricted keys).

## Monthly cost (lean launch)

| Service               | Tier                                 | ~Cost                 | Why                                                                                                                                                                   |
| --------------------- | ------------------------------------ | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Apple Developer**   | Required for TestFlight/store        | **$99/yr**            | Unavoidable for iOS                                                                                                                                                   |
| **Google Play**       | One-time                             | **$25 once**          | Unavoidable for Play                                                                                                                                                  |
| **Supabase**          | Free → Pro when live                 | **$0 → $25/mo**       | Free for closed beta; **Pro for PITR/backups**                                                                                                                        |
| **EAS Build**         | Free tier / pay-as-you-go            | **$0–15/mo**          | Enough early                                                                                                                                                          |
| **Expo Push**         | Free                                 | **$0**                | Already integrated                                                                                                                                                    |
| **Sentry**            | Free (5k errors)                     | **$0**                | Enough for first cohort                                                                                                                                               |
| **Google Maps**       | Free tier — **verify current terms** | **$0** at small scale | Restrict keys hard. Google replaced the old recurring $200/mo credit with per-SKU monthly free quotas in 2025; check the live pricing page before relying on a number |
| **Cloudflare Pages**  | Free                                 | **$0**                | Host Privacy/Terms + optional web                                                                                                                                     |
| **SMTP (Resend)**     | Free tier                            | **$0**                | Auth emails (better than default Supabase mail)                                                                                                                       |
| **Domain (optional)** | Any registrar                        | **~$10–15/yr**        | `guardians.app` / similar for legal URLs                                                                                                                              |

**Realistic first 90 days:** ~**$25–50/mo** + Apple $99/yr (if Supabase Pro +
occasional EAS builds).

**Skip for now (saves money):** custom CDN, paid analytics, paid moderation
APIs, multi-region, Apple/Google sign-in.

---

## Phase 0 — Git / prod parity

**Status as of 2026-08-03: steps 1–3 are DONE.** Only steps 4–6 remain.

1. ~~**Merge PR #10** → `main`.~~ **Done** — merged as `4406c01`.
2. ~~**Apply migrations 0027–0031.**~~ **Done** — the live project
   (`tiqizsjxqfscwbhyvumk`) is at `0031`; ledger has 19 rows. Verified by
   fingerprinting live against a fresh local `supabase db reset` across columns,
   functions (incl. `prosecdef`/`search_path`), policies, triggers, indexes,
   extensions, RLS flags and enums — all categories match. **Zero drift.**

   > ⚠️ **Do NOT run `supabase db push` on this project.** Migrations here are
   > applied individually (MCP `apply_migration` / SQL editor), so the remote
   > ledger's versions don't line up with the local `00NN_*.sql` filenames and a
   > push can re-run an early base migration. That is exactly what caused the
   > 2026-07-17 outage: re-running a base migration silently reverted the
   > hardening in 0011/0012, `nearby_sightings` lost SECURITY DEFINER, and the
   > live map returned `42501` for every signed-in user. Apply one migration at
   > a time and re-run the advisors after.

3. ~~**Deploy edge functions.**~~ **Done** — all 13 are ACTIVE. `send-push` is
   **v2 with `verify_jwt: false`** (dual auth: webhook secret or caller JWT);
   the other 12 remain v1 with `verify_jwt: true`. Redeploys must keep
   `verify_jwt = false` for `send-push` — the CLI reads it from
   `supabase/config.toml`, so `supabase functions deploy send-push` is correct.
4. **Set Supabase secrets** (still pending — no MCP tool for secrets, use the
   dashboard):
   ```bash
   supabase secrets set PUSH_WEBHOOK_SECRET=<long-random>
   # optional later: ANTHROPIC_API_KEY=...  VOYAGE_API_KEY=...
   ```
5. **Configure `private.push_config` in SQL Editor** (migration 0029 seeds
   empty — both rows are still `''`, so every trigger currently logs a WARNING
   and skips. Do this **after** step 4, or each POST 401s):
   ```sql
   update private.push_config
     set value = 'https://tiqizsjxqfscwbhyvumk.supabase.co/functions/v1/send-push'
     where key = 'edge_function_url';
   update private.push_config
     set value = '<same as PUSH_WEBHOOK_SECRET>'
     where key = 'webhook_secret';
   ```
6. Confirm **no `service_role` key** is in the app or git. Only the anon key
   ships in the client.

---

## Phase 1 — Free public surface (Privacy/Terms + auth URLs) (half day)

Stores require a **public Privacy + Terms URL**. The web build is the app minus
the map (placeholder on web) — still works for auth, feed, sighting detail,
profiles, adoption, leaderboard, rewards, moderation, and the legal pages.

1. Build web with only Supabase public vars (**no Maps keys**):
   ```bash
   EXPO_PUBLIC_SUPABASE_URL=... \
   EXPO_PUBLIC_SUPABASE_ANON_KEY=... \
   npm run build:web
   npx wrangler pages deploy dist --project-name guardians
   ```
2. Note origin, e.g. `https://guardians.pages.dev`.
3. **Supabase → Authentication → URL Configuration:**
   - **Site URL** = that origin (and later your custom domain).
   - **Redirect URLs** include:
     - `https://guardians.pages.dev/**`
     - `guardians://**` (app scheme from `app.config.ts`)
4. Smoke: open `/privacy` and `/terms` on the public URL; paste those URLs into
   store listings later.
5. Optional: point a cheap custom domain at Cloudflare Pages.

**Attention:** email confirm/reset links break if Redirect URLs are wrong —
a silent failure.

---

## Phase 2 — Backend go-live config (half day)

### Supabase dashboard

| Setting                        | Action                                                                    |
| ------------------------------ | ------------------------------------------------------------------------- |
| **Email confirmation**         | ON before public traffic                                                  |
| **SMTP**                       | Resend (or similar) free SMTP — don’t rely on default mail for real users |
| **Leaked password protection** | ON                                                                        |
| **PITR / daily backups**       | Requires **Pro ($25/mo)** — turn on before public GA                      |
| **Auth rate limits**           | Leave defaults; tighten if abuse appears                                  |
| **Storage**                    | Confirm `cat-photos` / `avatars` buckets + size limits                    |

### Rotate / restrict

- Rotate the Supabase **anon** key if it was ever committed historically.
- Never put `service_role` in EAS or client env vars.

---

## Phase 3 — Keys & secrets (half day)

### Google Maps (required for native map)

1. Google Cloud project → enable **Maps SDK for iOS** + **Maps SDK for Android**.
2. Two keys:
   - **iOS:** restrict to bundle id `com.guardians.app`.
   - **Android:** restrict to package `com.guardians.app` + **release SHA-1**
     (from EAS credentials after the first build).
3. Put keys in **EAS secrets**, not only local `.env`.

### Sentry (free tier)

1. Create a React Native project on sentry.io.
2. EAS secrets:
   - `EXPO_PUBLIC_SENTRY_DSN`
   - `SENTRY_ORG`
   - `SENTRY_PROJECT`
   - `SENTRY_AUTH_TOKEN` (org auth token — **not** `EXPO_PUBLIC_`)

### EAS project

```bash
npm i -g eas-cli
eas login
eas init   # sets EAS_PROJECT_ID
```

Set all secrets (example):

```bash
eas secret:create --name EXPO_PUBLIC_SUPABASE_URL --value "..."
eas secret:create --name EXPO_PUBLIC_SUPABASE_ANON_KEY --value "..."
eas secret:create --name EXPO_PUBLIC_GOOGLE_MAPS_IOS_KEY --value "..."
eas secret:create --name EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_KEY --value "..."
eas secret:create --name EXPO_PUBLIC_SENTRY_DSN --value "..."
eas secret:create --name SENTRY_ORG --value "..."
eas secret:create --name SENTRY_PROJECT --value "..."
eas secret:create --name SENTRY_AUTH_TOKEN --value "..."
eas secret:create --name EAS_PROJECT_ID --value "..."
eas secret:create --name EXPO_PUBLIC_AI_ENABLED --value "false"
```

---

## Phase 4 — Accounts & store shells (same day as keys)

1. **Apple Developer** ($99/yr) → App Store Connect → new app
   - Bundle ID: `com.guardians.app`
   - Privacy Policy URL = Cloudflare URL
   - Fill **Privacy Nutrition Labels** (location, photos, email, diagnostics).
2. **Google Play Console** ($25) → create app
   - Package: `com.guardians.app`
   - **Data Safety** form (same data types).
   - Privacy Policy URL.
3. Store listing assets: icon (have), 3–8 screenshots, short + long
   description, support email (`rafayetquader@gmail.com` already in Terms).

**Attention (Apple UGC apps):** account deletion (have), report/block (have),
24h moderation process (document in listing/support), zero-tolerance clause in
Terms (have).

---

## Phase 5 — First real builds (cost-effective path)

### A. Internal / closed beta (cheapest, do this first)

```bash
# Android internal APK/AAB (no review)
eas build --profile preview --platform android

# iOS TestFlight (needs Apple account + credentials)
eas build --profile preview --platform ios
eas submit --platform ios --latest
```

Install on 5–20 devices. Smoke:

- Sign up / confirm email / reset password
- Map tiles load (Google key + SHA-1)
- Report → claim → status → adopt
- Push: urgent report → nearby guardian gets notify
- Block user / report content
- Delete account
- Forced crash appears in Sentry (release build)

### B. Production store build (when beta is clean ~7 days)

```bash
eas build --profile production --platform all
eas submit --platform ios --latest
eas submit --platform android --latest
```

Start with **TestFlight + Play Internal/Closed testing**, not open production,
until crash-free.

### C. OTA (free JS fixes after native build exists)

```bash
eas update --channel preview --message "fix copy"
# later:
eas update --channel production --message "hotfix"
```

`expo-updates` + channels already sketched in `app.config.ts` / `eas.json`.

**Attention:** OTA cannot change native modules (Maps, Sentry native,
permissions). Those need a new binary build.

---

## Phase 6 — Production attention list (do not skip)

| Area                               | Risk if skipped        | What to do                                                                                    |
| ---------------------------------- | ---------------------- | --------------------------------------------------------------------------------------------- |
| **Email confirm OFF**              | Open spam signups      | ON + real SMTP before public URL/app                                                          |
| **Redirect URLs**                  | Auth emails fail       | Web origin + `guardians://**`                                                                 |
| **Maps key unrestricted**          | Bill shock / abuse     | Bundle ID + package + SHA-1                                                                   |
| **Android SHA-1 wrong**            | Blank map on release   | Use EAS credentials SHA-1 for release keystore                                                |
| **push_config empty**              | No lifecycle pushes    | Set URL + secret after deploy                                                                 |
| **`send-push` `verify_jwt=false`** | OK only with dual-auth | Keep webhook secret strong; never log it                                                      |
| **No backups**                     | Data loss              | Supabase Pro + PITR before GA                                                                 |
| **Sentry DSN missing**             | Blind crashes          | Set before TestFlight                                                                         |
| **AI enabled too early**           | Cost + liability       | Keep `EXPO_PUBLIC_AI_ENABLED=false` until secrets + policy OK                                 |
| **service_role leak**              | Full DB compromise     | Client only gets anon key                                                                     |
| **Photo size unlimited**           | Storage cost           | Cap uploads / later image transforms                                                          |
| **UGC policy**                     | App Store rejection    | Report/block + 24h response + account delete already in product — document it                 |
| **main ≠ prod DB**                 | Drift bugs             | ✅ Resolved — live is at 0031, fingerprint-verified zero drift. Never `db push` (see Phase 0) |
| **Legal URL only in-app**          | Store rejection        | Public hosted `/privacy` + `/terms`                                                           |

---

## Recommended sequence (minimal calendar)

| Day      | Work                                                                                                                 |
| -------- | -------------------------------------------------------------------------------------------------------------------- |
| **1**    | ~~Merge PR #10 · migrations · deploy functions~~ (done) · `PUSH_WEBHOOK_SECRET` + push_config · SMTP + email confirm |
| **1**    | Cloudflare Pages legal URLs · Auth redirect URLs                                                                     |
| **2**    | Maps keys · Sentry · EAS secrets · Apple/Play accounts                                                               |
| **3**    | `eas build` preview iOS+Android · internal testers                                                                   |
| **4–10** | Closed beta · watch Sentry · fix via OTA if JS-only                                                                  |
| **11+**  | Production build · submit · start **closed** store testing → open when stable                                        |

---

## What “done” looks like

- [ ] Public Privacy + Terms URLs live
- [ ] Supabase: migrations applied, functions deployed, email confirm + SMTP, backups on
- [ ] EAS secrets set; restricted Maps keys; Sentry receiving events
- [ ] TestFlight + Play internal builds installed on real devices
- [ ] Core loop works end-to-end: report → push → claim → rescue → adopt
- [ ] Account delete + block/report verified
- [ ] Store privacy forms filled
- [ ] Production submit only after ~7 clean beta days

---

## Optional later (not needed for first live users)

- Image CDN/transforms (cost control at scale)
- Maestro E2E in CI
- Dark mode / social login
- Turn AI features on
- Custom domain branding
