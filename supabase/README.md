# Supabase backend — Guardians

This folder holds the database schema, security policies, geo functions, and
gamification engine that power Guardians.

## Layout

| File                                                | Purpose                                                                                                                                                      |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `migrations/0001_init.sql`                          | Extensions (PostGIS), enums, tables, indexes                                                                                                                 |
| `migrations/0002_functions.sql`                     | Profile bootstrap, gamification, secure transition RPCs                                                                                                      |
| `migrations/0003_geo.sql`                           | `nearby_sightings()` radius search                                                                                                                           |
| `migrations/0004_rls.sql`                           | Row Level Security + column-level grants                                                                                                                     |
| `migrations/0005_storage.sql`                       | `cat-photos` / `avatars` buckets + policies                                                                                                                  |
| `migrations/0006_seed_badges.sql`                   | Badge catalog (required reference data)                                                                                                                      |
| `migrations/0007_rewards.sql`                       | Rewards marketplace: Kibble wallet, brands/offers/redemptions, sponsored placements, `redeem_reward()` RPC + RLS                                             |
| `migrations/0008_seed_rewards.sql`                  | Demo brands, offers, and sponsored placements                                                                                                                |
| `migrations/0009_location_privacy.sql`              | `get_sighting_detail()` RPC; precise coords/address gated to reporter + guardian; address geocoding                                                          |
| `migrations/0010_push_tokens.sql`                   | `push_tokens` table, `upsert_push_token()` / `tokens_near()` RPCs, `set_push_enabled()`                                                                      |
| `migrations/0011_rate_limiting.sql`                 | Insert rate-limit triggers + `rate_limit_check()`                                                                                                            |
| `migrations/0012_moderation.sql`                    | `report_content` / `moderate_content` / `block_user` / `unblock_user` / `get_blocked_users`; `is_moderator` role                                             |
| `migrations/0013_adoption_analytics.sql`            | Adoption-funnel analytics triggers                                                                                                                           |
| `migrations/0014-0023_*.sql`                        | Misc enhancements: AI features, re-id, lost-cat, KB, etc. (see individual files)                                                                             |
| `migrations/0024_ai_kb.sql`                         | `kb_chunks` / `kb_documents` tables; `match_kb_chunks()` RPC; RLS; grant to authenticated                                                                    |
| `migrations/0025_reid.sql`                          | Re-id (re-identification) schema and RPCs                                                                                                                    |
| `migrations/0026_lost_cat.sql`                      | Lost-cat report schema and functions                                                                                                                         |
| `migrations/0027_push_ranking.sql`                  | Token-ranking RPCs for push targeting                                                                                                                        |
| `migrations/0028_analytics_events.sql`              | `analytics_events` table for self-hosted analytics                                                                                                           |
| `migrations/0029_push_lifecycle.sql`                | Lifecycle push triggers: `private.push_config`, `enqueue_push_notification()`, webhook for claimed/rescued/adoption-interest                                 |
| `migrations/0030_send_push_auth.sql`                | Dual auth (JWT + webhook shared secret) for send-push Edge Function                                                                                          |
| `migrations/0031_fix_redeem_reward_search_path.sql` | Prod bug fix: widen `redeem_reward()` search_path to `extensions` schema for pgcrypto                                                                        |
| `migrations/0032_adopter_screening.sql`             | Adopter background check: `adopter_screenings` + private `screening-docs` bucket; `submit`/`get_my`/`review`/`is_cleared` RPCs; hard gate on express/approve |
| `migrations/0033_account_erasure.sql`               | Account deletion removes the person's data and uploads                                                                                                       |
| `migrations/0034_push_account_isolation.sql`        | Push tokens belong to one account at a time; legacy registrations must opt in again                                                                          |
| `migrations/0035_screening_evidence_reset.sql`      | Changing screening evidence resets a previous approval                                                                                                       |
| `migrations/0036_read_path_privacy.sql`             | Blocks hide the blocked user's reports and comments; `nearby_sightings` measures against the coarsened point                                                 |
| `migrations/0037_points_once_per_cat.sql`           | Claim and rescue points are paid once per person per cat                                                                                                     |
| `migrations/0038_adoption_loop.sql`                 | Moderator background-check queue; lister decline; withdrawn requests cannot be approved; pushes for decisions and comments (deploy `send-push` first)        |
| `migrations/0039_database_security.sql`             | RPC-only creation; atomic AI/request quotas; screening path validation and evidence replacement protection; hidden/blocked detail and claim guards           |
| `migrations/0040_storage_upload_bounds.sql`         | Storage API upload size and declared MIME restrictions, including private ID photos                                                                          |
| `migrations/0041_child_content_visibility.sql`      | Parent visibility on raw photo/comment reads and inserts; serialize the twelve-photo attachment limit                                                        |
| `migrations/0042_claim_lease_escalation.sql`        | Scheduled jobs (pg_cron) with a run log; claims become leases the server releases; unclaimed urgent reports escalate at 20 and 60 minutes                    |
| `migrations/0043_alert_preferences_inbox.sql`       | Alert preferences (area, radius, duty, quiet hours); every push recorded in an inbox first; urgent audience chosen per person; reporter told every status    |
| `seed.sql`                                          | Optional demo sightings                                                                                                                                      |
| `tests/`                                            | pgTAP behavioral test suites; counts in older release documents are historical                                                                               |
| `scripts/schema_assertions.sql`                     | psql-based drift detector (run manually, not pgTAP harness)                                                                                                  |

