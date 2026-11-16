# Guardians 2.0 — Product Requirements Document (Revamp)

| Field         | Value                                                                                                                                                          |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Status        | Draft for owner review                                                                                                                                         |
| Version       | 2.0-draft-1                                                                                                                                                    |
| Date          | 2026-11-15                                                                                                                                                     |
| Owner         | Rafayet Quader                                                                                                                                                 |
| Supersedes    | `PRD.md` (v1.0 Public Launch, 2026-07-03). That document remains as history; where the two disagree, this one governs.                                         |
| Inputs        | Repository at `feat/product-refinement` (`732ff6d`), GitHub `rafayet601/Guardians`, the live Supabase project (read-only), existing review docs, a market scan |
| Audience      | The owner, any engineer or agent implementing the work, and prospective rescue-organisation partners                                                           |
| Reading order | Sections 1–3 for the verdict, 4 for the market, 7 for what to build, 10 for the order to build it in, 13 for the decisions only the owner can make             |

Requirement language follows RFC 2119: **MUST** is a release gate, **SHOULD** is expected unless
a written reason says otherwise, **MAY** is optional. Priorities: **P0** blocks the pilot, **P1**
is required to prove the loop, **P2** differentiates once the loop is proven.

---

## 1. Executive summary

Guardians is a well-engineered product that has never met a user. The codebase holds roughly
22,000 lines of application code, 41 database migrations, 15 edge functions, ten AI features, a
points economy, a rewards marketplace and an adopter screening pipeline. It has no store
release, no run on a physical device, no production traffic, and a live backend that has
drifted from the repository.

The engineering underneath is better than most products at this stage: row-level security
everywhere, sensitive writes confined to `SECURITY DEFINER` functions, location coarsened for
non-owners, and four layers of automated tests. That foundation is worth keeping.

The product on top of it has four structural problems.

1. **It is not shipped, and the release path is not yet true.** The working tree fails its own
   typecheck and security audit, `main` is unprotected, there is no staging environment, and
   every live edge function predates the last security-hardening merge.
2. **The core loop can stall silently.** A claim never expires on the server, an urgent alert
   fires once and is never repeated or widened, nothing updates in real time, and there is no
   notification inbox. A cat can sit "claimed" forever while nobody is coming.
3. **The domain model is wrong for most of the cats it will meet.** Every case is pushed toward
   adoption or the archive. For a healthy, unsocialised community cat the appropriate outcome
   is trap–neuter–return, and for a lost pet it is reunion. Neither exists as an outcome.
4. **It has no distribution.** Nothing can be shared outside the app, there is no public web
   surface, and there is nothing for the rescue organisations that already do this work.

The opportunity is real. No product in the market closes the whole loop for cats: lost-pet
tools stop at a photo match, colony tools count cats rather than dispatch help, adoption sites
begin at the shelter door, and shelter software is internal to one organisation. Guardians is
the only one built around **a sighting leading to a named responder and a verified outcome**.

**The instruction of this document is to narrow, ship, and prove — in that order.** Stop adding
breadth. Make the release path true. Put the app in the hands of responders in one service
area. Fix the outcome model so the product is correct for community cats. Build the share and
partner surfaces that give it reach. Turn on AI only where measurement says it earns its cost.

Success is one number: **verified cats reaching an appropriate care outcome per week** in the
pilot area, with a median time from sighting to first human response under 30 minutes for
urgent cases.

---

## 2. Mission, north star, and the quality bar

**Mission.** Every cat seen in distress or without a home gets a responsible human response and
ends up somewhere appropriate: home, a new home, or back in a managed colony, sterilised.

**North-star metric.** Verified cats reaching an appropriate care outcome per week. "Verified"
means a second party or evidence confirms it (section 7, R2.6). "Appropriate" means one of:
made safe, returned after sterilisation, reunited with an owner, transferred to a partner, or
adopted.

**What "best in class" means here.** Not the longest feature list. It means being the best at
three things no competitor does together:

| Promise                                      | Measured by                                                |
| -------------------------------------------- | ---------------------------------------------------------- |
| A report always gets a response or an answer | Response coverage within 24 h; zero silently stalled cases |
| The outcome is right for the cat             | Share of closed cases with a verified, appropriate outcome |
| Anyone can help in under a minute            | Time to submit a report; share-to-action conversion        |

Everything else in this document either serves those three or is deferred.

---

## 3. Current state assessment

Facts in this section were inspected directly for this review unless marked otherwise.

### 3.1 What is strong and must be preserved

| Strength                  | Evidence                                                                                                                                                        |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Security architecture     | RLS on all tables; points and status written only through `SECURITY DEFINER` RPCs; rate-limit windows; block and abuse-report model; security review 2026-10-01 |
| Location privacy          | Exact coordinates reach only the reporter and assigned Guardian; everyone else gets ~110 m coarsening via `get_sighting_detail`                                 |
| Test depth                | Jest 43 suites / 411 tests; Playwright 35 tests; 15 pgTAP files plus 2 concurrency harnesses; 19 Deno tests; 4 CI jobs                                          |
| A complete adoption loop  | Interest, screening, moderator review, approve, decline and withdraw all exist end to end                                                                       |
| A coherent design system  | Tokens in `src/theme`, UI primitives behind one barrel, documented in `DESIGN.md`                                                                               |
| Disciplined AI principles | Server-side only, human confirms, no diagnosis, grounded retrieval, disclosed, cheap by default (`AI_ROADMAP.md`)                                               |
| An honest launch thesis   | `docs/business/LAUNCH_REVIEW.md` already argues for one service area and responders before reporters                                                            |

### 3.2 Shortfalls

**A. Release truth**

| #   | Shortfall                                    | Evidence                                                                                                                                  |
| --- | -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| A1  | Never shipped                                | No GitHub release, no store submission, no physical-device run (`docs/release/READINESS_2026-10-05.md`)                                   |
| A2  | Working tree does not pass its own gates     | `npm run typecheck` fails in `SupportPage.tsx`; `npm run audit:production` fails on a critical `shell-quote` advisory                     |
| A3  | Large unlanded change set                    | 39 modified and 19 untracked paths; 20 local commits not pushed; a merge dropped a build script                                           |
| A4  | `main` is unprotected                        | No branch protection, no required checks                                                                                                  |
| A5  | Live backend has drifted from the repository | All 15 live edge functions predate the 2026-10-02 security-hardening merge; live status of migrations `0039`–`0041` could not be verified |
| A6  | No staging environment                       | One Supabase project serves as both test bed and production                                                                               |
| A7  | Release configuration incomplete             | Support URL and Android Maps key unset; Sentry DSN empty; email confirmation not required on the live project (as of 2026-10-05)          |
| A8  | No native end-to-end tests                   | Playwright runs on mobile web against a mocked backend; no Maestro or device tests                                                        |

