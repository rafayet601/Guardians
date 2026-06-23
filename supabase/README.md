# Supabase backend — Guardians

This folder holds the database schema, security policies, geo functions, and
gamification engine that power Guardians.

## Layout

| File | Purpose |
|------|---------|
| `migrations/0001_init.sql` | Extensions (PostGIS), enums, tables, indexes |
| `migrations/0002_functions.sql` | Profile bootstrap, gamification, secure transition RPCs |
| `migrations/0003_geo.sql` | `nearby_sightings()` radius search |
| `migrations/0004_rls.sql` | Row Level Security + column-level grants |
| `migrations/0005_storage.sql` | `cat-photos` / `avatars` buckets + policies |
| `migrations/0006_seed_badges.sql` | Badge catalog (required reference data) |
| `migrations/0007_rewards.sql` | Rewards marketplace: Kibble wallet, brands/offers/redemptions, sponsored placements, `redeem_reward()` RPC + RLS |
| `migrations/0008_seed_rewards.sql` | Demo brands, offers, and sponsored placements |
| `seed.sql` | Optional demo sightings |

## Option A — hosted Supabase (fastest)

1. Create a project at <https://app.supabase.com>.
2. Open **SQL Editor** and run each file in `migrations/` **in order**
   (`0001` → `0012`). Then optionally run `seed.sql`.
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
  `wants_to_adopt`, and tallies. Score columns are *not* client-writable.
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

| Function | What it does |
|----------|--------------|
| `nearby_sightings(lat, lng, radius_m, statuses?, limit?)` | Cats within a radius, nearest first |
| `claim_sighting(p_sighting)` | A guardian claims an open cat (+15 pts) |
| `update_sighting_status(p_sighting, p_new_status, p_note?)` | Advance lifecycle (+50 on rescue) |
| `express_adoption_interest(p_sighting, p_message?)` | Apply to adopt an available cat |
| `approve_adoption(p_interest)` | Lister approves an adopter (forever home 🎉) |
| `redeem_reward(p_offer)` | Spend Kibble on a brand offer; issues a discount code |

## Security notes

- Every table has RLS enabled.
- `points`, `level`, counts, `status`, and `kibble_balance` are mutated **only**
  through SECURITY DEFINER functions — clients cannot edit them directly
  (enforced with column-level `GRANT`s). Redemptions and the wallet ledger are
  owner-read-only and written exclusively by `redeem_reward()` / `award_points()`.
- Storage uploads are restricted to a per-user folder (`{uid}/...`).