## Option A — hosted Supabase (fastest)

1. Create a project at <https://app.supabase.com>.
2. For a **new, empty database**, open **SQL Editor** and run every file in
   `migrations/` **in filename order**, currently through
   `0043_alert_preferences_inbox.sql`. Include suffixed migrations such as
   `0028b_owner_scoped_storage_select.sql`. Then optionally run `seed.sql`.
   For an existing hosted project, follow [DEPLOY.md](../DEPLOY.md) first;
   do not replay the full migration set.
3. In **Project Settings → API**, copy the **Project URL** and **anon public**
   key into the app's `.env`:
   ```
   EXPO_PUBLIC_SUPABASE_URL=...
   EXPO_PUBLIC_SUPABASE_ANON_KEY=...
   ```
4. In **Authentication → Providers**, keep Email enabled. For quick local
   testing you can turn **off** "Confirm email" so sign-ups log in immediately.

## Option B — Supabase CLI (recommended for teams)

```bash
brew install supabase/tap/supabase     # or see supabase.com/docs
# This repository already contains supabase/config.toml.
# Local development with Docker:
supabase start
supabase db reset --local              # destroys local data; reapplies migrations + seed.sql
```

For hosted deployments, inspect the linked project's migration history and
follow [DEPLOY.md](../DEPLOY.md). The existing Guardians project has timestamped
remote migration entries while this repository uses numeric filenames; a plain
`supabase db push` can replay already-applied SQL. Apply only confirmed missing
migrations and reconcile their history as documented in that runbook.

## Data model at a glance

- **profiles** — one per auth user; holds `points`, `level`, `is_guardian`,
  `wants_to_adopt`, and tallies. Score columns are _not_ client-writable.
- **sightings** — the core unit (a reported cat) with a PostGIS `location`.
  Lifecycle: `spotted → claimed → in_rescue → safe → available → adopted`
  (plus `archived`). Status changes only happen via the RPCs below.
- **sighting_photos / sighting_updates** — photos and the activity timeline.
- **adoption_interest** — adopters applying for an `available` cat.
  Expressing interest and approval both require a cleared background check
  (see `adopter_screenings` below).
- **adopter_screenings** — one background-check row per user (PII: owner-only
  via `get_my_screening()`; listers see only the `is_adopter_cleared()` boolean).
  ID documents live in the private `screening-docs` bucket (`{uid}/...`).
- **badges / user_badges / point_events** — gamification.
- **reward_brands / reward_offers / reward_redemptions** — the rewards
  marketplace. Users spend `profiles.kibble_balance` (a spendable currency
  minted 1:1 with points, but never decremented from the leaderboard `points`).
- **wallet_transactions** — append-only Kibble ledger (earn/redeem).
- **sponsored_placements** — direct-sold brand ad slots (feed card / banner).

## RPCs (call with `supabase.rpc(...)`)