**B. Loop reliability**

| #   | Shortfall                         | Evidence                                                                                       |
| --- | --------------------------------- | ---------------------------------------------------------------------------------------------- |
| B1  | Claims never expire on the server | `CLAIM_STALE_HOURS = 24` is a client-side label only; no scheduled jobs exist in any migration |
| B2  | Urgent alerts are one-shot        | No re-alert, no radius widening, no escalation path                                            |
| B3  | No user control over alerts       | No home area, radius, alert types or quiet hours in settings                                   |
| B4  | No notification inbox             | A missed push is lost                                                                          |
| B5  | No real-time updates              | No Supabase Realtime usage anywhere in `app/` or `src/`                                        |
| B6  | Weak offline behaviour            | Only a report draft; no connectivity awareness or submit queue                                 |
| B7  | Lost-cat posts never close        | Nothing auto-expires or prompts renewal                                                        |

**C. Domain correctness**

| #   | Shortfall                                       | Evidence                                                                                  |
| --- | ----------------------------------------------- | ----------------------------------------------------------------------------------------- |
| C1  | No trap–neuter–return outcome                   | `CatStatus` ends in `adopted` or `archived` only                                          |
| C2  | No reunited-with-owner outcome                  | Lost-cat matching exists but the sighting cannot close as "reunited"                      |
| C3  | No ear-tip, collar, microchip or age attributes | These appear only in the knowledge-base content, not in the data model or the report form |
| C4  | No colony concept                               | Repeat sightings at one site are unrelated rows                                           |
| C5  | Outcomes are self-declared                      | Status changes need no evidence or second party                                           |

**D. Reach**

| #   | Shortfall                               | Evidence                                                                                |
| --- | --------------------------------------- | --------------------------------------------------------------------------------------- |
| D1  | Nothing can be shared                   | No share sheet, no public page, no flyer                                                |
| D2  | No public web surface                   | Web build is a placeholder; v1.0 scoped web out                                         |
| D3  | High-friction sign-up                   | Email and password only; Google and Apple sign-in disabled                              |
| D4  | No expectation-setting outside coverage | A report made where no Guardian exists looks identical to one made where help is nearby |

**E. Partners and operations**

| #   | Shortfall                                | Evidence                                                           |
| --- | ---------------------------------------- | ------------------------------------------------------------------ |
| E1  | No organisation accounts                 | `Profile` has individual flags only                                |
| E2  | No operator scorecard                    | About 32 analytics events are collected; nothing reads them        |
| E3  | Moderation has no owner or SLA           | Listed as outstanding in the readiness review                      |
| E4  | Screening depends on one manual reviewer | ID verification is manual; no provider integrated; no decision SLA |

**F. Trust and economy**

| #   | Shortfall                                       | Evidence                                                                                            |
| --- | ----------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| F1  | Rewards marketplace advertises fictional brands | `0008_seed_rewards.sql` seeds invented brands with `example.com` links                              |
| F2  | Demo cats share identifiers with seed data      | Five stable demo IDs in `src/utils/demoSightings.ts` match `supabase/seed.sql`                      |
| F3  | Points can be earned without verification       | A user can report, claim and complete their own sighting                                            |
| F4  | No automated retention for identity documents   | No scheduled jobs exist, so no time-based purge (inferred; deletion on account removal is separate) |
| F5  | No private channel after adoption approval      | Adopter and lister have no in-app way to arrange handover                                           |

**G. Experience and platform quality**

| #   | Shortfall                              | Evidence                                                                                         |
| --- | -------------------------------------- | ------------------------------------------------------------------------------------------------ |
| G1  | Oversized screens                      | `sighting/[id].tsx` 1,248 lines; `report.tsx` 830; `lost-cat.tsx` 768; `adopt/screening.tsx` 655 |
| G2  | No thumbnails                          | Lists load the full upload (up to 1,600 px on the long side)                                     |
| G3  | No dark mode, no localisation, km only | No colour-scheme handling, no i18n library, distances formatted in metres and kilometres only    |
| G4  | Hidden navigation                      | Leaderboard and Rewards tabs exist but are unreachable from the tab bar                          |
| G5  | Type-safety gaps at the data boundary  | 18 `as unknown as` casts in `src/api`                                                            |
| G6  | Documentation sprawl                   | 13 Markdown documents at the repository root, several overlapping or stale                       |

**H. AI**

| #   | Shortfall                       | Evidence                                                                                            |
| --- | ------------------------------- | --------------------------------------------------------------------------------------------------- |
| H1  | Ten features built, none active | Every flag inherits one build-time variable that defaults to off; provider keys recorded as pending |
| H2  | No runtime kill switch          | Turning a feature off requires a new build                                                          |
| H3  | No evaluation evidence          | No labelled set or acceptance threshold for any feature                                             |

---

## 4. Market and competitive landscape

### 4.1 Size of the problem

- Humane World for Animals estimates 30–40 million community cats in the United States.
- Shelter Animals Count reports 5.8 million dogs and cats entered US shelters and rescues in
  2025, about 3 million of them cats.
- A targeted trap–neuter–return programme cited by Best Friends reduced shelter cat euthanasia
  by 83% and cat intake by 32% in its study area. Sterilise-and-return is the intervention with
  the strongest evidence, which is why its absence from the product (C1) matters.

### 4.2 Competitors

Vendor-reported figures are marked as such and have not been independently verified.

| Product                 | Core job                              | What it does well                                                                                            | Where it stops                                                          |
| ----------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| Petco Love Lost         | Reunite lost pets by photo            | Free; ingests shelter intake and neighbourhood posts; vendor reports the correct match first 88% of the time | Ends at a match. No responder, no field rescue, no community cats       |
| PawBoost                | Lost and found alerts                 | Social amplification; large alert network                                                                    | A notice board. No ownership of the case, no outcome                    |
| Ring Search Party       | Find lost dogs through camera network | Hardware reach; vendor reports 99 dogs reunited in three months                                              | Dogs only at launch; cats described as planned                          |
| Nextdoor                | Neighbourhood posts                   | Existing local audience                                                                                      | Unstructured; no status, no accountability, no privacy for cat location |
| Cat Stats               | Colony tracking for TNR groups        | Free; colony map coloured by sterilisation progress                                                          | Tracks colonies, not cases; no public reporting or dispatch             |
| Whisker Tracker         | Log and identify neighbourhood cats   | Facial recognition; sighting catalogue; points, badges and leaderboards                                      | Citizen science and collection. No rescue workflow                      |
| Doobert                 | Volunteer transport and fostering     | Splits a transport into legs; foster recruitment; volunteer directory                                        | Starts once an organisation already has the animal                      |
| Petfinder / Adopt-a-Pet | Adoption listings                     | Search reach; alerts for new pets; match quiz                                                                | Listings come from shelters; individuals are sent elsewhere             |
| Shelterluv / Pawlytics  | Shelter and rescue management         | Intake, medical, foster, contracts; priced per adoption or low monthly tiers                                 | Internal to one organisation; no public intake from the street          |

