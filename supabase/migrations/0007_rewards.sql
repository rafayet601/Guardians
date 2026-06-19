-- ============================================================================
-- Guardians — 0007_rewards
-- Brand rewards marketplace + sponsored placements.
--
-- DUAL CURRENCY: `profiles.points` stays the lifetime reputation score that
-- drives the leaderboard, levels, and badges — it is NEVER spent. A second,
-- spendable balance ("Kibble") is minted 1:1 alongside points and is what users
-- redeem for brand discounts. Redeeming spends Kibble only; rank is untouched.
--
-- Like points/point_events, every Kibble movement is logged to an append-only
-- ledger (wallet_transactions) and the balance is mutated ONLY through
-- SECURITY DEFINER functions, so clients can never write it directly.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- profiles: spendable wallet + admin flag (catalog curation gate)
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column if not exists kibble_balance integer not null default 0;

alter table public.profiles
  add column if not exists is_admin boolean not null default false;

-- Backfill launch users so existing points already have spendable Kibble.
-- Guarded so re-running the migration can't double-credit anyone.
update public.profiles
set kibble_balance = points
where kibble_balance = 0 and points > 0;

-- ---------------------------------------------------------------------------
-- reward_brands  (pet-friendly partners — curated/seeded for now)
-- ---------------------------------------------------------------------------
create table if not exists public.reward_brands (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  blurb      text,
  logo_url   text,
  website    text,
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- reward_offers  (a redeemable discount/perk from a brand)
--   cost_kibble                 -> how much Kibble to redeem
--   min_level / required_badge  -> tier gating (the "rescuers get exclusive
--                                  perks" mechanic — gate offers behind badges
--                                  like 'rescue_hero' or a minimum level)
--   inventory (null = ∞)        -> caps total redemptions
--   once_per_user               -> each user may redeem at most once
-- ---------------------------------------------------------------------------
create table if not exists public.reward_offers (
  id               uuid primary key default gen_random_uuid(),
  brand_id         uuid not null references public.reward_brands (id) on delete cascade,
  title            text not null,
  description      text,
  image_url        text,
  discount_label   text,                      -- e.g. '20% off', 'Free sample'
  cost_kibble      integer not null check (cost_kibble >= 0),
  min_level        integer not null default 1,
  required_badge_id text references public.badges (id) on delete set null,
  inventory        integer,                   -- null = unlimited
  redeemed_count   integer not null default 0,
  once_per_user    boolean not null default true,
  starts_at        timestamptz,
  ends_at          timestamptz,
  is_active        boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists reward_offers_brand_idx  on public.reward_offers (brand_id);
create index if not exists reward_offers_active_idx on public.reward_offers (is_active);

-- ---------------------------------------------------------------------------
-- reward_redemptions  (a user spent Kibble on an offer -> issued a code)
-- ---------------------------------------------------------------------------
create table if not exists public.reward_redemptions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles (id) on delete cascade,
  offer_id    uuid not null references public.reward_offers (id) on delete cascade,
  cost_kibble integer not null,              -- snapshot of what was paid
  code        text not null,                 -- the discount code issued
  status      text not null default 'active'
                check (status in ('active', 'used', 'expired')),
  redeemed_at timestamptz not null default now(),
  expires_at  timestamptz
);
create index if not exists reward_redemptions_user_idx  on public.reward_redemptions (user_id, redeemed_at desc);
create index if not exists reward_redemptions_offer_idx on public.reward_redemptions (offer_id);

-- ---------------------------------------------------------------------------
-- wallet_transactions  (append-only Kibble ledger, mirrors point_events)
--   amount: positive = earned, negative = spent
-- ---------------------------------------------------------------------------
create table if not exists public.wallet_transactions (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles (id) on delete cascade,
  amount        integer not null,
  reason        text not null,
  kind          text not null default 'earn'
                  check (kind in ('earn', 'redeem', 'adjust')),
  redemption_id uuid references public.reward_redemptions (id) on delete set null,
  created_at    timestamptz not null default now()
);
create index if not exists wallet_transactions_user_idx on public.wallet_transactions (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- sponsored_placements  (direct-sold brand ad slots, curated for now)
-- ---------------------------------------------------------------------------
create table if not exists public.sponsored_placements (
  id         uuid primary key default gen_random_uuid(),
  brand_id   uuid references public.reward_brands (id) on delete set null,
  slot       text not null check (slot in ('feed_card', 'rewards_banner')),
  title      text not null,
  body       text,
  image_url  text,
  cta_label  text,
  cta_url    text,
  priority   integer not null default 0,      -- higher shows first
  starts_at  timestamptz,
  ends_at    timestamptz,
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists sponsored_placements_slot_idx on public.sponsored_placements (slot, is_active);

-- ---------------------------------------------------------------------------
-- keep updated_at fresh (reuses set_updated_at() from 0002)
-- ---------------------------------------------------------------------------
drop trigger if exists reward_brands_set_updated_at on public.reward_brands;
create trigger reward_brands_set_updated_at
  before update on public.reward_brands
  for each row execute function public.set_updated_at();

drop trigger if exists reward_offers_set_updated_at on public.reward_offers;
create trigger reward_offers_set_updated_at
  before update on public.reward_offers
  for each row execute function public.set_updated_at();

drop trigger if exists sponsored_placements_set_updated_at on public.sponsored_placements;
create trigger sponsored_placements_set_updated_at
  before update on public.sponsored_placements
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- award_points(): now also mints spendable Kibble 1:1 and logs the ledger
-- entry. Re-declared in full (body identical to 0002 plus the two Kibble
-- lines) so every existing caller — report/claim/rescue/adopt/place — earns
-- Kibble with zero changes to those RPCs.
-- ---------------------------------------------------------------------------
create or replace function public.award_points(
  p_user uuid, p_amount integer, p_reason text, p_sighting uuid default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_user is null or p_amount is null then return; end if;

  update public.profiles
  set points         = points + p_amount,
      level          = public.level_for_points(points + p_amount),
      kibble_balance = kibble_balance + p_amount
  where id = p_user;

  insert into public.point_events (user_id, amount, reason, sighting_id)
  values (p_user, p_amount, p_reason, p_sighting);

  insert into public.wallet_transactions (user_id, amount, reason, kind)
  values (p_user, p_amount, p_reason, 'earn');

  perform public.award_badges(p_user);
end;
$$;

-- ---------------------------------------------------------------------------
-- redeem_reward(): the ONLY path that spends Kibble. Validates eligibility,
-- inventory, balance, and once-per-user, then atomically debits the wallet,
-- logs the ledger entry, bumps the offer counter, and issues a code.
-- ---------------------------------------------------------------------------
create or replace function public.redeem_reward(p_offer uuid)
returns public.reward_redemptions
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  o   public.reward_offers;
  p   public.profiles;
  r   public.reward_redemptions;
  v_code text;
begin
  if uid is null then raise exception 'Not authenticated'; end if;

  -- Lock the offer row so concurrent redemptions can't oversell inventory.
  select * into o from public.reward_offers where id = p_offer for update;
  if not found then raise exception 'Reward not found'; end if;

  if not o.is_active then
    raise exception 'This reward is no longer available';
  end if;
  if o.starts_at is not null and now() < o.starts_at then
    raise exception 'This reward is not available yet';
  end if;
  if o.ends_at is not null and now() > o.ends_at then
    raise exception 'This reward has expired';
  end if;
  if o.inventory is not null and o.redeemed_count >= o.inventory then
    raise exception 'This reward is sold out';
  end if;

  select * into p from public.profiles where id = uid;
  if not found then raise exception 'Profile not found'; end if;

  if p.level < o.min_level then
    raise exception 'Reach level % to unlock this reward', o.min_level;
  end if;
  if o.required_badge_id is not null
     and not exists (
       select 1 from public.user_badges ub
       where ub.user_id = uid and ub.badge_id = o.required_badge_id
     ) then
    raise exception 'This reward is reserved for guardians who earned the % badge', o.required_badge_id;
  end if;
  if o.once_per_user and exists (
       select 1 from public.reward_redemptions rr
       where rr.user_id = uid and rr.offer_id = p_offer
     ) then
    raise exception 'You have already redeemed this reward';
  end if;
  if p.kibble_balance < o.cost_kibble then
    raise exception 'Not enough Kibble — you need % but have %', o.cost_kibble, p.kibble_balance;
  end if;

  -- Short, human-friendly, reasonably unique code.
  v_code := 'GUARD-' || upper(substr(encode(gen_random_bytes(5), 'hex'), 1, 8));

  -- Debit the wallet (never the leaderboard points).
  update public.profiles
  set kibble_balance = kibble_balance - o.cost_kibble
  where id = uid;

  update public.reward_offers
  set redeemed_count = redeemed_count + 1
  where id = p_offer;

  insert into public.reward_redemptions (user_id, offer_id, cost_kibble, code, expires_at)
  values (uid, p_offer, o.cost_kibble, v_code,
          case when o.ends_at is not null then o.ends_at else now() + interval '90 days' end)
  returning * into r;

  insert into public.wallet_transactions (user_id, amount, reason, kind, redemption_id)
  values (uid, -o.cost_kibble, 'Redeemed: ' || o.title, 'redeem', r.id);

  return r;
end;
$$;

-- ============================================================================
-- Row Level Security (mirrors the conventions in 0004_rls.sql)
-- ============================================================================
alter table public.reward_brands         enable row level security;
alter table public.reward_offers         enable row level security;
alter table public.reward_redemptions    enable row level security;
alter table public.wallet_transactions   enable row level security;
alter table public.sponsored_placements  enable row level security;

-- helper: is the current user an admin?
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce((select is_admin from public.profiles where id = auth.uid()), false);
$$;

-- reward_brands: anyone signed in reads active brands; only admins write.
drop policy if exists "active brands are viewable" on public.reward_brands;
create policy "active brands are viewable"
  on public.reward_brands for select to authenticated using (is_active);

drop policy if exists "admins manage brands" on public.reward_brands;
create policy "admins manage brands"
  on public.reward_brands for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- reward_offers: anyone signed in reads active offers; only admins write.
drop policy if exists "active offers are viewable" on public.reward_offers;
create policy "active offers are viewable"
  on public.reward_offers for select to authenticated using (is_active);

drop policy if exists "admins manage offers" on public.reward_offers;
create policy "admins manage offers"
  on public.reward_offers for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- reward_redemptions: strictly owner-readable. Inserts happen only via the
-- redeem_reward() SECURITY DEFINER RPC (no client INSERT policy = denied).
drop policy if exists "users read their own redemptions" on public.reward_redemptions;
create policy "users read their own redemptions"
  on public.reward_redemptions for select to authenticated
  using (user_id = auth.uid());

-- wallet_transactions: strictly owner-readable (mutated only via RPCs).
drop policy if exists "users read their own wallet" on public.wallet_transactions;
create policy "users read their own wallet"
  on public.wallet_transactions for select to authenticated
  using (user_id = auth.uid());

-- sponsored_placements: anyone signed in reads active placements; admins write.
drop policy if exists "active placements are viewable" on public.sponsored_placements;
create policy "active placements are viewable"
  on public.sponsored_placements for select to authenticated using (is_active);

drop policy if exists "admins manage placements" on public.sponsored_placements;
create policy "admins manage placements"
  on public.sponsored_placements for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- Least-privilege EXECUTE on the redemption RPC.
-- ---------------------------------------------------------------------------
revoke execute on function public.redeem_reward(uuid) from public;
grant  execute on function public.redeem_reward(uuid) to authenticated;
