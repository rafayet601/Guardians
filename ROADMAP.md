# Guardians — Production Readiness Roadmap

> Path from "complete, runnable MVP" to a confident public launch on the App Store & Google Play.
> Companion to [`PRODUCTION.md`](./PRODUCTION.md). Generated from a code-level audit (2026-06-23).
> See [`AI_ROADMAP.md`](./AI_ROADMAP.md) for the post-launch AI integration track — it
> intentionally does not compete with M0/M1 here for attention.

**Effort key:** `S` ≤ 1 day · `M` ≈ 2–4 days · `L` ≈ 1–2 weeks · `XL` > 2 weeks.
**Estimate to launch:** ~6–9 weeks focused; **M0** is the critical path, **M1/M2** overlap it.

## Verdict

The product and **security core is strong** — RLS on every table, all sensitive writes behind `SECURITY DEFINER` RPCs, location coarsening (~110 m for non-owners), double-spend protection, a real `send-push` Edge Function, marker clustering, keyset pagination, and a moderation system (report + block + moderator takedown). The gaps are in the **surround**: legal/store compliance, the release pipeline, operational visibility, and a test/quality safety net.

### Already handled (confirmed in code — not gaps)

- iOS permission usage strings + Android permissions + adaptive/monochrome icons + splash (`app.config.ts`).
- Moderation backend & API: `report_content`, `moderate_content`, `blockUser`/`unblockUser`, `is_moderator` gate, moderation queue (`src/api/moderation.ts`, migration 0012).
- `expo-secure-store` plugin already present (ready to back the auth session).
- Push pipeline is real, not scaffolding: `supabase/functions/send-push/index.ts`.

---

## Milestone 0 — Launch Blockers

**Goal:** a signed production build that installs on real iOS+Android devices, is legally compliant, and clears store review. **~2–4 weeks.**

### Legal & Privacy

| Task                                                                                                                                                                                                                         | Sev     | Effort |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | ------ |
| Write **Privacy Policy + Terms/EULA** (collects precise location + photos + account); host; link from `app/settings.tsx` + both store listings. EULA must include a zero-tolerance objectionable-content clause (UGC).       | blocker | M      |
| Add **in-app account deletion**: a `delete-account` Edge Function (service_role) that deletes the `auth.users` row (cascades to profile + all data) + a Settings UI action with confirm. **Confirmed missing today.**        | blocker | M      |
| Complete **App Store Privacy Labels** + **Play Data Safety** (location, photos, account, identifiers).                                                                                                                       | blocker | S      |
| ~~Surface the existing **block-user** action in the sighting/profile UI~~ — done (`app/blocked-users.tsx`, sighting detail block action, Settings link). Document the 24h moderation-response process (Apple Guideline 1.2). | high    | S      |

### Secrets, Keys & Release Pipeline

| Task                                                                                                                                                                                               | Sev     | Effort |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | ------ |
| Create **real Google Maps keys** and **restrict** them (iOS bundle id; Android package + SHA-1). Map is on placeholders today.                                                                     | blocker | S      |
| Move `EXPO_PUBLIC_*` + Maps keys into **EAS env vars/secrets**.                                                                                                                                    | blocker | S      |
| Confirm **no `service_role` key** is committed; rotate the Supabase anon key if it ever was (the `sb_publishable_…` key is RLS-safe, rotate to be clean).                                          | high    | S      |
| Wire **EAS production build** + credentials + **`eas submit`**; create App Store Connect + Play Console apps; produce a **signed internal build** and smoke-test Maps/camera/push on real devices. | blocker | M      |
| Final store-quality **app icon / screenshots / listing copy**.                                                                                                                                     | high    | S      |

### Backend Go-Live

| Task                                                                                    | Sev  | Effort |
| --------------------------------------------------------------------------------------- | ---- | ------ |
| Turn **email confirmation ON** + configure a real **SMTP sender** in Supabase.          | high | S      |
| Enable **backups / Point-in-Time Recovery**; decide prod-vs-dev Supabase project split. | high | S      |

**Exit:** signed prod build runs on iOS+Android with live Maps; Privacy Policy + ToS linked in-app; account deletion works end-to-end; store privacy forms complete; internal-testing build distributed.

---

## Milestone 1 — Operational Readiness

**Goal:** when production breaks, you find out and can debug + roll back. **~1–2 weeks, overlaps M0.**