### 4.3 Capability comparison

| Capability                                | Guardians today       | Best available            | Target                                          |
| ----------------------------------------- | --------------------- | ------------------------- | ----------------------------------------------- |
| Available to the public                   | No                    | All competitors           | Pilot build, then public release                |
| Structured sighting with private location | Built                 | Whisker Tracker (logging) | Keep; add triage                                |
| Named responder with accountability       | Built, without expiry | None for field rescue     | **Lead** — leases, escalation, verified outcome |
| TNR and colony tracking                   | Absent                | Cat Stats                 | Minimal colony model; integrate, do not rebuild |
| Lost-pet photo matching                   | Built, switched off   | Petco Love Lost           | Do not compete on scale; cross-post and defer   |
| Shareable alerts and flyers               | Absent                | PawBoost                  | Parity                                          |
| Adoption reach                            | In-app only           | Petfinder                 | Public pages; partner hand-off for listings     |
| Organisation tools                        | Absent                | Shelterluv, Doobert       | A partner seat and export, not a shelter CMS    |
| Motivation mechanics                      | Built                 | Whisker Tracker           | Keep, tied to verified outcomes only            |
| Public web presence                       | Placeholder           | All competitors           | Read-only share pages and report intake         |

### 4.4 Positioning

> **Guardians is the response network for cats in need.** Report a cat in under a minute; a
> named local responder takes ownership; the cat reaches the right outcome and you see it happen.

Guardians does not try to be the largest lost-pet database, a shelter management system, or a
colony census. It connects the public to responders and holds the case until it is resolved,
and hands off to those other systems at the edges.

### 4.5 Lessons from community-alert products

Citizen and Waze show the failure modes of location alerts: fatigue from volume, and loss of
trust from unverified reports. Their mitigations are user-set radius and alert types, community
confirmation before wide broadcast, and alerts that decay. Requirements R1.3, R1.4 and R2.5
adopt all three.

---

## 5. Users and their jobs

| User                 | Job to be done                                                                      | Today                                             | Must become                                                             |
| -------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------- | ----------------------------------------------------------------------- |
| Reporter             | "I saw a cat that needs help. Tell someone who can act, and tell me what happened." | Can report; hears little afterwards               | Report in under 60 s without an account wall; updated at every step     |
| Guardian (responder) | "Tell me about cats I can actually help, near me, when I am available."             | One-shot push; no preferences; claim never lapses | Controlled alerts, clear ownership, guidance, and release without shame |
| Colony caretaker     | "Track my colony and get help sterilising it."                                      | Not served                                        | Colony record, sterilisation progress, link to a TNR partner            |
| Lost-cat owner       | "Find my cat. Get as many eyes on it as possible."                                  | Can post; cannot share outside the app            | Shareable page and flyer, match alerts, cross-posting guidance          |
| Adopter              | "Give a cat a home through a process I can trust."                                  | Complete flow; no handover channel                | Screening with a decision deadline, private handover, follow-up         |
| Partner organisation | "See cases in our area and take the ones we can handle."                            | Not served                                        | Verified org account, service area, case queue, export                  |
| Moderator / operator | "Keep the network safe and know whether it is working."                             | Moderation queue; no metrics                      | Scorecard, SLAs, anomaly flags                                          |

---

## 6. Product principles

1. **A report is a promise.** Every report ends in a response or an honest explanation. Silence
   is a defect.
2. **The right outcome, not the cute one.** Adoption is one outcome among several. The product
   never implies a healthy community cat should be removed.
3. **Ownership is a lease.** A claim must be kept alive by action or it returns to the pool.
4. **Verified beats claimed.** Points, metrics and public numbers count only what a second
   party or evidence supports.
5. **Earn every notification.** Each push must be relevant, actionable and within a budget the
   user controls.
6. **Protect the cat's location.** Precise locations of community cats and colonies are never
   public.
7. **Hand off at the edges.** Where another system does the job better, connect to it.
8. **Prove, then widen.** One service area with dense coverage before a second.
9. **Humans decide; AI drafts.** No automated action on a cat, a person or an account.

---

## 7. Requirements

Each requirement has an identifier, a priority, the requirement, and acceptance criteria. A
requirement is done only when it meets the definition of done in section 9.4.

### W0 — Release truth and engineering baseline

Nothing else in this document is credible until this workstream is complete.

**R0.1 Green working tree (P0).** The current branch MUST pass every gate and land on `main`
through a reviewed pull request.

- Fix the `supportMailto()` return type so `SupportPage.tsx` typechecks.
- Resolve every high and critical production advisory by an in-range upgrade, not a new
  exception.
- Keep the `build:web:production` script that merge `732ff6d` dropped.
- Run the database tests for migrations `0040` and `0041`.
- _Accepted when:_ typecheck, lint, format, unit, browser, edge-function, database and
  production-audit checks are all green in CI on the pull request.

**R0.2 Protect `main` (P0).** `main` MUST require a pull request and all four CI jobs, and
MUST reject force pushes. _Accepted when:_ the GitHub branch-protection API reports those rules.

**R0.3 Staging environment (P0).** A second Supabase project MUST exist. Every migration and
function goes to staging first, is verified, and only then goes to production. _Accepted when:_
`supabase/scripts/schema_assertions.sql` passes on both projects and the runbook documents the
promotion path.

**R0.4 Reconcile production with the repository (P0).** Production MUST match `main`.

- Inventory the live schema from `pg_catalog`, not the migration ledger. The ledger has been
  wrong before.
- Apply outstanding migrations one at a time, verifying after each. `supabase db push` MUST NOT
  be used.
- Redeploy all 15 edge functions from `main`.
- Every production change requires the owner's explicit approval at the time it is made.
- _Accepted when:_ a committed manifest records the git commit behind each deployed function
  and the highest applied migration, and the schema assertions pass.

**R0.5 Drift detection (P1).** A scheduled read-only job SHOULD compare production against the
manifest and fail loudly on any difference. _Accepted when:_ a deliberately introduced
difference on staging is reported within 24 hours.

**R0.6 Complete release configuration (P0).** Support URL, restricted Maps keys for both
platforms, Sentry DSN, transactional email (SMTP) and required email confirmation MUST be set.
_Accepted when:_ the production audit's release-configuration check passes for iOS and Android
and a test crash appears in Sentry with readable stack traces.