| Function                                                     | What it does                                                                      |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| `nearby_sightings(lat, lng, radius_m, statuses?, limit?)`    | Cats within a radius, nearest first                                               |
| `get_sighting_detail(p_sighting)`                            | Full sighting with precise coords + address (RESTRICTED — reporter/guardian only) |
| `claim_sighting(p_sighting)`                                 | A guardian claims an open cat (+15 pts)                                           |
| `update_sighting_status(p_sighting, p_new_status, p_note?)`  | Advance lifecycle (+50 on rescue)                                                 |
| `express_adoption_interest(p_sighting, p_message?)`          | Apply to adopt an available cat (requires cleared background check)               |
| `approve_adoption(p_interest)`                               | Lister approves an adopter (forever home 🎉; applicant must be cleared)           |
| `submit_adopter_screening(p_payload)`                        | Submit background-check questionnaire (deterministic auto-scoring)                |
| `get_my_screening()`                                         | Owner-only read of my screening (lazy-expires approvals)                          |
| `is_adopter_cleared(p_user)`                                 | Boolean only (lister-safe, no PII) — cleared = approved + ID verified + unexpired |
| `review_adopter_screening(p_user, p_decision, p_reason?)`    | Moderator: verify ID + approve/reject (12-month validity)                         |
| `redeem_reward(p_offer)`                                     | Spend Kibble on a brand offer; issues a discount code                             |
| `award_points(p_target_user, p_points, p_reason)`            | SECURITY DEFINER points award (moderator only)                                    |
| `set_push_enabled(p_enabled)`                                | Toggle push notifications for current user                                        |
| `upsert_push_token(p_token, p_os, p_home_lat?, p_home_lng?)` | Register/update a push token                                                      |
| `tokens_near(p_lat, p_lng, p_radius_m)`                      | Service-role: push tokens near a location                                         |
| `report_content(p_sighting_id, p_reason)`                    | Report a sighting for moderation                                                  |
| `moderate_content(p_sighting_id, p_action, p_reason?)`       | Moderator: hide/restore content                                                   |
| `block_user(p_target_id)`                                    | Block a user (hides their sightings)                                              |
| `unblock_user(p_target_id)`                                  | Unblock a previously-blocked user                                                 |
| `get_blocked_users()`                                        | List blocked user IDs + usernames                                                 |
| `delete_account()`                                           | Service-role: delete user + cascade all data                                      |

## Security notes

- Every table has RLS enabled.
- `points`, `level`, counts, `status`, and `kibble_balance` are mutated **only**
  through SECURITY DEFINER functions — clients cannot edit them directly
  (enforced with column-level `GRANT`s). Redemptions and the wallet ledger are
  owner-read-only and written exclusively by `redeem_reward()` / `award_points()`.
- Storage uploads are restricted to a per-user folder (`{uid}/...`).
- Migration 0040 limits each new avatar/cat-photo object to 5 MiB and each ID
  photo to 10 MiB. Avatars/cat photos allow declared JPEG/PNG/WebP; ID photos
  also allow HEIC/HEIF for original iOS camera files. These are Storage API
  limits; MIME declarations are not content verification or moderation. Existing
  objects are preserved. Monitor total usage separately to prevent cost abuse.

## Edge functions

| Function         | Trigger         | What it does                                                                                                                                                                              |
| ---------------- | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `send-push`      | DB webhook only | Sends Expo push notifications for lifecycle events. Requires the shared webhook secret; caller JWTs cannot initiate or replay broadcasts. Logging, ticket inspection, dead-token reaping. |
| `delete-account` | Client call     | Service-role account deletion (cascading).                                                                                                                                                |

## Testing

Behavioral DB tests live in `supabase/tests/`. Run all current SQL suites;
historical file/test counts are not current verification. Suites cover anonymous
and multiple-user grants/RLS, screening evidence, account erasure, location and
block privacy, lifecycle/points, quotas, rewards, and upload configuration.

Run locally:

```bash
supabase db test
```

A drift-detection script lives at `scripts/schema_assertions.sql` (psql, not pgTAP).
It asserts protections through migrations 0039–0043 as well as earlier
invariants. Bucket metadata assertions do not exercise the Storage HTTP API:
use synthetic staging uploads to verify MIME/size rejection and valid image
uploads before deploying these limits.

After pgTAP, run `tests/check_rate_limit_concurrency.py` and
`tests/check_photo_cap_concurrency.py` against an explicitly named isolated local
database/container. They create and remove synthetic fixtures to verify atomic
quotas and the twelve-photo cap under simultaneous requests. They never accept a
hosted connection URL. Hidden/blocked parent rules also apply to raw photo and
comment reads and inserts; reporter, assigned Guardian and moderator access to
hidden parents is preserved. Previously known public image URLs remain public.

### Push delivery evidence and limitations

`send-push` requires the webhook secret before service-role access. Both lifecycle
and optional lost-cat notifications honor account ownership, `push_enabled`, and
`urgent_opt_in`. The shared transport bounds batches to 100 messages, times out
requests after 10 seconds, and retries network/HTTP 429/5xx failures at most three
times with backoff. HTTP 400 is not retried. Missing/malformed tickets count as
failures, and raw provider bodies/ticket text are excluded from diagnostics
because they may contain tokens or personal text. AI provider errors likewise
log status only.

`sent` counts messages accepted by Expo with a ticket ID. It does not prove
APNs/FCM or device delivery. This backend currently has no persistent notification
outbox, receipt collector, or webhook event ID. Repeated trusted webhooks send
again; ambiguous network retries can duplicate delivery. pg_net's response is
discarded by the existing triggers, so failures after the bounded retries are
not durably replayed. These limitations are explicitly regression tested.
Do not promise exactly-once delivery or guaranteed rescue alerts.

