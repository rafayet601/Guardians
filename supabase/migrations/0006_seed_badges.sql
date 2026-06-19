-- ============================================================================
-- Guardians — 0006_seed_badges
-- Badge catalog (reference data). award_badges() in 0002 references these ids,
-- so this must be applied. Safe to re-run.
-- ============================================================================

insert into public.badges (id, name, description, icon, sort_order) values
  ('first_report',   'First Sighting',  'Reported your first cat.',                    '👀', 10),
  ('reporter_pro',   'Eagle Eye',       'Reported 10 cats.',                           '🔭', 20),
  ('first_rescue',   'First Rescue',    'Completed your first rescue.',                '🦸', 30),
  ('rescue_hero',    'Rescue Hero',     'Completed 5 rescues.',                        '🏅', 40),
  ('guardian_angel', 'Guardian Angel',  'Completed 25 rescues.',                       '😇', 50),
  ('matchmaker',     'Matchmaker',      'Placed a cat in a forever home.',             '💞', 60),
  ('community_star', 'Community Star',  'Earned 500 points.',                          '⭐', 70),
  ('legend',         'Guardian Legend', 'Earned 2000 points.',                         '👑', 80)
on conflict (id) do update
  set name = excluded.name,
      description = excluded.description,
      icon = excluded.icon,
      sort_order = excluded.sort_order;