| Task                                                                                                                                                                                                                                                                                                                           | Sev    | Effort | Notes                                                        |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------ | ------ | ------------------------------------------------------------ |
| ~~Install **`@sentry/react-native`** + Expo plugin; `Sentry.init` in `initObservability`.~~ Done — `npx expo install @sentry/react-native@7.11`, conditional plugin in `app.config.ts`, `observability.ts` wired, `.env.example` has DSN/Sentry vars.                                                                          | high   | M      | Needs real DSN + SENTRY_ORG/PROJECT + EAS auth token secret. |
| **Source-map / Hermes symbol upload** in the EAS prod build.                                                                                                                                                                                                                                                                   | high   | M      | Depends on Sentry. Otherwise stacks are unsymbolicated.      |
| ~~Harden **`send-push`**: log non-OK Expo responses + `tokens_near` errors; handle Expo **receipts**; reap **DeviceNotRegistered** tokens; remove the empty `catch` in `src/api/push.ts`.~~ Done — send-push dual-auth (JWT + webhook secret), logging, ticket inspection, token reaping, deprecation note in client push API. | medium | M      |                                                              |
| Wire **`track()` → analytics** (e.g. PostHog).                                                                                                                                                                                                                                                                                 | medium | M      | 4 funnel events already emitted, currently discarded.        |
| Add **`expo-updates`** + `runtimeVersion` + channel mapping for OTA rollback.                                                                                                                                                                                                                                                  | medium | M      | No hot-fix path today.                                       |
| 1 **Sentry alert rule** + a Supabase/edge **uptime check**; "who gets paged" note.                                                                                                                                                                                                                                             | medium | S      |                                                              |

**Exit:** a forced test crash appears **symbolicated** in Sentry from a release build; push failures log/alert; funnel events land in analytics; an OTA update reaches the preview channel.

---

## Milestone 2 — Quality Gates & Test Safety Net

**Goal:** changes can't silently break the funnel, the security invariants, or the bundle. **~1–2 weeks.**

| Task                                                                                                                                                                                                | Sev    | Effort |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ------ |
| ~~Add **ESLint + `eslint-config-expo`** (+ Prettier); `lint` script; CI lint step.~~ Done. `react-hooks/exhaustive-deps` not yet enabled — defer to a focused lint cleanup PR.                      | high   | M      |
| **API-client tests**: mock `@/lib/supabase`, assert each of the 12 RPC wrappers sends correctly-named args (catches drift vs migrations).                                                           | high   | L      |
| ~~**pgTAP RLS/RPC suite**: 114 tests across 9 suites (location privacy, write guards, redeem guard, lifecycle, moderation, AI KB, lost cat, re-id, push ranking); `supabase db test` in CI.~~ Done. | high   | M      |
| Broaden `testMatch` to `.tsx` + `tsconfig.test.json` include; add 2–3 RNTL screen tests.                                                                                                            | medium | M      |
| ~~`deno check` + lint + 1 unit test for `send-push`.~~ Done — CI widened to `*/index.ts` + full `deno lint`; send-push unit test added.                                                             | medium | S      |
| One **Maestro E2E** happy-path (sign-up → report → claim → rescue → adopt), **or** delete the false `.maestro/` reference in `jest.config.js`.                                                      | medium | M      |
| Add **`expo export` bundle job** + scoped coverage gate to CI.                                                                                                                                      | medium | M      |

**Exit:** every PR runs lint + typecheck + unit + API + pgTAP + bundle; one green E2E flow.

---

## Milestone 3 — Performance, Accessibility & Polish

**Goal:** ready to scale and pass an accessibility bar. **~1–2 weeks.**

| Task                                                                                                                                                                | Sev    | Effort |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ------ |
| **Image resizing/thumbnails** via Supabase image transforms / CDN; cap upload size.                                                                                 | medium | M      |
| ~~**Reduce-motion** support for Reanimated entrances; a11y sweep (labels/roles/state).~~ Done — ~70 animations gated across 20+ files; 31+ a11y labels/roles added. | medium | M      |
| Tune React Query `staleTime`/`gcTime`/refetch (placeholder.ts still in use — not dead).                                                                             | low    | S      |
| Resolve `userInterfaceStyle: 'automatic'` vs light-only theme (ship a dark theme or pin light).                                                                     | low    | S      |

**Exit:** images served resized; reduce-motion respected; a11y pass on core flows.

---

## Sequencing

```
M0 (legal + keys + native config + release pipeline)  ──►  SUBMIT
   └─ M1 (Sentry, push hardening, OTA)   ── parallel from week 1
        └─ M2 (lint, tests, pgTAP, CI gates)
             └─ M3 (perf, a11y, polish)  ── before public GA / scale
```

Start **M0 + M1 together** — Sentry should be live before the first TestFlight build. **M2** protects everything post-launch.

## Top risks

1. Legal/store rejection (no privacy policy, no account deletion, incomplete privacy labels) — most likely to bounce a submission.
2. Launching without Sentry — blind to crashes during the riskiest window.
3. Silent push failures + unbounded dead-token growth.
4. Argument-name drift between the API wrappers / `send-push` and the migrations — untested, and `tsc` won't catch it.

## Post-launch backlog (not milestones)

Dark mode · Apple/Google social sign-in · in-app chat · rescue-activity heatmap · guardian on-duty radius alerts · i18n/localization (strings hardcoded English; distance mi-only) · generated Supabase types.
