-- ============================================================================
-- Guardians — optional demo seed
-- A handful of unowned sightings so the map isn't empty before real users
-- start reporting. Centered on San Francisco; edit the coordinates to taste.
-- Run AFTER the migrations:  (Supabase SQL editor or `supabase db reset`)
-- Stable IDs match the existing demo records and src/utils/demoSightings.ts.
-- Re-running this seed preserves any changes already made to those records.
-- ============================================================================

insert into public.sightings
  (id, reporter_id, title, description, location, status, temperament, color, is_injured, needs_urgent_help)
values
  ('180525a3-1d9d-4ac5-a6ae-c27463fdc9cb', null, 'Orange tabby near Dolores Park',
   'Friendly orange tabby hanging around the tennis courts. Comes when called.',
   st_setsrid(st_makepoint(-122.4271, 37.7596), 4326)::geography,
   'spotted', 'friendly', 'orange', false, false),

  ('63847f73-af61-4d76-a7c2-c7f20b626697', null, 'Skittish black kitten',
   'Small black kitten under a parked car on Valencia St. Very shy.',
   st_setsrid(st_makepoint(-122.4214, 37.7641), 4326)::geography,
   'spotted', 'shy', 'black', false, true),

  ('8cb14cee-3d9d-4ab1-bc09-ead95a131c08', null, 'Injured grey cat',
   'Grey cat limping near the Ferry Building. Looks like a hurt paw.',
   st_setsrid(st_makepoint(-122.3937, 37.7955), 4326)::geography,
   'spotted', 'unknown', 'grey', true, true),

  ('2f1d2c0e-62fb-4a1f-b664-6cd1aac146bb', null, 'Calico ready for adoption',
   'Sweet calico, vetted and spayed, looking for a forever home.',
   st_setsrid(st_makepoint(-122.4477, 37.7699), 4326)::geography,
   'available', 'friendly', 'calico', false, false),

  ('7e25f8ed-a436-46c2-8bb7-8f369602dd9d', null, 'Tuxedo cat colony',
   'Two tuxedo cats living behind the cafe. Being fed by neighbors.',
   st_setsrid(st_makepoint(-122.4099, 37.7835), 4326)::geography,
   'spotted', 'feral', 'tuxedo', false, false)
on conflict (id) do nothing;