**R0.7 Physical-device acceptance (P0).** The full lifecycle MUST be executed by hand on at
least one iPhone and two Android phones, one of them low-end: report with photo, push received,
claim, status updates, adoption, account deletion. _Accepted when:_ a signed checklist with
device models and OS versions is committed under `docs/release/`.

**R0.8 Native end-to-end tests (P1).** Maestro flows covering the same lifecycle SHOULD run
nightly against a preview build. _Accepted when:_ a broken claim button fails the nightly run.

**R0.9 Store distribution (P0).** The pilot build MUST be available through TestFlight and the
Play internal track, with privacy labels, data-safety form and the account-deletion URL
complete. _Accepted when:_ a tester outside the team installs from each store channel.

**R0.10 Backup and recovery (P0).** Point-in-time recovery or daily backups MUST be enabled and
a restore MUST be rehearsed once on staging. _Accepted when:_ the rehearsal is written up with
the measured recovery time.

**R0.11 Documentation consolidation (P1).** The 13 root-level documents SHOULD reduce to
`README.md`, `AGENTS.md`, `CLAUDE.md` and a `docs/` tree with one owner per topic. Superseded
documents are marked as such at the top, not deleted. _Accepted when:_ no two documents state
conflicting status for the same thing.

### W1 — Response reliability

**R1.1 Claim lease and expiry (P0).** A claim MUST be a lease enforced by the server.

- A claim with no Guardian update for the lease period returns to `spotted`; the Guardian and
  the reporter are told why.
- The Guardian is warned before expiry and can extend with one tap.
- Release is always available and carries no penalty the first time.
- Expiry is written only by a `SECURITY DEFINER` function run from a scheduled job.
- _Accepted when:_ a pgTAP test proves an untouched claim is released at the lease boundary, an
  updated claim is not, and a concurrent update and expiry cannot both win.
- _Lease length is an owner decision (D1)._

**R1.2 Escalation ladder for unclaimed urgent cases (P0).** An urgent or injured report that
nobody claims MUST escalate rather than wait.

- Step 1: alert Guardians within the base radius.
- Step 2: after a set interval, widen the radius.
- Step 3: after a further interval, notify partner organisations covering the area and the
  operator.
- Step 4: tell the reporter what has happened and what they can do themselves, including local
  emergency veterinary and animal-control contacts.
- _Accepted when:_ each step is observable in a test with simulated time, and no Guardian
  receives the same case twice within one step.

**R1.3 Alert preferences (P0).** A Guardian MUST be able to set a home area, an alert radius,
which case types they want, quiet hours, and an on-duty switch. _Accepted when:_ a Guardian
outside the radius or inside quiet hours receives no push for a matching case, verified by test.

**R1.4 Alert budget (P1).** The system SHOULD cap urgent pushes per user per day, collapse
repeat alerts for the same cat, and stop alerting on cases that have aged out. _Accepted when:_
the notification opt-out rate is tracked and the cap is enforced server-side.

**R1.5 Notification inbox (P0).** Every push MUST also be recorded in an in-app inbox with
read state and a link to the case. _Accepted when:_ a user with push permission denied can
still see and act on every alert sent to them.

**R1.6 Live case updates (P1).** The case screen and the map SHOULD reflect status changes
without a manual refresh, using Supabase Realtime with polling as the fallback. _Accepted
when:_ two devices viewing one case show a status change within 5 seconds.

**R1.7 Scheduled-jobs foundation (P0).** A single documented mechanism for timed work MUST
exist (database scheduler or scheduled edge function), with every job idempotent, logged and
alerting on failure. R1.1, R1.2, R3.5 and R4.2 depend on it. _Accepted when:_ a job that
throws produces an alert and a rerun causes no duplicate effect.

**R1.8 Push delivery observability (P1).** Delivery receipts SHOULD be processed, dead tokens
pruned, and time from event to delivery recorded. _Accepted when:_ the scorecard shows p50 and
p95 delivery time.

**R1.9 Closed feedback loop for reporters (P0).** The reporter MUST be told at every state
change of their report, in the inbox and by push if enabled. _Accepted when:_ a test walks one
case through every transition and asserts one reporter notification for each.

**R1.10 Offline-tolerant reporting (P1).** A report with photos SHOULD queue when the device is
offline and submit on reconnection, with visible state. _Accepted when:_ a report made in
aeroplane mode is submitted exactly once after connectivity returns.

### W2 — Correct outcomes and domain model

**R2.1 Outcome taxonomy (P0).** The lifecycle MUST support these closing outcomes: `returned`
(sterilised and returned to its colony), `reunited` (with its owner), `transferred` (to a
partner organisation), `adopted`, and an archive with a required reason (not found, duplicate,
deceased, no action needed). Transitions remain RPC-only. _Accepted when:_ pgTAP covers every
legal and illegal transition and existing rows migrate without loss.

**R2.2 Triage at report time (P0).** The report form MUST ask a short set of observable
questions and set expectations from the answers: injured or in danger, kitten, ear-tipped,
wearing a collar, approachable. An ear-tipped healthy adult is logged as a sighting of a
managed cat, not dispatched as a rescue. _Accepted when:_ in usability testing, five of five
first-time users complete triage without help, and the form still submits in under 60 seconds.

**R2.3 Cat attributes (P1).** Cases SHOULD record ear-tip, collar, microchip-scan result, age
class and sterilisation status, each allowing "unknown". _Accepted when:_ the attributes are
editable by the assigned Guardian and visible on the case.

**R2.4 Colonies (P2).** A colony MAY be created as a named group with an approximate location,
caretakers, cat count and sterilised count, and sightings MAY be linked to it. Colony location
is never shown precisely to the public (principle 6). _Accepted when:_ a caretaker can see
sterilisation progress for a colony over time.

**R2.5 Duplicate prevention and community confirmation (P1).** When a new report is near a
recent open case with similar attributes, the reporter SHOULD be asked whether it is the same
cat, and a confirmation SHOULD attach to the existing case instead of creating a new one.
_Accepted when:_ the duplicate rate is measured and falls after release.

**R2.6 Verified outcomes (P0).** A closing outcome MUST carry evidence: a photo, or
confirmation by a second party (reporter, adopter, partner organisation or moderator). Only
verified outcomes count toward the north-star metric and outcome points. _Accepted when:_ an
unverified closure earns no outcome points and is excluded from the scorecard total.

**R2.7 One case per cat (P2).** Re-sightings of a known cat SHOULD roll up into one case
history. _Accepted when:_ a cat seen three times shows one timeline.

### W3 — Reach and reunion

**R3.1 Public share pages (P0).** Each open case, lost-cat post and adoptable cat MUST have a
read-only public web page with a preview image, coarsened location, no personal data, a link
into the app and a report-abuse link. This narrowly reverses the v1.0 decision to exclude web.
_Accepted when:_ a link pasted into a messaging app shows a correct preview and the page
exposes no field that RLS hides in the app.

