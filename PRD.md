# PRD — Guardians v1.0 Public Launch

|                    |                                                                                                                                                                        |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Product**        | Guardians — community cat-rescue platform (iOS + Android, Expo)                                                                                                        |
| **Doc status**     | Draft v1 · 2026-07-03                                                                                                                                                  |
| **Owner**          | Rafayet Quader                                                                                                                                                         |
| **Companion docs** | [`ROADMAP.md`](./ROADMAP.md) (engineering milestones) · [`PRODUCTION.md`](./PRODUCTION.md) (ops checklist) · [`AI_ROADMAP.md`](./AI_ROADMAP.md) (post-launch AI track) |

---

## 1. Problem & Vision

Every day cats are lost, injured, or abandoned, and the people who spot them have no
structured way to get help. **Guardians** turns a neighbourhood into a rescue network:
anyone can report a sighting on a live map, nearby **Guardians** claim and complete the
rescue, and **Adopters** give the cat a home. A points/levels/badges economy makes doing
good habit-forming.

**v1.0 goal:** ship a store-approved, safe, observable app that a first cohort of real
users can rely on for the full loop — _report → claim → rescue → adopt_ — without the
team flying blind.

## 2. Users

| Persona                | Core job                                 | Must-haves at launch                                             |
| ---------------------- | ---------------------------------------- | ---------------------------------------------------------------- |
| **Reporter** (anyone)  | "I found a cat that needs help"          | 2-minute report with photo + pin; confidence someone was alerted |
| **Guardian** (rescuer) | "Alert me when a cat near me needs help" | Urgent push within ~8 km; claim flow; status updates             |
| **Adopter**            | "Help me find a cat to adopt"            | Adoptable filter; express interest; get approved                 |
| **Moderator**          | "Keep the platform safe"                 | Report queue, hide/restore, block flow (exists)                  |

## 3. Where the product stands (verified 2026-07-03)

**Shipped and verified working:**

- Full rescue lifecycle on server-enforced state machine; RLS on every table; all
  sensitive writes via SECURITY DEFINER RPCs; location coarsened ~110 m for non-owners.
- Live map with clustering + 3-way draggable nearby sheet; gamification + rewards
  marketplace with double-spend protection; moderation (report/block/hide) end-to-end.
- **In-app account deletion live** (Apple hard requirement) — edge function deployed.
- **Self-hosted analytics live** — 4 funnel events land in `analytics_events`.
- Hardened urgent-push pipeline deployed (logging, ticket inspection, token reaping).
- Quality gates: typecheck, ESLint, Prettier, 49 unit/contract tests, pgTAP suite,
  bundle smoke test, Deno checks — all green in CI.
- DB advisors clean (search_path pinned, anon revoked, FK indexes, RLS initplan optimized).

**Sync note:** all of the above lives on the PR #5 branch + the live DB; merge PR #5 so
`main` matches production.

## 4. What still needs refining — requirements

### P0 — cannot submit to stores without these

| #    | Requirement                           | Acceptance criteria                                                                                                                                      | Owner-type                   |
| ---- | ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| P0-1 | **Privacy Policy + Terms/EULA**       | Hosted URLs; linked from Settings and both store listings; EULA has zero-tolerance UGC clause. _Today: zero privacy/terms links in-app._                 | Legal/content (AI-draftable) |
| P0-2 | **Store privacy disclosures**         | App Store Privacy Labels + Play Data Safety completed (precise location, photos, account id)                                                             | Founder                      |
| P0-3 | **Real, restricted Google Maps keys** | iOS key locked to bundle id; Android key to package+SHA-1; map renders Google tiles on both platforms                                                    | Founder                      |
| P0-4 | **Release pipeline**                  | EAS build profiles + secrets; signed builds install on real devices; `eas submit` reaches TestFlight + Play internal                                     | Founder + AI                 |
| P0-5 | **Crash visibility**                  | `@sentry/react-native` installed; DSN set; a forced release-build crash appears symbolicated in Sentry. _Init code already wired — package/DSN missing._ | Founder (DSN) + AI           |
| P0-6 | **Auth go-live config**               | Email confirmation ON with real SMTP; leaked-password protection ON; backups/PITR enabled                                                                | Founder (dashboard)          |

### P1 — first-cohort quality (ship within ~2 weeks of launch)