Before rollout, verify real opt-in/out and device delivery using synthetic
accounts, inspect Expo receipts and credential errors, and establish alert
ownership. Receipt collection/durable replay requires a staging-tested design
with event identities and retention/erasure rules. See
[Expo delivery and receipt guidance](https://docs.expo.dev/push-notifications/sending-notifications/).

## Reconciling the September branch migrations

The screening branch already used `0032_adopter_screening.sql`; the production
hardening branch independently used `0032_push_account_isolation.sql`. The combined
history keeps screening at `0032` and moves push isolation to `0034`, after account
erasure `0033`. Evidence invalidation is added in `0035`.

Before updating an existing database, inspect its migration history and applied SQL.
If push isolation was recorded as `0032`, reconcile that record to `0034` only after
verifying the function/index definitions, and apply screening separately if absent.
If screening was recorded as `0032`, apply only missing migrations. Do not blindly
run `db push` against the timestamped production history or replay push isolation:
it intentionally disables legacy push registrations. These repository changes do
not alter any hosted database or deploy Edge Functions.

## Scheduled jobs, claim leases and urgent escalation (0042)

Migration 0042 turns on `pg_cron` and registers three jobs. Each runs through
`private.run_job`, which writes one row to `private.job_runs` per run, rolls
the job's own writes back if it throws, and pushes `ops_job_failed` to
moderators when a job that was healthy starts failing. Moderators can read a
summary through the `get_job_health()` RPC.

| Job                           | Schedule        | What it does                                                                                                                                        |
| ----------------------------- | --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `guardians-claim-leases`      | every 5 minutes | Warns a Guardian 6 hours before their claim lapses, and returns a lapsed claim to `spotted`, telling the former Guardian and the reporter           |
| `guardians-urgent-escalation` | every minute    | For an unclaimed urgent report: alerts a wider ring at 20 minutes, and tells moderators and the reporter at 60 minutes. One step per report per run |
| `guardians-prune-job-runs`    | daily           | Deletes run-log rows older than 14 days                                                                                                             |

A claim lasts 24 hours, or 72 hours once the cat is `in_rescue`. A comment or
photo from the assigned Guardian renews it, and `extend_claim` restores a full
lease inside the 6-hour warning window. Once a cat is `safe` there is no lease.
The numbers live in `claim_lease()` and `claim_warning_lead()`.

Applying 0042 does not send anything by itself: existing claims start a full
fresh lease, and only reports opened in the last 24 hours are ever escalated.
Deploy `send-push` first, so the new events and the wider-ring broadcast
(`escalation_step: 2`) are understood; the previous version would treat a ring
request as a second base-radius alert.

Tests: `tests/claim_lease_escalation_test.sql` (pgTAP, time moved through each
job's `p_now` argument) and `tests/check_claim_expiry_concurrency.py`, which
races the expiry job against a Guardian's renewal on a local database.

## Alert preferences and the inbox (0043)

Every notification now goes through one function, `private.post_push`. It
writes a row to `public.notifications` (the inbox) and queues the call to
`send-push` in the same transaction as the event that caused it. If the push
never arrives, the inbox entry is still there. The older funnels
(`enqueue_push_notification`, `enqueue_push_event`) hand over to it.

Urgent broadcasts are no longer worked out from device tokens. The audience
comes from `public.alert_preferences`, one row per person:

| Preference                  | Effect                                                                                         |
| --------------------------- | ---------------------------------------------------------------------------------------------- |
| `on_duty`                   | Off: no urgent alerts at all. Updates about the person's own cases still arrive                |
| `urgent_alerts`             | Off: no urgent alerts                                                                          |
| `home_location`, `radius_m` | The base alert reaches people within the smaller of 8 km and their own radius                  |
| `wider_radius_m`            | The wider ring (0042, step 2) reaches people outside that, up to the smaller of 20 km and this |
| `quiet_start`, `quiet_end`  | Inside the window (read in `time_zone`) the inbox entry is kept but not pushed                 |

People who blocked the reporter are never in the audience, and the reporter
is never in the audience for their own report. The home area follows the
phone (`upsert_push_token`) until the person pins one in the app. On apply,
everyone with a registered device gets preferences copied from their latest
device, so nobody's alerts change.

`send-push` gets a `batch_id` and asks `batch_push_tokens` for the devices of
everyone in the batch outside quiet hours with push on. A `send-push` without
this change ignores the batch and falls back to `tokens_near`, so either can
be deployed first. The new `case_status` event does need the new `send-push`.
With the old one, those pushes are refused (the inbox entries are still kept),
so deploy `send-push` first.

The reporter now hears about every status change: `claimed` and `safe` as
before, and `case_status` for everything else, carrying the new status. A
claim lapsing is reported once, by the lease job (`claim_reopened`). Nobody is
told about their own action.

A daily job (`guardians-prune-notifications`) deletes entries older than 90
days.

Tests: `tests/alert_inbox_test.sql`.