**R3.2 Share actions (P0).** Every such screen MUST offer the native share sheet. Lost-cat
posts MUST also produce a printable flyer with a QR code. _Accepted when:_ share events and
resulting installs or reports are tracked end to end.

**R3.3 Deep links (P0).** Universal links and Android app links MUST open the right screen
when the app is installed and the public page when it is not. _Accepted when:_ verified on the
physical devices from R0.7.

**R3.4 Lower sign-up friction (P1).** Sign in with Apple and Google SHOULD be enabled, with
email confirmation required for email sign-up. If any third-party sign-in is offered on iOS,
Sign in with Apple is mandatory. _Accepted when:_ the install-to-first-report funnel is
measured before and after.

**R3.5 Lost-cat lifecycle (P1).** A lost-cat post SHOULD prompt the owner to renew or close at
30 days, close automatically without a response, and close as `reunited` with one tap.
_Accepted when:_ no lost-cat post older than 45 days is open without a renewal.

**R3.6 Cross-posting guidance (P1).** On creating a lost-cat post the owner SHOULD be guided to
also register with Petco Love Lost and local shelters. A data partnership MAY be explored; no
public API has been confirmed. _Accepted when:_ the guidance is shown and its use is tracked.

**R3.7 Report without installing (P2).** A minimal web report form MAY be offered from share
pages, with abuse controls equal to the app's. _Accepted when:_ web reports enter the same
queue and are distinguishable in analytics.

**R3.8 Coverage honesty (P0).** Outside an active service area, the app MUST say so before the
user reports, still accept the report, and show local resources. _Accepted when:_ no user in an
uncovered area is shown copy that implies a responder is coming.

### W4 — Adoption and handover

**R4.1 Private handover channel (P1).** After an adoption request is approved, the adopter and
lister SHOULD get a private in-app thread limited to that adoption, covered by block, report
and moderation, and closed a fixed period after handover. _Accepted when:_ neither party needs
to exchange a phone number to complete an adoption. _Scope is an owner decision (D2)._

**R4.2 Screening data minimisation (P0).** Identity documents MUST be deleted automatically a
fixed period after a decision, and reviewers MUST see only what the decision needs. _Accepted
when:_ a scheduled job removes expired documents, a test proves it, and the privacy policy
states the period.

**R4.3 Screening decision deadline (P1).** Every screening SHOULD receive a decision within 48
hours, with the applicant shown the queue state and the operator alerted to breaches.
_Accepted when:_ time to decision appears on the scorecard.

**R4.4 Adoption agreement (P1).** The adopter SHOULD acknowledge plain-language terms before
handover: sterilisation, indoor safety, and returning the cat to the rescuer rather than
abandoning it. _Accepted when:_ the acknowledgement is stored with the adoption record.

**R4.5 Post-adoption check-ins (P2).** The adopter MAY be prompted at 7 and 30 days; a
confirmation verifies the adoption for R2.6. _Accepted when:_ check-in response rate is tracked.

### W5 — Partners and operations

**R5.1 Organisation accounts (P1).** A rescue, TNR group or clinic SHOULD be able to hold a
verified organisation account with members, roles and a service area. Verification is manual
by the operator at first. _Accepted when:_ one pilot partner is onboarded without database
access by the engineer.

**R5.2 Organisation case queue (P1).** Members SHOULD see open cases in their service area,
assign a case to a member, and accept a transfer. _Accepted when:_ a `transferred` outcome can
be completed end to end with a partner.

**R5.3 Operator scorecard (P0).** One screen or dashboard MUST show, per week and per service
area: reports, response coverage, time to first response (median and p90), claim completion
and expiry rates, verified outcomes by type, active Guardians, moderation queue age, and alert
opt-outs. _Accepted when:_ the weekly pilot review is run from it without ad-hoc queries.

**R5.4 Moderation ownership and SLA (P0).** A named person MUST own moderation, with a 24-hour
response target for abuse reports and a documented escalation path. Store review guidelines
for user-generated content require this. _Accepted when:_ the owner and target are written in
`docs/` and queue age is on the scorecard.

**R5.5 Partner export (P2).** A partner MAY export its cases as CSV. _Accepted when:_ a partner
imports an export into its own system.

### W6 — Trust, safety and economy integrity

**R6.1 No fictional content in production (P0).** Invented reward brands and demo cats MUST
NOT exist in production data. Demonstration content appears only in a clearly labelled
tutorial and cannot be claimed or adopted. _Accepted when:_ an assertion in
`schema_assertions.sql` fails if seed identifiers exist in production. _See D4._

**R6.2 Hide the rewards marketplace until it is real (P0).** The marketplace MUST stay hidden
until at least one signed sponsor exists. The points and badges that motivate responders
remain. _Accepted when:_ no screen in the pilot build offers a reward that cannot be redeemed.

**R6.3 Points follow verified outcomes (P0).** Outcome points MUST be granted only on a
verified outcome (R2.6), with daily caps and anomaly flags to the moderator. _Accepted when:_
a pgTAP test shows a self-reported, self-claimed, self-closed case earns no outcome points
without verification. _See D3._

**R6.4 Verified identity before writing (P0).** Email confirmation MUST be required before a
user can report, claim or comment. _Accepted when:_ an unconfirmed account is refused by the
server, not just by the interface.

**R6.5 Responder trust tiers (P1).** Guardians SHOULD progress from new to trusted on verified
outcomes or a partner's endorsement, and injured or urgent cases SHOULD be offered to trusted
responders first. _Accepted when:_ the tier is computed server-side and visible on the profile.

**R6.6 Safety guidance in the flow (P0).** Claiming a case MUST show brief, sourced guidance:
do not trespass, do not handle an injured or feral cat bare-handed, when to call a
veterinarian or animal control. _Accepted when:_ the guidance is reviewed by a partner
organisation before the pilot.

**R6.7 Safety controls on every new surface (P0).** Block, report and moderation MUST cover
the handover thread, public pages and organisation features from their first release.
_Accepted when:_ each new surface has an RLS test for blocked and hidden content.

### W7 — Experience and platform quality

**R7.1 Decompose oversized screens (P1).** No screen file SHOULD exceed about 400 lines. The
case screen is split into sections, each with its own data hook and tests. _Accepted when:_
the four largest screens are under the limit with no behaviour change.

**R7.2 Image pipeline (P1).** Lists and map callouts SHOULD load thumbnails no wider than
about 400 px; full images load only on the case screen. _Accepted when:_ feed image transfer
falls by at least 70% on a cold load.