| #    | Requirement                  | Acceptance criteria                                                                                                                                                            |
| ---- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| P1-1 | **Permission priming**       | Value-explaining screen before each OS prompt (location, notifications, camera); grant-rate tracked via analytics. _Today: cold `requestForegroundPermissionsAsync` on mount._ |
| P1-2 | **Accessibility pass**       | Every interactive element has `accessibilityLabel`/`role` (today: 8 total app-wide); contrast ≥ 4.5:1; targets ≥ 44 pt; VoiceOver walk of the core loop                        |
| P1-3 | **Reduce-motion everywhere** | The 16 entrance-animated screens respect `useReducedMotion` (today: welcome only)                                                                                              |
| P1-4 | **Lifecycle push events**    | Reporter notified on claim/rescue; guardian notified on adoption interest — not just the urgent broadcast                                                                      |
| P1-5 | **OTA hot-fix path proven**  | `eas update` to preview channel verified on a physical build (expo-updates already wired)                                                                                      |
| P1-6 | **First-run guidance**       | 3-card "Spot → Claim → Rehome" explainer + role nudge post-signup; empty-map state with CTA                                                                                    |
| P1-7 | **E2E safety net**           | One Maestro flow: sign-up → report → claim → rescue, running in CI                                                                                                             |

### P2 — retention & scale (post-launch backlog)

Realtime timeline (Supabase Realtime, replacing refetch) · in-app notification center ·
coordination chat · image thumbnails/CDN (needs paid plan) · dark mode (second palette +
dynamic theming) · i18n + km/mi · richer profiles & shareable rescue cards · streaks/local
leaderboards.

**AI integration** (photo-based report autofill, automated photo/text moderation,
duplicate-cat detection, lost-cat reunification, a grounded rescue copilot) has its own
milestone-by-milestone plan in [`AI_ROADMAP.md`](./AI_ROADMAP.md) rather than a single
backlog line — it's a distinct track with its own sequencing, guardrails, and
specialized-agent delegation model.

## 5. Non-functional requirements

- **Security/privacy:** no precise coordinates to non-owners (enforced, keep pgTAP green);
  no `service_role` in client; sessions encrypted at rest (done).
- **Performance:** map pan → results < 1.5 s p95 on LTE; cold start < 3 s on mid-range
  Android; bundle job stays green.
- **Reliability:** crash-free sessions ≥ 99.5 %; push delivery failures alerted within 15 min.
- **Observability:** every release symbolicated in Sentry; funnel events queryable in
  `analytics_events`; one alert rule + a named on-call human.

## 6. Success metrics (first 90 days)

| Metric                                      | Target            |
| ------------------------------------------- | ----------------- |
| Activation: install → first report or claim | ≥ 25 %            |
| Rescue completion: spotted → safe           | ≥ 40 % of claimed |
| Urgent alert → first claim latency (median) | < 60 min          |
| Week-4 retention (Guardians)                | ≥ 20 %            |
| Crash-free sessions                         | ≥ 99.5 %          |
| Store rating                                | ≥ 4.3             |

## 7. Release plan

1. **RC-0 (now):** merge PR #5 → main is production-truth.
2. **RC-1 (wk 1–2):** P0-1…P0-6 → signed internal builds on TestFlight/Play internal.
3. **Beta (wk 3–4):** 20–50 user cohort; P1-1…P1-7 land; watch Sentry + funnel daily.
4. **v1.0 GA:** store review submission once beta is crash-clean for 7 days.

## 8. Risks

| Risk                                            | Mitigation                                                                    |
| ----------------------------------------------- | ----------------------------------------------------------------------------- |
| Store rejection (privacy/UGC)                   | P0-1/P0-2 first; account deletion + block/report already live                 |
| Empty-marketplace cold start                    | Seed one launch neighbourhood; first-run guidance (P1-6); "be the first" CTAs |
| Silent failure in the safety-critical push path | Hardened + logged (done); add alert rule (P0-5/NFR)                           |
| Solo-maintainer bus factor                      | CI gates + pgTAP keep regressions visible; ROADMAP/PRODUCTION docs current    |

## 9. Out of scope for v1.0

Web app as a product surface (dev-preview only) · social sign-in · multi-species ·
donations/payments · shelter/org accounts.
