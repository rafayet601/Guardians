-- ============================================================================
-- Guardians — 0008_seed_rewards
-- Demo brands, offers, and sponsored placements so the rewards marketplace is
-- populated on first run. Curated content (no brand self-serve portal yet).
-- Fixed UUIDs keep this idempotent / safe to re-run.
--
-- Offers intentionally span every gate type so the tiering is demoable:
--   • open        — no gate, low cost (anyone)
--   • rescuer     — required_badge_id = 'rescue_hero'
--   • adopter     — required_badge_id = 'matchmaker'
--   • high-tier   — min_level >= 5
-- ============================================================================

insert into public.reward_brands (id, name, blurb, website, is_active) values
  ('a0000000-0000-4000-a000-000000000001', 'Whisker & Co.', 'Premium grain-free food for rescued cats.', 'https://example.com/whisker', true),
  ('a0000000-0000-4000-a000-000000000002', 'PurrLitter',    'Clumping, low-dust litter that cats love.',  'https://example.com/purrlitter', true),
  ('a0000000-0000-4000-a000-000000000003', 'The Cat Cabin', 'Beds, toys & carriers for every guardian.',  'https://example.com/catcabin', true),
  ('a0000000-0000-4000-a000-000000000004', 'PawCare Vets',  'Affordable wellness checks & vaccinations.', 'https://example.com/pawcare', true)
on conflict (id) do update
  set name = excluded.name, blurb = excluded.blurb,
      website = excluded.website, is_active = excluded.is_active;

insert into public.reward_offers
  (id, brand_id, title, description, discount_label, cost_kibble, min_level, required_badge_id, inventory, once_per_user, is_active)
values
  -- Open to everyone — a cheap first taste of the marketplace.
  ('b0000000-0000-4000-b000-000000000001', 'a0000000-0000-4000-a000-000000000001',
   '10% off your first order', 'Save on any bag of Whisker & Co. food.', '10% off',
   150, 1, null, null, true, true),

  ('b0000000-0000-4000-b000-000000000002', 'a0000000-0000-4000-a000-000000000002',
   '15% off PurrLitter', 'Discount on any PurrLitter subscription box.', '15% off',
   200, 1, null, null, true, true),

  -- Rescuer-exclusive — gated behind the Rescue Hero badge (5 rescues).
  ('b0000000-0000-4000-b000-000000000003', 'a0000000-0000-4000-a000-000000000001',
   'Rescuer perk: 30% off premium food', 'Reserved for our Rescue Heroes. Thank you for saving lives.', '30% off',
   400, 1, 'rescue_hero', null, true, true),

  -- Adopter perk — gated behind the Matchmaker badge (placed a cat).
  ('b0000000-0000-4000-b000-000000000004', 'a0000000-0000-4000-a000-000000000003',
   'Adopter starter kit', 'Free bed + toy bundle for guardians who rehomed a cat.', 'Free bundle',
   300, 1, 'matchmaker', 100, true, true),

  -- High-tier — level gate, the aspirational reward.
  ('b0000000-0000-4000-b000-000000000005', 'a0000000-0000-4000-a000-000000000004',
   '25% off a wellness check', 'Unlocks at level 5. Keep your cats healthy for less.', '25% off',
   600, 5, null, null, true, true),

  ('b0000000-0000-4000-b000-000000000006', 'a0000000-0000-4000-a000-000000000003',
   'Free enamel pin', 'A little thank-you for every guardian.', 'Free gift',
   50, 1, null, 500, true, true)
on conflict (id) do update
  set brand_id = excluded.brand_id, title = excluded.title, description = excluded.description,
      discount_label = excluded.discount_label, cost_kibble = excluded.cost_kibble,
      min_level = excluded.min_level, required_badge_id = excluded.required_badge_id,
      inventory = excluded.inventory, once_per_user = excluded.once_per_user,
      is_active = excluded.is_active;

insert into public.sponsored_placements
  (id, brand_id, slot, title, body, cta_label, cta_url, priority, is_active)
values
  ('c0000000-0000-4000-c000-000000000001', 'a0000000-0000-4000-a000-000000000001',
   'feed_card', 'Whisker & Co. loves rescuers 🐟',
   'Quality food for the cats you save. Redeem your Kibble for a discount.',
   'Shop now', 'https://example.com/whisker', 10, true),

  ('c0000000-0000-4000-c000-000000000002', 'a0000000-0000-4000-a000-000000000003',
   'rewards_banner', 'The Cat Cabin — Partner of the Month',
   'Spend your hard-earned Kibble on beds, toys & carriers.',
   'Explore', 'https://example.com/catcabin', 10, true)
on conflict (id) do update
  set brand_id = excluded.brand_id, slot = excluded.slot, title = excluded.title,
      body = excluded.body, cta_label = excluded.cta_label, cta_url = excluded.cta_url,
      priority = excluded.priority, is_active = excluded.is_active;