**R7.3 First-run experience (P0).** A new user MUST be asked how they want to help, shown why
location and notification permissions are needed before the system prompt, and told whether
their area is covered. _Accepted when:_ permission grant rates are measured and five of five
test users reach the map without help.

**R7.4 Navigation that reflects the mission (P1).** The tab bar SHOULD expose the things a
participant returns for: the map, their own cases and inbox, adoption, and profile.
Leaderboard and rewards are either reachable from the profile or removed. _Accepted when:_ no
shipped route is unreachable from the interface.

**R7.5 Accessibility (P1).** The app SHOULD meet WCAG 2.2 AA: labels on every control, dynamic
type, sufficient contrast and 44-point touch targets. _Accepted when:_ a screen-reader pass of
the lifecycle is recorded.

**R7.6 Units and localisation (P1).** Distances SHOULD follow the device locale (miles or
kilometres). All user-facing strings SHOULD be externalised, with English shipped first.
_Accepted when:_ a device set to a US locale shows miles.

**R7.7 Dark mode (P2).** The theme MAY provide a dark scheme through tokens alone. _Accepted
when:_ no screen hardcodes a colour.

**R7.8 Typed data boundary (P1).** RPC return types SHOULD be generated or declared so that
the 18 `as unknown as` casts in `src/api` are removed. _Accepted when:_ a schema change that
breaks a consumer fails the typecheck.

**R7.9 Performance budgets (P1).** Budgets in section 8 SHOULD be measured on the low-end
Android device from R0.7 and tracked per release.

### W8 — AI, activated on evidence

**R8.1 Runtime control (P0 before any activation).** Each AI feature MUST have a server-side
switch that takes effect without a new build. _Accepted when:_ a feature is turned off in
production and stops within one minute.

**R8.2 Activation order (P1).** Features SHOULD be enabled one at a time in this order: text
and photo moderation, report autofill, duplicate suggestion, lost-cat matching, rescue
copilot. Each must show benefit on the scorecard before the next is enabled.

**R8.3 Evaluation before activation (P1).** Each feature MUST have a labelled evaluation set
and a written acceptance threshold. _Accepted when:_ results are committed alongside the
feature's prompt and model version.

**R8.4 Cost ceilings (P1).** Per-user daily limits and a global monthly ceiling MUST be
enforced server-side using the existing usage table, with an alert at 80%. _Accepted when:_ a
test exceeding the limit is refused cleanly.

**R8.5 Model review (P1).** The pinned models (`claude-haiku-4-5`, `voyage-3`) SHOULD be
re-evaluated against current alternatives on the evaluation set before activation. _Accepted
when:_ the choice is recorded with its measured accuracy and cost.

**R8.6 Disclosure and human confirmation (P0 before any activation).** AI output MUST be
labelled, editable, and never applied without a person confirming it. _Accepted when:_ no AI
path writes to a case, account or moderation decision on its own.

---

## 8. Non-functional requirements

| Area            | Requirement                                                                                                                            |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Responsiveness  | Cold start under 3 s on a mid-tier Android phone; map pan and reload under 1.5 s at p95                                                |
| Reporting speed | Median time from opening the report form to submission under 60 s, with a photo                                                        |
| Alert latency   | Push delivered within 30 s of the report being saved, at p95                                                                           |
| Reliability     | Crash-free sessions at or above 99.5%; no report lost to connectivity                                                                  |
| Availability    | Backend availability target 99.5% during the pilot; scheduled jobs alert on failure                                                    |
| Recovery        | Recovery point 24 h or better; recovery time 4 h or better; restore rehearsed                                                          |
| Security        | No critical or high advisories in production dependencies; RLS test for every new table; secrets never in the client or repository     |
| Privacy         | Exact locations only to reporter and assigned responder; identity documents purged on schedule; account deletion completes server-side |
| Accessibility   | WCAG 2.2 AA on the lifecycle screens                                                                                                   |
| Cost            | Infrastructure and AI cost per verified outcome tracked from the first pilot week                                                      |

---

## 9. Engineering directives

### 9.1 Architecture decisions

1. **Keep the stack.** Expo, Supabase and React Query are adequate for the pilot and well
   beyond. No rewrite is justified.
2. **The database stays the authority.** State transitions, points, leases and escalation live
   in `SECURITY DEFINER` functions with pgTAP coverage. The client never decides.
3. **One mechanism for timed work** (R1.7). Do not scatter timers across clients and functions.
4. **One notification path.** Database event, queue, `send-push`, and the inbox table written
   in the same transaction as the event, so a failed push never loses the message.
5. **Public pages are a separate read path.** They read through views that expose only public
   columns, not through the authenticated API with a privileged key.
6. **Feature switches are server-side** for anything that may need to be turned off quickly.
7. **Every production change is a promotion** from staging with the owner's approval, recorded
   in the manifest.

### 9.2 Things to stop

Until the pilot exit criteria in section 10 are met, do not build: new AI features, rewards or
wallet extensions, new badge mechanics, a second city, a web application beyond R3.1 and R3.7,
or any species other than cats.

### 9.3 Repository conventions

Unchanged from `AGENTS.md`: theme tokens only, dialogs through `@/lib/dialog`, maps through
`@/components/PlatformMap`, data access through `src/api` and `src/hooks`, sensitive writes by
RPC only, and `npm run typecheck` before a change is called done.

### 9.4 Definition of done

A requirement is done when all of the following hold:

- Typecheck, lint, format, unit, browser, edge-function and database checks pass in CI.
- Every new table has RLS and an RLS test; every new RPC has pgTAP coverage including the
  refusal cases.
- The behaviour is covered by an analytics event and appears on the scorecard where relevant.
- Block, report and moderation cover any new user-generated surface.
- It has been exercised on staging, and on a physical device if it touches the interface.
- The relevant document under `docs/` is updated in the same pull request.

---

## 10. Delivery plan

Phases are sequenced by dependency and gated by exit criteria, not dates. The durations are
planning estimates for one engineer working with AI assistance, and are not commitments.

| Phase | Name             | Estimate | Scope                                                                                                                                               | Exit criteria                                                                                                              |
| ----- | ---------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| 0     | Make it true     | 2 weeks  | R0.1–R0.4, R0.6, R0.10, R6.1, R6.2, R6.4                                                                                                            | `main` green and protected; staging exists; production matches the manifest; no fictional content in production            |
| 1     | Make it reliable | 4 weeks  | R1.1–R1.3, R1.5, R1.7, R1.9, R5.3, R5.4, R6.3, R6.6, R7.3, R0.7, R0.9                                                                               | No case can stall silently (proven by tests); scorecard live; build installed from both store channels on physical devices |
| 2     | Make it correct  | 4 weeks  | R2.1, R2.2, R2.6, R3.1–R3.3, R3.8, R4.2, R6.7                                                                                                       | All five outcomes usable and verified; every case shareable; coverage honesty in place                                     |
| 3     | Prove it (pilot) | 8 weeks  | One service area with one or two partner organisations; R5.1, R5.2, R4.1, R4.3, R4.4, R1.4, R1.6, R1.8, R2.3, R2.5, R0.5, R0.8 as the pilot demands | Pilot thresholds in section 11 met for four consecutive weeks                                                              |
| 4     | Differentiate    | 12 weeks | W8 in order; R2.4, R2.7, R3.4–R3.7, R4.5, R5.5, R6.5, W7 remainder                                                                                  | Public store release; a second service area justified by scorecard data                                                    |

