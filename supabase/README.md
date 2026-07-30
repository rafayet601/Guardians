# Supabase backend — Guardians

This folder holds the database schema, security policies, geo functions, and
gamification engine that power Guardians.

## Layout

| File                                                | Purpose                                                                                                                      |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `migrations/0001_init.sql`                          | Extensions (PostGIS), enums, tables, indexes                                                                                 |
| `migrations/0002_functions.sql`                     | Profile bootstrap, gamification, secure transition RPCs                                                                      |
| `migrations/0003_geo.sql`                           | `nearby_sightings()` radius search                                                                                           |
| `migrations/0004_rls.sql`                           | Row Level Security + column-level grants                                                                                     |
| `migrations/0005_storage.sql`                       | `cat-photos` / `avatars` buckets + policies                                                                                  |
| `migrations/0006_seed_badges.sql`                   | Badge catalog (required reference data)                                                                                      |
| `migrations/0007_rewards.sql`                       | Rewards marketplace: Kibble wallet, brands/offers/redemptions, sponsored placements, `redeem_reward()` RPC + RLS             |
| `migrations/0008_seed_rewards.sql`                  | Demo brands, offers, and sponsored placements                                                                                |
| `migrations/0009_location_privacy.sql`              | `get_sighting_detail()` RPC; precise coords/address gated to reporter + guardian; address geocoding                          |
| `migrations/0010_push_tokens.sql`                   | `push_tokens` table, `upsert_push_token()` / `tokens_near()` RPCs, `set_push_enabled()`                                      |
| `migrations/0011_rate_limiting.sql`                 | Insert rate-limit triggers + `rate_limit_check()`                                                                            |
| `migrations/0012_moderation.sql`                    | `report_content` / `moderate_content` / `block_user` / `unblock_user` / `get_blocked_users`; `is_moderator` role             |
| `migrations/0013_adoption_analytics.sql`            | Adoption-funnel analytics triggers                                                                                           |
| `migrations/0014-0023_*.sql`                        | Misc enhancements: AI features, re-id, lost-cat, KB, etc. (see individual files)                                             |
| `migrations/0024_ai_kb.sql`                         | `kb_chunks` / `kb_documents` tables; `match_kb_chunks()` RPC; RLS; grant to authenticated                                    |
| `migrations/0025_reid.sql`                          | Re-id (re-identification) schema and RPCs                                                                                    |
| `migrations/0026_lost_cat.sql`                      | Lost-cat report schema and functions                                                                                         |
| `migrations/0027_push_ranking.sql`                  | Token-ranking RPCs for push targeting                                                                                        |
| `migrations/0028_analytics_events.sql`              | `analytics_events` table for self-hosted analytics                                                                           |
| `migrations/0029_push_lifecycle.sql`                | Lifecycle push triggers: `private.push_config`, `enqueue_push_notification()`, webhook for claimed/rescued/adoption-interest |
| `migrations/0030_send_push_auth.sql`                | Dual auth (JWT + webhook shared secret) for send-push Edge Function                                                          |
| `migrations/0031_fix_redeem_reward_search_path.sql` | Prod bug fix: widen `redeem_reward()` search_path to `extensions` schema for pgcrypto                                        |
| `seed.sql`                                          | Optional demo sightings                                                                                                      |
| `tests/`                                            | pgTAP behavioral test suites (9 files, 114 tests)                                                                            |
| `scripts/schema_assertions.sql`                     | psql-based drift detector (run manually, not pgTAP harness)                                                                  |

## Option A — hosted Supabase (fastest)

1. Create a project at <https://app.supabase.com>.
2. Open **SQL Editor** and run each file in `migrations/` **in order**
   (`0001` → `0031`). Then optionally run `seed.sql`.
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
supabase init                          # if not already initialized
supabase link --project-ref <your-ref>
supabase db push                       # applies migrations/
# local dev with Docker:
supabase start
supabase db reset                      # applies migrations + seed.sql
```

## Data model at a glance

- **profiles** — one per auth user; holds `points`, `level`, `is_guardian`,
  `wants_to_adopt`, and tallies. Score columns are _not_ client-writable.
- **sightings** — the core unit (a reported cat) with a PostGIS `location`.
  Lifecycle: `spotted → claimed → in_rescue → safe → available → adopted`
  (plus `archived`). Status changes only happen via the RPCs below.
- **sighting_photos / sighting_updates** — photos and the activity timeline.
- **adoption_interest** — adopters applying for an `available` cat.
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
| `express_adoption_interest(p_sighting, p_message?)`          | Apply to adopt an available cat                                                   |
| `approve_adoption(p_interest)`                               | Lister approves an adopter (forever home 🎉)                                      |
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

## Edge functions

| Function         | Trigger              | What it does                                                                                                                                                                                         |
| ---------------- | -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `send-push`      | DB webhook + JS call | Sends Expo push notifications for lifecycle events (urgent, claimed, rescued, adoption-interest). Dual auth: JWT (client) + shared secret (webhook). Logging, ticket inspection, dead-token reaping. |
| `delete-account` | Client call          | Service-role account deletion (cascading).                                                                                                                                                           |

## Testing

Behavioral DB tests live in `supabase/tests/` — 9 pgTAP suites (114 tests):
`location_privacy_test`, `write_guards_test`, `redeem_guard_test`,
`lifecycle_test`, `ai_moderation_test`, `rag_kb_test`, `lost_cat_test`,
`reid_test`, `push_ranking_test`.

Run locally:

```bash
supabase db test
```

A drift-detection script lives at `scripts/schema_assertions.sql` (psql, not pgTAP).
