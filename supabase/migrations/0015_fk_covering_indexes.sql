-- ============================================================================
-- Guardians — 0015_fk_covering_indexes
-- Covering indexes for foreign keys flagged by the performance advisor. Speeds
-- up joins and cascade/set-null deletes on these columns. (applied via MCP)
-- ============================================================================
create index if not exists point_events_sighting_idx on public.point_events (sighting_id);
create index if not exists reward_offers_required_badge_idx on public.reward_offers (required_badge_id);
create index if not exists sighting_photos_uploaded_by_idx on public.sighting_photos (uploaded_by);
create index if not exists sighting_updates_author_idx on public.sighting_updates (author_id);
create index if not exists sponsored_placements_brand_idx on public.sponsored_placements (brand_id);
create index if not exists user_badges_badge_idx on public.user_badges (badge_id);
create index if not exists user_blocks_blocked_idx on public.user_blocks (blocked_id);
create index if not exists wallet_transactions_redemption_idx on public.wallet_transactions (redemption_id);