Phase 3 does not begin until responders are recruited. Recruit Guardians and at least one
partner organisation during phases 1 and 2; a pilot with reporters and no responders damages
trust that is expensive to rebuild.

---

## 11. Success metrics

### 11.1 Pilot thresholds (phase 3 exit)

| Metric                                          | Threshold                          |
| ----------------------------------------------- | ---------------------------------- |
| Response coverage (first human action in 24 h)  | At least 80% of reports            |
| Time to first response, urgent cases            | Median under 30 min; p90 under 4 h |
| Claimed cases reaching a verified outcome       | At least 50%                       |
| Claims ending by expiry                         | Under 15%                          |
| Reports stalled with no response or explanation | Zero                               |
| Guardian four-week retention                    | At least 30%                       |
| Crash-free sessions                             | At least 99.5%                     |
| Abuse reports handled within 24 h               | At least 95%                       |
| Notification opt-out among Guardians            | Under 10% per month                |

These are proposed starting values. There is no usage data yet, so they MUST be revisited after
the first two pilot weeks rather than treated as known-achievable.

### 11.2 Instrumentation required

- Events for every lifecycle transition, alert sent, alert opened, share, and share-driven
  arrival, including events before sign-in.
- Weekly roll-up views behind the scorecard (R5.3), partitioned by service area.
- Cost per verified outcome, combining infrastructure and AI usage.

---

## 12. Risks

| Risk                                                        | Likelihood | Impact | Mitigation                                                                                         |
| ----------------------------------------------------------- | ---------- | ------ | -------------------------------------------------------------------------------------------------- |
| Reports arrive before responders exist                      | High       | High   | Recruit responders first; coverage honesty (R3.8); invite-only pilot area                          |
| One person carries engineering, moderation and operations   | High       | High   | Scope discipline (9.2); partner organisations share moderation and verification; SLAs with alerts  |
| A responder or member of the public is hurt                 | Low        | High   | Safety guidance (R6.6); terms; trusted tier for injured cases; legal review before the pilot       |
| Precise cat or colony locations enable cruelty              | Low        | High   | Coarsening preserved; colonies never public; public pages tested against RLS                       |
| Alert fatigue drives responders away                        | Medium     | High   | Preferences and budgets (R1.3, R1.4); opt-out rate on the scorecard                                |
| An adoption goes badly                                      | Medium     | High   | Screening, agreement, check-ins, partner-mediated adoption where possible                          |
| Production drift recurs                                     | Medium     | High   | Staging, manifest, drift detection (R0.3–R0.5)                                                     |
| Store rejection on user-generated-content or deletion rules | Medium     | Medium | Moderation SLA, block and report on every surface, working deletion flow, tested before submission |
| A large competitor adds cats and dispatch                   | Medium     | Medium | Compete on local responder density and partner relationships, which do not transfer with a feature |
| AI cost or error damages trust                              | Low        | Medium | Off by default; runtime switch; evaluation and ceilings before activation                          |

---

## 13. Decisions required from the owner

Each has a recommendation. None has been decided by this document.

| ID  | Decision                                        | Recommendation                                                                                                     |
| --- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| D1  | Claim lease length                              | 24 h without an update for `claimed`, warning at 18 h, one-tap extension; 72 h for `in_rescue`                     |
| D2  | Handover channel after adoption approval        | In-app thread scoped to the adoption, moderated, closed 14 days after handover                                     |
| D3  | Points when the reporter rescues their own find | Allow it, since finders often are the rescuers, but grant outcome points only on verification                      |
| D4  | Demo cats                                       | Remove from production data; show only in a labelled tutorial                                                      |
| D5  | Urgent escalation timings                       | Widen the radius at 20 min unclaimed; notify partners and the operator at 60 min                                   |
| D6  | Pilot service area and first partner            | One dense urban area where a TNR or rescue group will commit to responding                                         |
| D7  | Reverse the v1.0 "no web" decision              | Yes, narrowly: read-only share pages now, report intake later                                                      |
| D8  | Rewards marketplace                             | Hide until one real sponsor is signed                                                                              |
| D9  | Social sign-in                                  | Enable Apple and Google in phase 4, with email confirmation required from phase 0                                  |
| D10 | Identity-document retention period              | Delete 30 days after a screening decision, subject to legal advice                                                 |
| D11 | Approval to reconcile production                | Needed before R0.4: migrations `0039`–`0041` and redeployment of all functions, each step approved when it is made |

---

## 14. Out of scope

- A shelter management system. Integrate with the ones partners already use.
- A national lost-pet database or competing with Petco Love Lost on match scale.
- Species other than cats.
- Donations, payments or any handling of money.
- Paywalls on reporting, alerts or adoption.
- A full web application.
- Medical advice or diagnosis, by people or by AI.

---

## 15. Assumptions and unknowns

- **Production migration state is unverified beyond `0038`.** The management API timed out
  twice during this review. R0.4 begins by establishing it.
- **There is no usage data.** Every threshold in section 11 is a proposal.
- **Competitor figures are vendor-reported** and were gathered from public sources in November
  2026; features and pricing may have changed.
- **AI provider keys** are recorded in project notes as pending; this was not re-checked.
- **Identity-document retention** (F4) is inferred from the absence of scheduled jobs.
- **Team size** is assumed to be one engineer. More people shorten the estimates in section 10
  but do not change the order.
- **Legal review** of terms, safety guidance, adoption agreement and retention has not happened
  and is assumed to be arranged by the owner before the pilot.

---

## Appendix A — Sources

Market and competitor information:

- Petco Love Lost: [Pet Age](https://www.petage.com/using-500-visual-markers-petco-love-lost-reunites-lost-pets-with-ai-technology/),
  [FOX19](https://www.fox19.com/2026/01/28/new-ai-technology-helps-reunite-lost-pets-with-owners-faster/?outputType=amp),
  [CB Insights](https://www.cbinsights.com/company/petco-love-lost/alternatives-competitors)
- PawBoost: [CB Insights comparison](https://www.cbinsights.com/compare/pawboost-vs-pethub)
- Ring Search Party: [PCWorld](https://www.pcworld.com/article/3049741/anyone-can-use-rings-ai-powered-pet-finder-now.html),
  [Technobezz](https://www.technobezz.com/news/amazon-says-rings-ai-feature-has-reunited-99-lost-dogs-since-november-launch),
  [Tom's Guide](https://www.tomsguide.com/home/home-security/rings-new-search-party-feature-can-help-you-find-your-lost-dog-heres-how-it-works)
- Cat Stats: [HumanePro](https://humanepro.org/magazine/articles/herding-cat-stats)
- Whisker Tracker: [press release](https://www.pr.com/press-release/965454),
  [App Store](https://apps.apple.com/us/app/id6651852332),
  [Product Hunt](https://www.producthunt.com/products/whisker-tracker-cat-facial-recognition/launches)
- Doobert: [features](https://doobert.com/organization-features), [FAQ](https://doobert.com/faq),
  [BizTimes](https://biztimes.com/doobert-builds-animal-rescue-network-online)
- Petfinder and Adopt-a-Pet: [App Store](https://apps.apple.com/app/id557228073),
  [Petfinder](https://www.petfinder.com/adopt-or-get-involved/),
  [Adopt-a-Pet alerts](https://www.adoptapet.com/blog/adoption/new-pet-alerts)
- Shelterluv and Pawlytics: [Capterra — Pawlytics](https://www.capterra.com/p/194354/Pawlytics/),
  [Capterra — Shelterluv](https://www.capterra.co.uk/software/179205/shelterluv)
- Community-alert products: [Contrary Research on Citizen](https://research.contrary.com/report/citizen),
  [iTechGuides on Waze](https://www.itechguides.com/how-wazes-community-reports-and-police-alerts-work/),
  [BGR on Waze](https://www.bgr.com/2259383/biggest-issues-with-waze-police-sighting-feature/)
- Market size and TNR evidence: [HumanePro — Pets by the numbers](https://humanepro.org/page/pets-numbers),
  [ASPCA — Shelter Animals Count 2025](https://www.aspca.org/about-us/press-releases/shelter-animals-count-releases-2025-annual-data-report-marking-10-years),
  [Best Friends — community cat programmes](https://bestfriends.org/pet-care-resources/issues/community-cat-programs-tnvr),
  [Alley Cat Rescue 2021 report](https://www.saveacat.org/uploads/4/8/4/1/48413975/acr-2021_cat_report.pdf)

Internal documents: `PRD.md`, `ROADMAP.md`, `AI_ROADMAP.md`, `PRODUCTION.md`,
`PRODUCTION_REVIEW.md`, `SECURITY_REVIEW.md`, `DESIGN.md`, `docs/business/LAUNCH_REVIEW.md`,
`docs/release/READINESS_2026-10-05.md`, `docs/qa/design-review-2026-10-01/README.md`.

## Appendix B — Requirement index by priority

| Priority | Requirements                                                                                                                                                                                  |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P0       | R0.1–R0.4, R0.6, R0.7, R0.9, R0.10, R1.1–R1.3, R1.5, R1.7, R1.9, R2.1, R2.2, R2.6, R3.1–R3.3, R3.8, R4.2, R5.3, R5.4, R6.1–R6.4, R6.6, R6.7, R7.3, and R8.1 and R8.6 before any AI activation |
| P1       | R0.5, R0.8, R0.11, R1.4, R1.6, R1.8, R1.10, R2.3, R2.5, R3.4–R3.6, R4.1, R4.3, R4.4, R5.1, R5.2, R6.5, R7.1, R7.2, R7.4–R7.6, R7.8, R7.9, R8.2–R8.5                                           |
| P2       | R2.4, R2.7, R3.7, R4.5, R5.5, R7.7                                                                                                                                                            |

## Appendix C — Glossary

| Term             | Meaning                                                                       |
| ---------------- | ----------------------------------------------------------------------------- |
| Community cat    | An unowned cat living outdoors, whether feral or friendly                     |
| TNR              | Trap–neuter–return: sterilise a community cat and return it to where it lives |
| Ear-tip          | The clipped tip of one ear that marks a cat as already sterilised             |
| Colony           | A group of community cats sharing a territory, usually with a caretaker       |
| Guardian         | A user who responds to reports                                                |
| Claim / lease    | A Guardian's time-limited ownership of a case                                 |
| Verified outcome | A closing outcome supported by evidence or a second party                     |
| Service area     | A geography where enough responders exist for a report to be answered         |
| Scorecard        | The operator's weekly view of whether the loop is working                     |

## Appendix D — Implementation status

Updated as requirements land. Section 3 records what was true when the review was done; this
appendix records what has changed since.

| Date       | Requirement | Status                  | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ---------- | ----------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-11-15 | R0.1        | Done locally, not in CI | Typecheck fixed. Production audit clean: `shell-quote`, `zod`, `node-forge`, `@expo/cli` and `decode-uri-component` upgraded in range, and the `node-forge` backport retired. Database tests for `0040` and `0041` now run and pass after two test corrections. The runbook lines listed in the earlier code review were not lost; they were replaced by a pointer to `EXPO_DEPLOYMENT.md`. Remaining: push and a green pull request. |
| 2026-11-15 | R0.1        | In review               | All four CI jobs pass on pull request 21, including the browser tests. Awaiting merge.                                                                                                                                                                                                                                                                                                                                                |
| 2026-11-15 | R0.2        | Done                    | `main` requires a pull request and the four CI jobs, applies to administrators, and rejects force pushes and deletion. Zero approving reviews are required while there is one maintainer.                                                                                                                                                                                                                                             |
| 2026-11-15 | D1, D5      | Decided                 | Owner accepted the recommended lease lengths and escalation timings. D4 and D8 remain open.                                                                                                                                                                                                                                                                                                                                           |
| 2026-11-15 | R1.7        | Built, not applied      | Migration `0042`: `pg_cron`, a run log, one runner for every job, an operator push when a healthy job starts failing, and a moderator health RPC. A human alert channel beyond push is still to do.                                                                                                                                                                                                                                   |
| 2026-11-15 | R1.1        | Built, not applied      | Claims are leases (24 h, 72 h in rescue), renewed by the Guardian's comments and photos, extended with one tap inside a 6 h warning window, and released by a scheduled job. pgTAP covers the boundary; a concurrency check races lapse against renewal.                                                                                                                                                                              |
| 2026-11-15 | R1.2        | Built, not applied      | Wider ring at 20 min, moderators and reporter at 60 min, once per step. A reopened urgent report gets a fresh base alert, twice at most. Partner organisations join step 3 when R5.1 exists. Local emergency contacts are generic text until a directory exists.                                                                                                                                                                      |
